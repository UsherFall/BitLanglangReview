import type { Candlestick } from '../domain/candlestick';
import type { ReviewTimeframe } from '../domain/trade';
import type { CandlestickStore } from './candlestick-store';
import { defaultFetchJson, type FetchJson } from './http';
import type { CandleRequest, CandleSource } from './market-data';

type Request = CandleRequest;

type OkxResponse = {
  data?: string[][];
};

export class CandlestickService implements CandleSource {
  constructor(
    private readonly store: CandlestickStore,
    private readonly fetchJson: FetchJson = defaultFetchJson,
  ) {}

  async getCandlesticks(request: Request): Promise<Candlestick[]> {
    const cached = this.listCached(request);
    if (!request.refresh && cached.length >= request.limit && isCacheFresh(request, cached)) {
      return cached;
    }

    const url = new URL('https://www.okx.com/api/v5/market/history-candles');
    url.searchParams.set('instId', request.instrument);
    url.searchParams.set('bar', request.timeframe);
    const okxAnchor = request.direction === 'earlier'
      ? request.anchor
      : boundaryAnchor(request.anchor, request.timeframe, 'later') + timeframeMs(request.timeframe) * (request.limit + 1);
    url.searchParams.set('after', String(okxAnchor));
    url.searchParams.set('limit', String(request.limit));

    const response = (await this.fetchJson(url.toString())) as OkxResponse;
    const candles = (response.data ?? [])
      // Closed-bar invariant (mirrors `BinanceCandleSource`): a still-forming bar
      // must never reach the cache, or a historical read would reuse a
      // half-formed high/low/close forever. OKX marks completion itself with
      // `confirm` (row[8]: '0' = not finished, '1' = finished), so only an
      // explicit '0' is dropped. An absent or unrecognised value is treated as
      // closed on purpose: over-dropping would leave this source with no candles
      // at all, while under-dropping merely preserves the pre-09/20 behaviour.
      // Do NOT use `timestamp + timeframeMs(timeframe)` — the nominal `1M` step
      // is 30 days, so a 31-day month would pass a bar that is still running.
      // This filter is direction-agnostic because an `earlier` request anchored
      // at "now" receives the in-progress bar too.
      .filter((row) => row[8] !== '0')
      .map((row) => toCandlestick(request.instrument, request.timeframe, row))
      .filter((candle) => (request.direction === 'earlier' ? candle.timestamp < request.anchor : candle.timestamp > request.anchor))
      .sort((a, b) => a.timestamp - b.timestamp);
    this.store.save(candles);
    return this.listCached(request);
  }

  private listCached(request: Request): Candlestick[] {
    const cached = request.direction === 'earlier'
      ? this.store.listBefore({ instrument: request.instrument, timeframe: request.timeframe, before: request.anchor, limit: request.limit })
      : this.store.listAfter({ instrument: request.instrument, timeframe: request.timeframe, after: request.anchor, limit: request.limit });
    return contiguousCandles(cached, request.anchor, request.timeframe, request.direction);
  }
}

/**
 * Cache-freshness gate, shared in spirit with `BinanceCandleSource`: a full
 * cache is reused only when it covers the moment being read. A "current" read
 * whose newest bar lags the anchor by more than two steps is stale and must
 * refresh; a historical anchor (fixed point in the past) is always fresh.
 *
 * That "history never changes" shortcut is only sound because of the closed-bar
 * invariant in `getCandlesticks`: every stored row is a CLOSED bar's final
 * value. The read path has no way to tell a half-formed row apart on its own —
 * its timestamp is an ordinary past one — so this gate must not be weakened
 * before the write-side filter is in place.
 */
function isCacheFresh(request: Request, cached: Candlestick[]): boolean {
  if (request.direction !== 'earlier') return true;
  const step = timeframeMs(request.timeframe);
  if (request.anchor <= Date.now() - step * 2) return true; // historical anchor
  const newest = cached[cached.length - 1]?.timestamp ?? 0;
  return request.anchor - newest <= step * 2;
}

function contiguousCandles(candles: Candlestick[], anchor: number, timeframe: ReviewTimeframe, direction: Request['direction']): Candlestick[] {
  if (!candles.length) return [];
  const step = timeframeMs(timeframe);
  const maxGap = step * 1.5;
  const ordered = direction === 'earlier' ? [...candles].reverse() : candles;
  const kept: Candlestick[] = [];

  for (const candle of ordered) {
    const previousTimestamp = kept[kept.length - 1]?.timestamp ?? boundaryAnchor(anchor, timeframe, direction);
    if (Math.abs(previousTimestamp - candle.timestamp) > maxGap) break;
    kept.push(candle);
  }

  return direction === 'earlier' ? kept.reverse() : kept;
}

function boundaryAnchor(anchor: number, timeframe: ReviewTimeframe, direction: Request['direction']): number {
  const step = timeframeMs(timeframe);
  const offset = timeframe === '1D' ? -8 * 60 * 60_000 : 0;
  const shifted = anchor - offset;
  const boundary = direction === 'earlier'
    ? Math.ceil(shifted / step) * step
    : Math.floor(shifted / step) * step;
  return boundary + offset;
}

function toCandlestick(instrument: string, timeframe: ReviewTimeframe, row: string[]): Candlestick {
  return {
    instrument,
    timeframe,
    timestamp: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5] ?? 0),
  };
}

export function timeframeMs(timeframe: ReviewTimeframe): number {
  const map: Record<ReviewTimeframe, number> = {
    '1m': 60_000,
    '5m': 5 * 60_000,
    '15m': 15 * 60_000,
    '1H': 60 * 60_000,
    '4H': 4 * 60 * 60_000,
    '1D': 24 * 60 * 60_000,
    '1W': 7 * 24 * 60 * 60_000,
    '1M': 30 * 24 * 60 * 60_000,
  };
  return map[timeframe];
}
