import { describe, expect, it, vi } from 'vitest';
import { BITGET_KEY_PREFIX, BitgetCandleSource } from '../src/server/bitget-candles';
import { CandlestickStore } from '../src/server/candlestick-store';
import { reviewTimeframes } from '../src/domain/trade';

// Bitget mix candle row: [timestamp(ms), open, high, low, close, baseVolume, quoteVolume]
function bitgetRow(timestamp: number, close: string, volume: string): string[] {
  return [String(timestamp), '1', '2', '0.5', close, volume, '100'];
}

/** Bitget wraps rows in a business envelope; a raw array would read as no data. */
function candlesResponse(rows: string[][]): { code: string; msg: string; data: string[][] } {
  return { code: '00000', msg: 'success', data: rows };
}

const STEP = 5 * 60_000;
const ANCHOR = 1653381600000; // 2022-05-24T10:40:00.000Z, a 5m boundary.

describe('BitgetCandleSource', () => {
  it('maps row fields, requests earlier via endTime, and reuses the cache', async () => {
    const store = new CandlestickStore(':memory:');
    const fetchJson = vi.fn(async (_url: string) =>
      candlesResponse([bitgetRow(1653381000000, '29350', '12'), bitgetRow(1653381300000, '29480', '20')]),
    );
    const source = new BitgetCandleSource(store, fetchJson);

    const first = await source.getCandlesticks({ instrument: 'BTCUSDT', timeframe: '5m', anchor: ANCHOR, direction: 'earlier', limit: 2 });
    const second = await source.getCandlesticks({ instrument: 'BTCUSDT', timeframe: '5m', anchor: ANCHOR, direction: 'earlier', limit: 2 });

    expect(first).toEqual(second);
    expect(first.map((candle) => candle.timestamp)).toEqual([1653381000000, 1653381300000]);
    expect(first.map((candle) => candle.close)).toEqual([29350, 29480]);
    expect(first.map((candle) => candle.volume)).toEqual([12, 20]);
    // The caller gets its own instrument back, not the namespaced store key.
    expect(first.every((candle) => candle.instrument === 'BTCUSDT')).toBe(true);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    const url = fetchJson.mock.calls[0][0] as string;
    expect(url).toContain('https://api.bitget.com/api/v2/mix/market/candles');
    expect(url).toContain('productType=USDT-FUTURES');
    expect(url).toContain('symbol=BTCUSDT');
    expect(url).toContain('granularity=5m');
    expect(url).toContain('limit=2');
    expect(url).toContain(`endTime=${ANCHOR - 1}`);
  });

  it('bypasses the cache when refresh is requested so every scan gets fresh bars', async () => {
    const store = new CandlestickStore(':memory:');
    const fetchJson = vi.fn(async (_url: string) =>
      candlesResponse([bitgetRow(1653381000000, '29350', '12'), bitgetRow(1653381300000, '29480', '20')]),
    );
    const source = new BitgetCandleSource(store, fetchJson);

    await source.getCandlesticks({ instrument: 'BTCUSDT', timeframe: '5m', anchor: ANCHOR, direction: 'earlier', limit: 2 });
    expect(fetchJson).toHaveBeenCalledTimes(1);

    const refreshed = await source.getCandlesticks({ instrument: 'BTCUSDT', timeframe: '5m', anchor: ANCHOR, direction: 'earlier', limit: 2, refresh: true });

    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(refreshed.map((candle) => candle.timestamp)).toEqual([1653381000000, 1653381300000]);
  });

  // The duplicate-daily-bars regression: the retired Bitget source keyed the
  // shared store on the raw `base+USDT` symbol, colliding with Binance rows.
  it('namespaces store keys so Bitget rows never mix with Binance base+USDT rows', async () => {
    const store = new CandlestickStore(':memory:');
    const fetchJson = vi.fn(async (_url: string) =>
      candlesResponse([bitgetRow(1653381000000, '29350', '12'), bitgetRow(1653381300000, '29480', '20')]),
    );
    const source = new BitgetCandleSource(store, fetchJson);

    await source.getCandlesticks({ instrument: 'BTCUSDT', timeframe: '5m', anchor: ANCHOR, direction: 'earlier', limit: 2 });

    // Written under the namespaced key …
    expect(
      store.listBefore({ instrument: `${BITGET_KEY_PREFIX}BTCUSDT`, timeframe: '5m', before: ANCHOR, limit: 10 }).length,
    ).toBe(2);
    // … and invisible under the raw Binance-style key.
    expect(store.listBefore({ instrument: 'BTCUSDT', timeframe: '5m', before: ANCHOR, limit: 10 })).toEqual([]);
  });

  it('does not read another source\'s rows that share the base+USDT vocabulary', async () => {
    const store = new CandlestickStore(':memory:');
    // Pre-existing Binance-style rows under the raw symbol must be invisible to
    // the Bitget source: a cache read that saw them would return foreign bars.
    store.save([
      { instrument: 'BTCUSDT', timeframe: '5m' as const, timestamp: 1653381000000, open: 1, high: 2, low: 0.5, close: 999, volume: 10 },
      { instrument: 'BTCUSDT', timeframe: '5m' as const, timestamp: 1653381300000, open: 1, high: 2, low: 0.5, close: 998, volume: 10 },
    ]);
    const fetchJson = vi.fn(async (_url: string) =>
      candlesResponse([bitgetRow(1653381000000, '29350', '12'), bitgetRow(1653381300000, '29480', '20')]),
    );
    const source = new BitgetCandleSource(store, fetchJson);

    const candles = await source.getCandlesticks({ instrument: 'BTCUSDT', timeframe: '5m', anchor: ANCHOR, direction: 'earlier', limit: 2 });

    // The foreign cache was useless → a real fetch happened, and its bars won.
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(candles.map((candle) => candle.close)).toEqual([29350, 29480]);
  });

  it('drops the still-forming bar before it can reach the cache', async () => {
    const store = new CandlestickStore(':memory:');
    const fetchJson = vi.fn(async (_url: string) =>
      candlesResponse([
        bitgetRow(1653381000000, '29350', '12'),
        bitgetRow(1653381300000, '29480', '20'),
        bitgetRow(ANCHOR, '29500', '30'), // opens exactly at the anchor → still forming
      ]),
    );
    const source = new BitgetCandleSource(store, fetchJson);

    const candles = await source.getCandlesticks({ instrument: 'BTCUSDT', timeframe: '5m', anchor: ANCHOR, direction: 'earlier', limit: 3 });

    expect(candles.map((candle) => candle.timestamp)).toEqual([1653381000000, 1653381300000]);
    // And the forming bar never reached the store.
    expect(
      store.listBefore({ instrument: `${BITGET_KEY_PREFIX}BTCUSDT`, timeframe: '5m', before: ANCHOR + STEP, limit: 10 }).length,
    ).toBe(2);
  });

  it('requests later via startTime and clamps endTime to Bitget\'s 90-day span', async () => {
    const store = new CandlestickStore(':memory:');
    const dayStep = 24 * 60 * 60_000;
    const anchor = 1653381600000; // mid-day
    const fetchJson = vi.fn(async (_url: string) =>
      candlesResponse([bitgetRow(anchor + dayStep, '29500', '30'), bitgetRow(anchor + 2 * dayStep, '29510', '40')]),
    );
    const source = new BitgetCandleSource(store, fetchJson);

    await source.getCandlesticks({ instrument: 'BTCUSDT', timeframe: '1D', anchor, direction: 'later', limit: 3 });

    const url = fetchJson.mock.calls[0][0] as string;
    expect(url).toContain(`startTime=${anchor + 1}`);
    // 3 daily bars fit inside the 90-day cap, so the span is step × limit.
    expect(url).toContain(`endTime=${anchor + 3 * dayStep}`);
  });

  it('clamps a coarse-timeframe later window that would exceed the 90-day span', async () => {
    const store = new CandlestickStore(':memory:');
    const monthStep = 30 * 24 * 60 * 60_000;
    const anchor = 1653381600000;
    const fetchJson = vi.fn(async (_url: string) => []);
    const source = new BitgetCandleSource(store, fetchJson);

    // 150 monthly bars would span 4500 days — far past the 90-day cap.
    await source.getCandlesticks({ instrument: 'BTCUSDT', timeframe: '1M', anchor, direction: 'later', limit: 150 });

    const url = fetchJson.mock.calls[0][0] as string;
    expect(url).toContain(`endTime=${anchor + 90 * 24 * 60 * 60_000}`);
    expect(url).toContain(`startTime=${anchor + 1}`);
  });

  it('passes every ReviewTimeframe through as the Bitget granularity token', async () => {
    for (const timeframe of reviewTimeframes) {
      const store = new CandlestickStore(':memory:');
      const fetchJson = vi.fn(async (_url: string) => []);
      const source = new BitgetCandleSource(store, fetchJson);

      await source.getCandlesticks({ instrument: 'BTCUSDT', timeframe, anchor: ANCHOR, direction: 'earlier', limit: 1 });

      const url = fetchJson.mock.calls[0][0] as string;
      // Bitget mix tokens are identical to ReviewTimeframe, capital H/D included.
      expect(url).toContain(`granularity=${timeframe}`);
    }
  });

  it('throws a readable error on a Bitget business error (HTTP 200 body)', async () => {
    const store = new CandlestickStore(':memory:');
    const fetchJson = vi.fn(async () => ({ code: '400172', msg: 'Parameter verification failed', data: null }));
    const source = new BitgetCandleSource(store, fetchJson);

    await expect(
      source.getCandlesticks({ instrument: 'BTCUSDT', timeframe: '5m', anchor: ANCHOR, direction: 'earlier', limit: 2 }),
    ).rejects.toThrow('Bitget 行情错误 code=400172: Parameter verification failed');
  });

  it('returns an empty list when the window holds no candles (delisted or too deep)', async () => {
    const store = new CandlestickStore(':memory:');
    const fetchJson = vi.fn(async () => ({ code: '00000', msg: 'success', data: [] }));
    const source = new BitgetCandleSource(store, fetchJson);

    expect(
      await source.getCandlesticks({ instrument: 'GONEUSDT', timeframe: '5m', anchor: ANCHOR, direction: 'earlier', limit: 2 }),
    ).toEqual([]);
  });

  it('refreshes a stale "now" cache but reuses a fresh one', async () => {
    const store = new CandlestickStore(':memory:');
    const nowBoundary = Math.floor(Date.now() / STEP) * STEP;
    // Seed under the namespaced key: newest bar is 3 steps behind → stale.
    store.save([
      { instrument: `${BITGET_KEY_PREFIX}BTCUSDT`, timeframe: '5m' as const, timestamp: nowBoundary - 4 * STEP, open: 1, high: 2, low: 0.5, close: 1, volume: 10 },
      { instrument: `${BITGET_KEY_PREFIX}BTCUSDT`, timeframe: '5m' as const, timestamp: nowBoundary - 3 * STEP, open: 1, high: 2, low: 0.5, close: 1, volume: 10 },
    ]);
    const fetchJson = vi.fn(async () =>
      candlesResponse([bitgetRow(nowBoundary - STEP, '29480', '20'), bitgetRow(nowBoundary - 2 * STEP, '29350', '12')]),
    );
    const source = new BitgetCandleSource(store, fetchJson);

    await source.getCandlesticks({ instrument: 'BTCUSDT', timeframe: '5m', anchor: nowBoundary, direction: 'earlier', limit: 2 });
    expect(fetchJson).toHaveBeenCalledTimes(1);

    // The refetch saved current bars; a second "now" scan reuses them.
    await source.getCandlesticks({ instrument: 'BTCUSDT', timeframe: '5m', anchor: nowBoundary, direction: 'earlier', limit: 2 });
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it('always reuses the cache for a historical anchor', async () => {
    const store = new CandlestickStore(':memory:');
    store.save([
      { instrument: `${BITGET_KEY_PREFIX}BTCUSDT`, timeframe: '5m' as const, timestamp: ANCHOR - 2 * STEP, open: 1, high: 2, low: 0.5, close: 29350, volume: 10 },
      { instrument: `${BITGET_KEY_PREFIX}BTCUSDT`, timeframe: '5m' as const, timestamp: ANCHOR - STEP, open: 1, high: 2, low: 0.5, close: 29480, volume: 10 },
    ]);
    const fetchJson = vi.fn(async () => []);
    const source = new BitgetCandleSource(store, fetchJson);

    const candles = await source.getCandlesticks({ instrument: 'BTCUSDT', timeframe: '5m', anchor: ANCHOR, direction: 'earlier', limit: 2 });

    expect(fetchJson).not.toHaveBeenCalled();
    expect(candles.map((candle) => candle.close)).toEqual([29350, 29480]);
  });

  it('does not satisfy a cache hit that stops one bar short of the anchor', async () => {
    const store = new CandlestickStore(':memory:');
    // Two bars but the newest stops one full step before the anchor — the
    // permanent-hole case `coversAnchorBar` exists for.
    store.save([
      { instrument: `${BITGET_KEY_PREFIX}BTCUSDT`, timeframe: '5m' as const, timestamp: ANCHOR - 3 * STEP, open: 1, high: 2, low: 0.5, close: 1, volume: 10 },
      { instrument: `${BITGET_KEY_PREFIX}BTCUSDT`, timeframe: '5m' as const, timestamp: ANCHOR - 2 * STEP, open: 1, high: 2, low: 0.5, close: 1, volume: 10 },
    ]);
    const fetchJson = vi.fn(async () =>
      candlesResponse([bitgetRow(ANCHOR - STEP, '29480', '20'), bitgetRow(ANCHOR - 2 * STEP, '29350', '12')]),
    );
    const source = new BitgetCandleSource(store, fetchJson);

    await source.getCandlesticks({ instrument: 'BTCUSDT', timeframe: '5m', anchor: ANCHOR, direction: 'earlier', limit: 2 });

    expect(fetchJson).toHaveBeenCalledTimes(1);
  });
});
