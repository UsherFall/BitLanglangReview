import { describe, expect, it } from 'vitest';
import type { Candlestick } from '../src/domain/candlestick';
import type { CandleRequest, CandleSource } from '../src/server/market-data';
import {
  fetchReviewCandles,
  ReviewCandleUnavailableError,
  type ReviewCandleRequest,
} from '../src/server/review-candle-source';

const ENTRY_TIME = '2026-09-07T15:52:09+08:00';
const ANCHOR = Date.UTC(2026, 8, 7, 8, 0, 0);
const STEP = 15 * 60 * 1000;

function candle(instrument: string, timestamp: number): Candlestick {
  return { instrument, timeframe: '15m', timestamp, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 };
}

/** A CandleSource stub that records every request it received. */
function stubSource(handler: (request: CandleRequest) => Candlestick[]): { source: CandleSource; calls: CandleRequest[] } {
  const calls: CandleRequest[] = [];
  return {
    calls,
    source: {
      async getCandlesticks(request) {
        calls.push(request);
        return handler(request);
      },
    },
  };
}

function buildRequest(overrides: Partial<ReviewCandleRequest> = {}): ReviewCandleRequest {
  return {
    binance: stubSource(() => []).source,
    okx: stubSource(() => []).source,
    instrument: 'ZEC-USDT-SWAP',
    timeframe: '15m',
    entryTime: ENTRY_TIME,
    mode: 'initial',
    anchor: ANCHOR,
    binanceStatuses: async () => new Map(),
    ...overrides,
  };
}

async function captureError(request: ReviewCandleRequest): Promise<unknown> {
  return fetchReviewCandles(request).then(
    () => null,
    (error: unknown) => error,
  );
}

