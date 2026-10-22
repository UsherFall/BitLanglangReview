import { describe, expect, it, vi } from 'vitest';
import { BITGET_KEY_PREFIX, BitgetCandleSource } from '../src/server/bitget-candles';
import { CandlestickStore } from '../src/server/candlestick-store';

// Bitget mix candle row: [timestamp(ms), open, high, low, close, baseVolume, quoteVolume]
function bitgetRow(timestamp: number, close: string, volume: string): string[] {
  return [String(timestamp), '1', '2', '0.5', close, volume, '100'];
}

function candlesResponse(rows: string[][]): { code: string; msg: string; data: string[][] } {
  return { code: '00000', msg: 'success', data: rows };
}

const STEP = 5 * 60_000;
const ANCHOR = 1653381600000; // 2022-05-24T10:40:00.000Z, a 5m boundary.

/** Ascending bar opens, newest at `ANCHOR - STEP`, going back `count` bars. */
function series(count: number): number[] {
  return Array.from({ length: count }, (_, index) => ANCHOR - STEP * (index + 1)).sort((a, b) => a - b);
}

/**
 * A faithful stand-in for the endpoint's measured behaviour:
 *  - never more than 90 rows whatever `limit` says (measured on 1D: `limit=200`
 *    still returns 90), which is why one request cannot satisfy a long `limit`;
 *  - the two endpoints read the window on DIFFERENT bar times (measured 10/21):
 *    `/candles` on OPEN times, `/history-candles` on CLOSE times — the latter
 *    is why the earlier walk's cursor must be `oldest` and not `oldest - 1`;
 *  - `startTime` is an EXCLUSIVE lower bound on that bar time, and a bounded
 *    window answers with the NEWEST `limit` rows inside it (measured 10/21:
 *    a startTime equal to a bar's open excludes that bar — modelling it as
 *    inclusive+oldest let the first-bar hole bug slip through this suite).
 */
const PAGE_CAP = 90;

function fakeBitget(all: number[]) {
  return vi.fn(async (url: string) => {
    const parsed = new URL(url);
    const endTime = Number(parsed.searchParams.get('endTime'));
    const startTime = parsed.searchParams.get('startTime');
    const limit = Number(parsed.searchParams.get('limit'));
    const isHistory = parsed.pathname.endsWith('/history-candles');
    // `/candles` reads the window on open times, `/history-candles` on close times.
    const eligible = all.filter((timestamp) => {
      const bound = isHistory ? timestamp + STEP : timestamp;
      return (startTime === null || bound > Number(startTime)) && bound <= endTime;
    });
    // A bounded window returns the NEWEST rows inside it; an unbounded one too.
    const rows = eligible.slice(-Math.min(limit, PAGE_CAP));
    return candlesResponse(rows.map((timestamp) => bitgetRow(timestamp, '1', '1')));
  });
}

const pageUrls = (fetchJson: ReturnType<typeof fakeBitget>) => fetchJson.mock.calls.map((call) => new URL(call[0] as string));

