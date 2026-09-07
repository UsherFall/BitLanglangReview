import { describe, expect, it, vi } from 'vitest';
import { BitgetCandleSource } from '../src/server/bitget-candles';
import { CandlestickStore } from '../src/server/candlestick-store';

// Bitget v2 mix candlestick row:
// [timestamp(ms), open, high, low, close, baseVolume, quoteVolume]
function row(openTime: number, close: string, volume: string): string[] {
  return [String(openTime), '1', '2', '0.5', close, volume, '100'];
}

function payload(...rows: string[][]) {
  return { code: '00000', msg: 'success', data: rows };
}

const STEP = 5 * 60_000;
const ANCHOR = 1653381600000; // 2022-05-24T10:40:00.000Z, a 5m boundary.

describe('BitgetCandleSource', () => {
  it('maps rows, requests earlier via endTime, and reuses the cache', async () => {
    const store = new CandlestickStore(':memory:');
    const fetchJson = vi.fn(async (_url: string) => payload(
      row(1653381000000, '29350', '12'), // 10:30
      row(1653381300000, '29480', '20'), // 10:35
    ));
    const source = new BitgetCandleSource(store, fetchJson);

    const first = await source.getCandlesticks({ instrument: 'BTCUSDT', timeframe: '5m', anchor: ANCHOR, direction: 'earlier', limit: 2 });
    const second = await source.getCandlesticks({ instrument: 'BTCUSDT', timeframe: '5m', anchor: ANCHOR, direction: 'earlier', limit: 2 });

    expect(first).toEqual(second);
    expect(first.map((candle) => candle.timestamp)).toEqual([1653381000000, 1653381300000]);
    expect(first.map((candle) => candle.close)).toEqual([29350, 29480]);
    expect(first.map((candle) => candle.volume)).toEqual([12, 20]);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    const url = fetchJson.mock.calls[0][0] as string;
    expect(url).toContain('https://api.bitget.com/api/v2/mix/market/candles');
    expect(url).toContain('productType=USDT-FUTURES');
    expect(url).toContain('symbol=BTCUSDT');
    expect(url).toContain('granularity=5m');
    expect(url).toContain(`endTime=${ANCHOR - 1}`);
  });

  it('drops the still-forming bar (openTime + step > anchor) before saving', async () => {
    const store = new CandlestickStore(':memory:');
    const fetchJson = vi.fn(async (_url: string) => payload(
      row(1653381000000, '29350', '12'), // 10:30 completed
      row(1653381300000, '29480', '20'), // 10:35 still forming when anchor = 10:35
    ));
    const source = new BitgetCandleSource(store, fetchJson);

    const candles = await source.getCandlesticks({ instrument: 'BTCUSDT', timeframe: '5m', anchor: 1653381300000, direction: 'earlier', limit: 2 });

    expect(candles.map((candle) => candle.timestamp)).toEqual([1653381000000]);
  });

  it('requests later candles via a bounded startTime+endTime window and keeps bars after the anchor', async () => {
    const store = new CandlestickStore(':memory:');
    const fetchJson = vi.fn(async (_url: string) => payload(
      row(1653381900000, '29500', '30'), // 10:45
      row(1653382200000, '29540', '40'), // 10:50
    ));
    const source = new BitgetCandleSource(store, fetchJson);

    const candles = await source.getCandlesticks({ instrument: 'BTCUSDT', timeframe: '5m', anchor: 1653381600000, direction: 'later', limit: 2 });

    expect(candles.map((candle) => candle.timestamp)).toEqual([1653381900000, 1653382200000]);
    const url = fetchJson.mock.calls[0][0] as string;
    // The window must cap endTime so the endpoint returns the block adjacent to
    // the anchor instead of the newest bars in [anchor, now].
    expect(url).toContain(`startTime=${ANCHOR + 1}`);
    expect(url).toContain(`endTime=${ANCHOR + STEP * 2}`);
  });

  it('clamps a coarse-timeframe later window to Bitget 90-day span', async () => {
    const store = new CandlestickStore(':memory:');
    const fetchJson = vi.fn(async (_url: string) => payload());
    const source = new BitgetCandleSource(store, fetchJson);

    // 1D at limit 150 would span 150 days; Bitget rejects spans > 90 days.
    await source.getCandlesticks({ instrument: 'BTCUSDT', timeframe: '1D', anchor: ANCHOR, direction: 'later', limit: 150 });

    const url = fetchJson.mock.calls[0][0] as string;
    const maxRange = 90 * 24 * 60 * 60_000;
    expect(url).toContain(`startTime=${ANCHOR + 1}`);
    expect(url).toContain(`endTime=${ANCHOR + maxRange}`);
  });

  it('drops a containing daily bar (ts > anchor) even when the API returns it', async () => {
    const store = new CandlestickStore(':memory:');
    const fetchJson = vi.fn(async (_url: string) => payload(
      row(Date.UTC(2022, 4, 23, 16), '1', '1'), // the UTC+8 day containing the anchor
      row(Date.UTC(2022, 4, 24, 16), '2', '2'), // the first full day after the anchor
    ));
    const source = new BitgetCandleSource(store, fetchJson);
    const anchor = Date.UTC(2022, 4, 24, 0, 30); // 2022-05-24T00:30:00Z

    const candles = await source.getCandlesticks({ instrument: 'BTCUSDT', timeframe: '1D', anchor, direction: 'later', limit: 2 });

    expect(candles.map((candle) => candle.timestamp)).toEqual([Date.UTC(2022, 4, 24, 16)]);
  });

  it('returns an empty list for an empty payload and does not throw', async () => {
    const store = new CandlestickStore(':memory:');
    const fetchJson = vi.fn(async (_url: string) => payload());
    const source = new BitgetCandleSource(store, fetchJson);

    const candles = await source.getCandlesticks({ instrument: 'BTCUSDT', timeframe: '5m', anchor: ANCHOR, direction: 'earlier', limit: 2 });

    expect(candles).toEqual([]);
  });

  it('throws a readable error on a Bitget business error code', async () => {
    const store = new CandlestickStore(':memory:');
    const fetchJson = vi.fn(async (_url: string) => ({ code: '40013', msg: 'invalid symbol', data: [] }));
    const source = new BitgetCandleSource(store, fetchJson);

    await expect(source.getCandlesticks({ instrument: 'NOPEUSDT', timeframe: '5m', anchor: ANCHOR, direction: 'earlier', limit: 2 }))
      .rejects.toThrow(/40013.*invalid symbol/);
  });

  it('bypasses the cache when refresh is requested', async () => {
    const store = new CandlestickStore(':memory:');
    const fetchJson = vi.fn(async (_url: string) => payload(
      row(1653381000000, '29350', '12'),
      row(1653381300000, '29480', '20'),
    ));
    const source = new BitgetCandleSource(store, fetchJson);

    await source.getCandlesticks({ instrument: 'BTCUSDT', timeframe: '5m', anchor: ANCHOR, direction: 'earlier', limit: 2 });
    expect(fetchJson).toHaveBeenCalledTimes(1);

    const refreshed = await source.getCandlesticks({ instrument: 'BTCUSDT', timeframe: '5m', anchor: ANCHOR, direction: 'earlier', limit: 2, refresh: true });

    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(refreshed.map((candle) => candle.timestamp)).toEqual([1653381000000, 1653381300000]);
  });

  it('refreshes a stale cache for a "now" read but reuses a fresh one', async () => {
    const store = new CandlestickStore(':memory:');
    const nowBoundary = Math.floor(Date.now() / STEP) * STEP;
    store.save([
      { instrument: 'BTCUSDT', timeframe: '5m' as const, timestamp: nowBoundary - 4 * STEP, open: 1, high: 2, low: 0.5, close: 1, volume: 10 },
      { instrument: 'BTCUSDT', timeframe: '5m' as const, timestamp: nowBoundary - 3 * STEP, open: 1, high: 2, low: 0.5, close: 1, volume: 10 },
    ]);
    const fetchJson = vi.fn(async (_url: string) => payload(
      row(nowBoundary - 2 * STEP, '29350', '12'),
      row(nowBoundary - STEP, '29480', '20'),
    ));
    const source = new BitgetCandleSource(store, fetchJson);

    // Stale (newest bar 3 steps behind the current boundary) → a fresh fetch.
    await source.getCandlesticks({ instrument: 'BTCUSDT', timeframe: '5m', anchor: nowBoundary, direction: 'earlier', limit: 2 });
    expect(fetchJson).toHaveBeenCalledTimes(1);

    // The refetch saved current completed bars; the next "now" read reuses them.
    await source.getCandlesticks({ instrument: 'BTCUSDT', timeframe: '5m', anchor: nowBoundary, direction: 'earlier', limit: 2 });
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it('keys the cache on the native Bitget symbol so OKX rows never collide', async () => {
    const store = new CandlestickStore(':memory:');
    const fetchJson = vi.fn(async (_url: string) => payload(
      row(1653381000000, '29350', '12'),
      row(1653381300000, '29480', '20'),
    ));
    const source = new BitgetCandleSource(store, fetchJson);

    await source.getCandlesticks({ instrument: 'BTCUSDT', timeframe: '5m', anchor: ANCHOR, direction: 'earlier', limit: 2 });

    // An OKX candle for the same chart instrument under a different key is kept apart.
    store.save([{ instrument: 'BTC-USDT-SWAP', timeframe: '5m' as const, timestamp: 1653381000000, open: 9, high: 9, low: 9, close: 9, volume: 9 }]);
    const okxRows = store.listBefore({ instrument: 'BTC-USDT-SWAP', timeframe: '5m', before: ANCHOR, limit: 10 });
    expect(okxRows).toHaveLength(1);

    // The Bitget source still reads only its own symbol's rows.
    const candles = await source.getCandlesticks({ instrument: 'BTCUSDT', timeframe: '5m', anchor: ANCHOR, direction: 'earlier', limit: 2 });
    expect(candles.map((candle) => candle.close)).toEqual([29350, 29480]);
  });
});