describe('fetchReviewCandles', () => {
  it('serves a tradable instrument from Binance without touching OKX', async () => {
    const binance = stubSource(() => [candle('ZECUSDT', ANCHOR)]);
    const okx = stubSource(() => [candle('ZEC-USDT-SWAP', ANCHOR)]);

    const candles = await fetchReviewCandles(
      buildRequest({ binance: binance.source, okx: okx.source, binanceStatuses: async () => new Map([['ZECUSDT', 'TRADING']]) }),
    );

    expect(candles).toEqual([candle('ZECUSDT', ANCHOR)]);
    expect(binance.calls).toHaveLength(2);
    expect(okx.calls).toHaveLength(0);
  });

  it('uses the alias when Binance settled the original symbol', async () => {
    const binance = stubSource((request) => [candle(request.instrument, ANCHOR)]);
    const okx = stubSource(() => [candle('RAY-USDT-SWAP', ANCHOR)]);

    const candles = await fetchReviewCandles(
      buildRequest({
        binance: binance.source,
        okx: okx.source,
        instrument: 'RAY-USDT-SWAP',
        binanceStatuses: async () => new Map([['RAYUSDT', 'SETTLING'], ['RAYSOLUSDT', 'TRADING']]),
      }),
    );

    expect(candles).toEqual([candle('RAYSOLUSDT', ANCHOR)]);
    expect(new Set(binance.calls.map((call) => call.instrument))).toEqual(new Set(['RAYSOLUSDT']));
    expect(okx.calls).toHaveLength(0);
  });

  it('skips a SETTLING contract without a request and serves the instrument from OKX', async () => {
    const binance = stubSource(() => [candle('RAYUSDT', ANCHOR)]);
    const okx = stubSource(() => [candle('RAY-USDT-SWAP', ANCHOR)]);

    const candles = await fetchReviewCandles(
      buildRequest({
        binance: binance.source,
        okx: okx.source,
        instrument: 'RAY-USDT-SWAP',
        binanceStatuses: async () => new Map([['RAYUSDT', 'SETTLING']]),
      }),
    );

    expect(candles).toEqual([candle('RAY-USDT-SWAP', ANCHOR)]);
    expect(binance.calls).toHaveLength(0);
    expect(okx.calls[0].instrument).toBe('RAY-USDT-SWAP');
  });

  it('serves an instrument Binance does not list from OKX', async () => {
    const binance = stubSource(() => [candle('SHIBUSDT', ANCHOR)]);
    const okx = stubSource(() => [candle('SHIB-USDT-SWAP', ANCHOR)]);

    const candles = await fetchReviewCandles(
      buildRequest({
        binance: binance.source,
        okx: okx.source,
        instrument: 'SHIB-USDT-SWAP',
        binanceStatuses: async () => new Map([['ZECUSDT', 'TRADING']]),
      }),
    );

    expect(candles).toEqual([candle('SHIB-USDT-SWAP', ANCHOR)]);
    expect(binance.calls).toHaveLength(0);
  });

  it('reports the skip reason when neither source carries the instrument', async () => {
    const binance = stubSource(() => []);
    const okx = stubSource(() => []);

    const error = await captureError(
      buildRequest({
        binance: binance.source,
        okx: okx.source,
        instrument: 'VANRY-USDT-SWAP',
        binanceStatuses: async () => new Map([['VANRYUSDT', 'SETTLING']]),
      }),
    );

    expect(error).toBeInstanceOf(ReviewCandleUnavailableError);
    expect((error as Error).message).toBe('无可用行情数据(VANRY-USDT-SWAP): 币安 VANRYUSDT(合约状态 SETTLING)；OKX VANRY-USDT-SWAP 无 K 线');
    expect(binance.calls).toHaveLength(0);
    expect(okx.calls).toHaveLength(2);
    expect(okx.calls.every((call) => call.instrument === 'VANRY-USDT-SWAP')).toBe(true);
  });

  it('attempts a Binance candidate when the status metadata is unreadable', async () => {
    const binance = stubSource(() => [candle('SHIBUSDT', ANCHOR)]);
    const okx = stubSource(() => [candle('SHIB-USDT-SWAP', ANCHOR)]);

    const candles = await fetchReviewCandles(
      buildRequest({ binance: binance.source, okx: okx.source, instrument: 'SHIB-USDT-SWAP', binanceStatuses: async () => new Map() }),
    );

    expect(candles).toEqual([candle('SHIBUSDT', ANCHOR)]);
    expect(binance.calls.map((call) => call.instrument)).toEqual(['SHIBUSDT', 'SHIBUSDT']);
  });

  it('propagates a Binance fetch failure instead of substituting OKX', async () => {
    const binance = stubSource(() => {
      throw new Error('Binance request failed: HTTP 418 (Binance IP auto-banned)');
    });
    const okx = stubSource(() => [candle('ZEC-USDT-SWAP', ANCHOR)]);

    const error = await captureError(buildRequest({ binance: binance.source, okx: okx.source }));

    expect((error as Error).message).toBe('Binance request failed: HTTP 418 (Binance IP auto-banned)');
    expect(error).not.toBeInstanceOf(ReviewCandleUnavailableError);
    expect(okx.calls).toHaveLength(0);
  });

  it('keeps an empty window empty rather than switching venue', async () => {
    const binance = stubSource(() => []);
    const okx = stubSource(() => [candle('ZEC-USDT-SWAP', ANCHOR)]);

    const candles = await fetchReviewCandles(
      buildRequest({ binance: binance.source, okx: okx.source, mode: 'later', binanceStatuses: async () => new Map([['ZECUSDT', 'TRADING']]) }),
    );

    expect(candles).toEqual([]);
    expect(okx.calls).toHaveLength(0);
  });

  it('returns [] for an instrument that is not a USDT swap, without any request', async () => {
    const binance = stubSource(() => []);
    const okx = stubSource(() => []);

    await expect(fetchReviewCandles(buildRequest({ binance: binance.source, okx: okx.source, instrument: 'ZECUSDT' }))).resolves.toEqual([]);
    expect(binance.calls).toHaveLength(0);
    expect(okx.calls).toHaveLength(0);
  });

  it('merges the before/after windows for the initial mode', async () => {
    const binance = stubSource((request) =>
      request.direction === 'earlier' ? [candle('ZECUSDT', ANCHOR - STEP)] : [candle('ZECUSDT', ANCHOR)],
    );

    const candles = await fetchReviewCandles(buildRequest({ binance: binance.source, binanceStatuses: async () => new Map([['ZECUSDT', 'TRADING']]) }));

    expect(candles).toEqual([candle('ZECUSDT', ANCHOR - STEP), candle('ZECUSDT', ANCHOR)]);
    expect(binance.calls.map((call) => call.direction)).toEqual(['earlier', 'later']);
    expect(binance.calls.every((call) => call.limit === 150)).toBe(true);
  });

  it('fetches a single window for the earlier and later modes', async () => {
    const earlier = stubSource(() => [candle('ZECUSDT', ANCHOR - STEP)]);
    const later = stubSource(() => [candle('ZECUSDT', ANCHOR + STEP)]);
    const statuses = async () => new Map([['ZECUSDT', 'TRADING']]);

    await fetchReviewCandles(buildRequest({ binance: earlier.source, mode: 'earlier', binanceStatuses: statuses }));
    await fetchReviewCandles(buildRequest({ binance: later.source, mode: 'later', binanceStatuses: statuses }));

    expect(earlier.calls.map((call) => call.direction)).toEqual(['earlier']);
    expect(earlier.calls[0].anchor).toBe(ANCHOR);
    expect(later.calls.map((call) => call.direction)).toEqual(['later']);
    expect(later.calls[0].anchor).toBe(ANCHOR);
  });

  it('rejects a windowed mode without a finite anchor before any request', async () => {
    const binance = stubSource(() => []);

    const error = await captureError(buildRequest({ binance: binance.source, mode: 'earlier', anchor: Number.NaN }));

    expect((error as Error).message).toBe('anchor is required');
    expect(error).not.toBeInstanceOf(ReviewCandleUnavailableError);
    expect(binance.calls).toHaveLength(0);
  });
});
