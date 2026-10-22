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

/** Ascending run of `count` bars opening at `start`, `start+step`, … */
function barRun(start: number, count: number, step = STEP): string[][] {
  return Array.from({ length: count }, (_, index) => bitgetRow(start + index * step, String(29350 + index), '10'));
}

/** Ascending run of `count` bars that had all CLOSED by `end` — the `/history-candles` window reading. */
function closedBarRun(end: number, count: number, step = STEP): string[][] {
  return barRun(end - count * step, count, step);
}

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

  // `/candles` keeps only a rolling window per granularity. When the anchor
  // predates it the first page answers empty; the walk used to give up with no
  // cursor and never ask `/history-candles` — old trades' intraday charts were
  // blank, and 1D scroll-back died at the window edge (~2023 on 1D).
  it('seeds the earlier walk from history-candles when /candles has nothing for an old anchor', async () => {
    const store = new CandlestickStore(':memory:');
    const fetchJson = vi.fn(async (url: string) =>
      url.includes('history-candles')
        ? candlesResponse(closedBarRun(ANCHOR, 90))
        : candlesResponse([]),
    );
    const source = new BitgetCandleSource(store, fetchJson);

    const candles = await source.getCandlesticks({ instrument: 'BTCUSDT', timeframe: '5m', anchor: ANCHOR, direction: 'earlier', limit: 90, allowPaging: true });

    expect(candles).toHaveLength(90);
    // The newest bar is the one closing exactly at the anchor (closed-bar equality is inclusive).
    expect(candles.at(-1)!.timestamp).toBe(ANCHOR - STEP);
    expect(candles[0].timestamp).toBe(ANCHOR - 90 * STEP);
    // First ask /candles, then seed history at endTime = anchor + step.
    // The history endpoint reads the window on CLOSE times, so the seed must
    // reach the containing bar's own close to admit the bar that CONTAINS the
    // anchor (10/22) — `endTime = anchor` left that bar out.
    expect(fetchJson).toHaveBeenCalledTimes(2);
    const [candlesUrl, historyUrl] = fetchJson.mock.calls.map((call) => call[0] as string);
    expect(candlesUrl).toContain('/candles');
    expect(candlesUrl).toContain(`endTime=${ANCHOR - 1}`);
    expect(historyUrl).toContain('history-candles');
    expect(historyUrl).toContain(`endTime=${ANCHOR + STEP}`);
    expect(historyUrl).not.toContain('startTime');
  });

  // 10/22 regression: an entry that is NOT on a bar boundary used to leave a
  // one-bar hole right under the entry marker — the window jumped from the bar
  // before the entry to the bar after it, so the entry had no candle of its own
  // and the series looked broken ("开单标注之后的 K 线和开单位置的 K 线连不上").
  //
  // Two rules produce that hole, and both are asserted here:
  //  1. `earlier` must keep the bar CONTAINING the anchor (`open < anchor`),
  //     like OKX and Binance do — judging closure against the ANCHOR
  //     (`open + step <= anchor`) dropped exactly that bar;
  //  2. the `/history-candles` seed must reach that bar's own close
  //     (`endTime = anchor + step`), because that endpoint reads the window on
  //     CLOSE times.
  it('keeps the bar containing an off-boundary entry, with no hole under the marker', async () => {
    const store = new CandlestickStore(':memory:');
    // An entry 3m54s into a bar — the shape that produced the hole.
    const anchor = ANCHOR + 3 * 60_000 + 54_000;
    const containing = ANCHOR; // the bar the entry sits in
    // A faithful stand-in: `/candles` reads the window on OPEN times,
    // `/history-candles` on CLOSE times, and `startTime` is exclusive.
    const fetchJson = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      const endTime = Number(parsed.searchParams.get('endTime'));
      const startTime = parsed.searchParams.get('startTime');
      const isHistory = parsed.pathname.endsWith('/history-candles');
      const all = barRun(containing - 120 * STEP, 240).map((row) => Number(row[0]));
      const eligible = all.filter((timestamp) => {
        const bound = isHistory ? timestamp + STEP : timestamp;
        return (startTime === null || bound > Number(startTime)) && bound <= endTime;
      });
      return candlesResponse(eligible.slice(-90).map((timestamp) => bitgetRow(timestamp, '1', '1')));
    });
    const source = new BitgetCandleSource(store, fetchJson);

    const candles = await source.getCandlesticks({
      instrument: 'BTCUSDT', timeframe: '5m', anchor, direction: 'earlier', limit: 90, allowPaging: true,
    });

    // The bar the entry sits in is present …
    expect(candles.map((candle) => candle.timestamp)).toContain(containing);
    // … and the run is contiguous: no hole, no doubled step.
    for (let index = 1; index < candles.length; index += 1) {
      expect(candles[index].timestamp - candles[index - 1].timestamp).toBe(STEP);
    }
  });

  // The `earlier` filter must judge closure by the BAR, not by the anchor: a
  // review's anchor is a trade entry in the past, so the bar containing it
  // closed long ago — but the old rule (`open + step <= anchor`) dropped it
  // anyway, because the entry sits BEFORE the bar's close.
  it('keeps a closed bar whose close is after the anchor', async () => {
    const store = new CandlestickStore(':memory:');
    const anchor = ANCHOR + 60_000; // 1 minute into the bar opening at ANCHOR
    const fetchJson = vi.fn(async () => candlesResponse([bitgetRow(ANCHOR, '29500', '30')]));
    const source = new BitgetCandleSource(store, fetchJson);

    const candles = await source.getCandlesticks({ instrument: 'BTCUSDT', timeframe: '5m', anchor, direction: 'earlier', limit: 3 });

    expect(candles.map((candle) => candle.timestamp)).toEqual([ANCHOR]);
  });

  // The still-forming bar must still be kept out of the cache: the judgement
  // moved from the anchor to the bar's own close, but the bar's close is what
  // decides it now.
  it('still drops the still-forming bar before it can reach the cache', async () => {
    const store = new CandlestickStore(':memory:');
    const now = Date.now();
    const forming = Math.floor(now / STEP) * STEP; // opens now → still forming
    const fetchJson = vi.fn(async () => candlesResponse([bitgetRow(forming, '29500', '30')]));
    const source = new BitgetCandleSource(store, fetchJson);

    const candles = await source.getCandlesticks({
      instrument: 'BTCUSDT', timeframe: '5m', anchor: forming + STEP, direction: 'earlier', limit: 3,
    });

    expect(candles).toEqual([]);
  });

  // Bitget's startTime is an EXCLUSIVE bound on the open time. The old first
  // page (anchor+1, anchor+1+span] excluded the very first bar after the
  // anchor whenever anchor+1 landed on a grid point (an entry exactly on a bar
  // boundary), and the contiguity gate cut the whole later half to [].
  it('starts the paged later window at the anchor so the first bar after it survives', async () => {
    const store = new CandlestickStore(':memory:');
    const anchor = ANCHOR - 1; // 1 ms below a 5m boundary — the broken case.
    // The endpoint's answer for (anchor, anchor+90*STEP]: the grid bars ANCHOR .. ANCHOR+89*STEP.
    const fetchJson = vi.fn(async (_url: string) => candlesResponse(barRun(ANCHOR, 90)));
    const source = new BitgetCandleSource(store, fetchJson);

    const candles = await source.getCandlesticks({ instrument: 'BTCUSDT', timeframe: '5m', anchor, direction: 'later', limit: 90, allowPaging: true });

    expect(candles).toHaveLength(90);
    // The bar the old anchor+1 window excluded — first grid bar after the anchor.
    expect(candles[0].timestamp).toBe(ANCHOR);
    expect(candles.at(-1)!.timestamp).toBe(ANCHOR + 89 * STEP);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    const url = fetchJson.mock.calls[0][0] as string;
    expect(url).toContain(`startTime=${anchor}`);
    expect(url).toContain(`endTime=${anchor + 90 * STEP}`);
  });

  it('seeds the paged later walk from history-candles when /candles cannot serve the anchor', async () => {
    const store = new CandlestickStore(':memory:');
    const anchor = ANCHOR - 1;
    const fetchJson = vi.fn(async (url: string) =>
      url.includes('history-candles')
        ? candlesResponse(barRun(ANCHOR, 90))
        : candlesResponse([]),
    );
    const source = new BitgetCandleSource(store, fetchJson);

    const candles = await source.getCandlesticks({ instrument: 'BTCUSDT', timeframe: '5m', anchor, direction: 'later', limit: 90, allowPaging: true });

    expect(candles).toHaveLength(90);
    expect(candles[0].timestamp).toBe(ANCHOR);
    // The history forward page is endTime-only: cursor + (perPage+1) steps lands the 90 bars after the anchor.
    expect(fetchJson).toHaveBeenCalledTimes(2);
    const historyUrl = fetchJson.mock.calls[1][0] as string;
    expect(historyUrl).toContain('history-candles');
    expect(historyUrl).toContain(`endTime=${anchor + 91 * STEP}`);
    expect(historyUrl).not.toContain('startTime');
  });

  it('continues the paged later walk from history-candles when /candles runs dry mid-walk', async () => {
    const store = new CandlestickStore(':memory:');
    const fetchJson = vi.fn(async (url: string) => {
      if (url.includes('history-candles')) {
        const endTime = Number(new URL(url).searchParams.get('endTime'));
        return candlesResponse(closedBarRun(endTime, 90));
      }
      // /candles serves only the first page — its rolling window ends there.
      const startTime = Number(new URL(url).searchParams.get('startTime'));
      return startTime <= ANCHOR ? candlesResponse(barRun(ANCHOR + STEP, 90)) : candlesResponse([]);
    });
    const source = new BitgetCandleSource(store, fetchJson);

    const candles = await source.getCandlesticks({ instrument: 'BTCUSDT', timeframe: '5m', anchor: ANCHOR, direction: 'later', limit: 150, allowPaging: true });

    expect(candles).toHaveLength(150);
    // The two pages splice into one contiguous run.
    for (let index = 1; index < candles.length; index += 1) {
      expect(candles[index].timestamp - candles[index - 1].timestamp).toBe(STEP);
    }
    const historyUrl = fetchJson.mock.calls.map((call) => call[0] as string).find((url) => url.includes('history-candles'));
    expect(historyUrl).toBeDefined();
    expect(historyUrl).not.toContain('startTime');
  });

  it('clamps the paged later window to Bitget\'s 90-day span on coarse timeframes', async () => {
    const store = new CandlestickStore(':memory:');
    const fetchJson = vi.fn(async (_url: string) => candlesResponse([]));
    const source = new BitgetCandleSource(store, fetchJson);

    await source.getCandlesticks({ instrument: 'BTCUSDT', timeframe: '1W', anchor: ANCHOR, direction: 'later', limit: 150, allowPaging: true });

    // 90 weekly bars would span 630 days — past Bitget's 90-day request cap.
    const url = fetchJson.mock.calls[0][0] as string;
    expect(url).toContain(`startTime=${ANCHOR}`);
    expect(url).toContain(`endTime=${ANCHOR + 90 * 24 * 60 * 60_000}`);
  });
});