describe('BitgetCandleSource paging', () => {
  it('pages back until `limit` bars are available, newest page via /candles', async () => {
    const store = new CandlestickStore(':memory:');
    const fetchJson = fakeBitget(series(400));
    const source = new BitgetCandleSource(store, fetchJson);

    const candles = await source.getCandlesticks({
      instrument: 'BTCUSDT', timeframe: '5m', anchor: ANCHOR, direction: 'earlier', limit: 200, refresh: true, allowPaging: true,
    });

    // Exactly `limit` bars — the endpoint could only ever give 90 at a time.
    expect(candles).toHaveLength(200);
    expect(candles[candles.length - 1].timestamp).toBe(ANCHOR - STEP);
    // …and CONTIGUOUS: paging must not leave a hole at a page boundary. A
    // one-bar gap makes `contiguousCandles` stop, so the cursor never advances
    // and the same page is refetched forever (measured: 174 instruments stuck
    // at exactly 180 bars, 19 minutes, zero rows written).
    for (let i = 1; i < candles.length; i += 1) {
      expect(candles[i].timestamp - candles[i - 1].timestamp).toBe(STEP);
    }

    const urls = pageUrls(fetchJson);
    expect(urls).toHaveLength(3); // 90 + 90 + 20
    // The FIRST page is the single-request path's endpoint and window, so the
    // newest 90 bars are byte-identical to what production fetches.
    expect(urls[0].pathname).toBe('/api/v2/mix/market/candles');
    expect(urls[0].searchParams.get('endTime')).toBe(String(ANCHOR - 1));
    // Older pages come from the deeper-history endpoint.
    for (const url of urls.slice(1)) expect(url.pathname).toBe('/api/v2/mix/market/history-candles');
    // Every page asks for a legal size.
    for (const url of urls) expect(Number(url.searchParams.get('limit'))).toBeLessThanOrEqual(90);
    // And the cursor strictly advances, so the loop cannot spin.
    const ends = urls.map((url) => Number(url.searchParams.get('endTime')));
    expect(ends[1]).toBeLessThan(ends[0]);
    expect(ends[2]).toBeLessThan(ends[1]);
  });

  it('stops when the exchange runs out of history (recently listed instrument)', async () => {
    const store = new CandlestickStore(':memory:');
    const fetchJson = fakeBitget(series(40));
    const source = new BitgetCandleSource(store, fetchJson);

    const candles = await source.getCandlesticks({
      instrument: 'NEWUSDT', timeframe: '5m', anchor: ANCHOR, direction: 'earlier', limit: 200, refresh: true, allowPaging: true,
    });

    // 40 real bars, then an empty page ends the walk: two requests, not `maxPages`.
    expect(candles).toHaveLength(40);
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it('re-reads ONLY the newest page when the cache already holds the history', async () => {
    const store = new CandlestickStore(':memory:');
    const fetchJson = fakeBitget(series(400));
    const source = new BitgetCandleSource(store, fetchJson);
    const request = {
      instrument: 'BTCUSDT', timeframe: '5m' as const, anchor: ANCHOR, direction: 'earlier' as const,
      limit: 200, refresh: true, allowPaging: true,
    };

    await source.getCandlesticks(request);
    expect(fetchJson).toHaveBeenCalledTimes(3);

    // A refresh is about the bar that can still change, so the warm cache means
    // exactly one more request — this is what keeps a long window affordable.
    await source.getCandlesticks(request);
    expect(fetchJson).toHaveBeenCalledTimes(4);
    const last = new URL(fetchJson.mock.calls[3][0] as string);
    expect(last.pathname).toBe('/api/v2/mix/market/candles');
    expect(last.searchParams.get('endTime')).toBe(String(ANCHOR - 1));
  });

  it('keeps the single-request behaviour when allowPaging is absent', async () => {
    const store = new CandlestickStore(':memory:');
    const fetchJson = fakeBitget(series(400));
    const source = new BitgetCandleSource(store, fetchJson);

    const candles = await source.getCandlesticks({
      instrument: 'BTCUSDT', timeframe: '5m', anchor: ANCHOR, direction: 'earlier', limit: 200, refresh: true,
    });

    // Exactly one request and whatever it could carry: the coin scan asks 100
    // bars on 1D but the endpoint caps at 90, so paging must NOT be implicit —
    // an extra bar would move `coarseStructure`'s `posRange`.
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(candles.length).toBeLessThanOrEqual(90);
  });

  it('pages FORWARD until `limit` bars are available (10/21)', async () => {
    const store = new CandlestickStore(':memory:');
    // 400 bars AFTER the anchor — enough to need more than one 90-bar page.
    const forward = Array.from({ length: 400 }, (_, index) => ANCHOR + STEP * (index + 1)).sort((a, b) => a - b);
    const fetchJson = fakeBitget(forward);
    const source = new BitgetCandleSource(store, fetchJson);

    const candles = await source.getCandlesticks({
      instrument: 'BTCUSDT', timeframe: '5m', anchor: ANCHOR, direction: 'later', limit: 200, allowPaging: true,
    });

    // The 90-bar page cap means one request cannot satisfy a 200-bar window.
    expect(candles.length).toBeGreaterThan(90);
    expect(fetchJson.mock.calls.length).toBeGreaterThan(1);
    // The first page starts right after the anchor and every later page starts
    // after the newest bar held (no gaps, no re-reads of the same window).
    const first = new URL(fetchJson.mock.calls[0][0] as string);
    expect(first.searchParams.get('startTime')).toBe(String(ANCHOR));
    expect(first.searchParams.get('endTime')).toBe(String(ANCHOR + 90 * STEP));
    const second = new URL(fetchJson.mock.calls[1][0] as string);
    expect(Number(second.searchParams.get('startTime'))).toBeGreaterThan(ANCHOR);
  });

  it('keeps the single-request behaviour for a `later` read when allowPaging is absent', async () => {
    const store = new CandlestickStore(':memory:');
    const fetchJson = fakeBitget(series(400));
    const source = new BitgetCandleSource(store, fetchJson);

    await source.getCandlesticks({
      instrument: 'BTCUSDT', timeframe: '5m', anchor: ANCHOR, direction: 'later', limit: 200,
    });

    expect(fetchJson).toHaveBeenCalledTimes(1);
    const url = new URL(fetchJson.mock.calls[0][0] as string);
    expect(url.searchParams.get('startTime')).toBe(String(ANCHOR + 1));
  });

  it('does not re-read the newest page when the cache covers it and no refresh is asked', async () => {
    const store = new CandlestickStore(':memory:');
    const fetchJson = fakeBitget(series(400));
    const source = new BitgetCandleSource(store, fetchJson);

    // Warm the cache through the single-request path (90 bars, anchor covered).
    await source.getCandlesticks({ instrument: 'BTCUSDT', timeframe: '5m', anchor: ANCHOR, direction: 'earlier', limit: 90 });
    expect(fetchJson).toHaveBeenCalledTimes(1);

    const candles = await source.getCandlesticks({
      instrument: 'BTCUSDT', timeframe: '5m', anchor: ANCHOR, direction: 'earlier', limit: 180, allowPaging: true,
    });

    expect(candles).toHaveLength(180);
    // Only the missing older 90 were fetched; the newest page was already good.
    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(new URL(fetchJson.mock.calls[1][0] as string).pathname).toBe('/api/v2/mix/market/history-candles');
  });

  // 10/22: a `later` walk that reaches the present receives the still-forming
  // bar in its pages (the review `initial` load pulls 150 bars AFTER the entry
  // — on 1D that is ~150 days, so every recent trade charts up to the current
  // bar). The forming bar must be dropped BEFORE the cache: saved once, it
  // freezes mid-series forever — a walk anchored AT it excludes it
  // (`timestamp > anchor` is false for the row itself) and the cache-hit gates
  // never refetch it.
  it('drops the still-forming bar when the paged later walk reaches the present', async () => {
    const store = new CandlestickStore(':memory:');
    const forming = Math.floor(Date.now() / STEP) * STEP; // the bar currently forming
    const anchor = forming - 5 * STEP;
    const fetchJson = fakeBitget([forming - 4 * STEP, forming - 3 * STEP, forming - 2 * STEP, forming - STEP, forming]);
    const source = new BitgetCandleSource(store, fetchJson);

    const candles = await source.getCandlesticks({
      instrument: 'BTCUSDT', timeframe: '5m', anchor, direction: 'later', limit: 10, allowPaging: true,
    });

    // Only CLOSED bars come back — the chart ends at the newest closed bar,
    // same as the OKX/Binance charts of the same product.
    const closed = [forming - 4 * STEP, forming - 3 * STEP, forming - 2 * STEP, forming - STEP];
    expect(candles.map((candle) => candle.timestamp)).toEqual(closed);
    // The forming bar never reached the store.
    expect(
      store.listAfter({ instrument: `${BITGET_KEY_PREFIX}BTCUSDT`, timeframe: '5m', after: anchor, limit: 10 }).map((candle) => candle.timestamp),
    ).toEqual(closed);
    // The walk terminates through the existing "exchange has no more" path:
    // the first page, then a /candles page holding ONLY the forming bar
    // (added=0), then the /history-candles fallback which has nothing new.
    expect(fetchJson).toHaveBeenCalledTimes(3);
  });
});
