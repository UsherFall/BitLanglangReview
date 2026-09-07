import type { Candlestick } from '../domain/candlestick';
import type { ReviewTimeframe } from '../domain/trade';
import { timeframeMs } from './candlestick-service';
import type { CandlestickStore } from './candlestick-store';
import { defaultBitgetMarketFetchJson, type FetchJson } from './http';
import type { CandleRequest, CandleSource } from './market-data';

/**
 * Bitget v2 mix candlestick payload. Each row is
 * `[timestamp(ms), open, high, low, close, baseVolume, quoteVolume]`.
 * The data field is empty when no candles exist for the requested window
 * (e.g. history deeper than the exchange serves or a delisted symbol).
 */
type BitgetCandlesResponse = {
  code?: unknown;
  msg?: unknown;
  data?: string[][];
};

const BITGET_BASE_URL = 'https://api.bitget.com';
const BITGET_CANDLES_PATH = '/api/v2/mix/market/candles';
const BITGET_PRODUCT_TYPE = 'USDT-FUTURES';
/** Bitget caps a single candles request's startTime~endTime span at 90 days. */
const BITGET_MAX_RANGE_MS = 90 * 24 * 60 * 60_000;

/**
 * Candlestick source backed by Bitget's public `v2/mix/market/candles`
 * endpoint. `request.instrument` is the native Bitget USDT-FUTURES symbol
 * (`BTCUSDT`), which is what the candlestick cache keys on — Bitget rows never
 * collide with the OKX `BTC-USDT-SWAP` rows in the shared `CandlestickStore`.
 *
 * Bitget day/week/month bars open on the UTC+8 calendar (the exchange's native
 * trading day), so unlike the Binance source the boundary seed carries the same
 * -8h offset the OKX service uses. The granularity tokens happen to be
 * identical to `ReviewTimeframe` (`1m`…`1M`).
 *
 * The endpoint returns the still-forming bar, so `earlier` requests keep only
 * completed bars (`openTime + step <= anchor`) before saving to the cache,
 * matching the other sources.
 */
export class BitgetCandleSource implements CandleSource {
  constructor(
    private readonly store: CandlestickStore,
    private readonly fetchJson: FetchJson = defaultBitgetMarketFetchJson,
  ) {}

  async getCandlesticks(request: CandleRequest): Promise<Candlestick[]> {
    const cached = this.listCached(request);
    if (!request.refresh && cached.length >= request.limit && isCacheFresh(request, cached)) {
      return cached;
    }

    const step = timeframeMs(request.timeframe);
    const url = new URL(`${BITGET_BASE_URL}${BITGET_CANDLES_PATH}`);
    url.searchParams.set('productType', BITGET_PRODUCT_TYPE);
    url.searchParams.set('symbol', request.instrument);
    url.searchParams.set('granularity', request.timeframe);
    url.searchParams.set('limit', String(request.limit));
    if (request.direction === 'earlier') {
      // The endpoint returns the newest `limit` bars at or before `endTime`, so
      // capping at the anchor-1 gives exactly the completed bars just before it.
      url.searchParams.set('endTime', String(request.anchor - 1));
    } else {
      // For "later" the window must ALSO cap endTime, otherwise the endpoint
      // would return the newest bars in [startTime, now] — a block far past the
      // anchor. The span is clamped to Bitget's 90-day request limit so coarse
      // timeframes (1D/1W/1M at limit 150) page in chunks instead of getting an
      // HTTP 400; the containing bar is dropped by the filter below.
      url.searchParams.set('startTime', String(request.anchor + 1));
      url.searchParams.set('endTime', String(request.anchor + Math.min(step * request.limit, BITGET_MAX_RANGE_MS)));
    }

    const payload = (await this.fetchJson(url.toString())) as BitgetCandlesResponse;
    if (payload?.code !== undefined && payload.code !== '00000') {
      throw new Error(`Bitget 行情错误 code=${String(payload.code)}${payload.msg ? `: ${String(payload.msg)}` : ''}`);
    }
    const candles = (Array.isArray(payload?.data) ? payload.data : [])
      .map((row) => toCandlestick(request.instrument, request.timeframe, row))
      .filter((candle) => {
        if (request.direction === 'earlier') {
          // Completed bars only: the still-forming bar is openTime + step > anchor.
          return candle.timestamp + step <= request.anchor;
        }
        return candle.timestamp > request.anchor;
      })
      .sort((a, b) => a.timestamp - b.timestamp);
    this.store.save(candles);
    return this.listCached(request);
  }

  private listCached(request: CandleRequest): Candlestick[] {
    const cached = request.direction === 'earlier'
      ? this.store.listBefore({ instrument: request.instrument, timeframe: request.timeframe, before: request.anchor, limit: request.limit })
      : this.store.listAfter({ instrument: request.instrument, timeframe: request.timeframe, after: request.anchor, limit: request.limit });
    return contiguousCandles(cached, request.anchor, request.timeframe, request.direction);
  }
}

/**
 * Same cache-freshness gate as the OKX service: a full cache is reused only
 * when it covers the moment being read. A "current" read whose newest bar lags
 * the anchor by more than two steps is stale and must refresh; a historical
 * anchor (fixed point in the past) is always fresh. `cached` is ascending.
 */
function isCacheFresh(request: CandleRequest, cached: Candlestick[]): boolean {
  if (request.direction !== 'earlier') return true;
  const step = timeframeMs(request.timeframe);
  if (request.anchor <= Date.now() - step * 2) return true; // historical anchor
  const newest = cached[cached.length - 1]?.timestamp ?? 0;
  return request.anchor - newest <= step * 2;
}

function contiguousCandles(candles: Candlestick[], anchor: number, timeframe: ReviewTimeframe, direction: CandleRequest['direction']): Candlestick[] {
  if (!candles.length) return [];
  const step = timeframeMs(timeframe);
  const maxGap = step * 1.5;
  const ordered = direction === 'earlier' ? [...candles].reverse() : candles;
  const kept: Candlestick[] = [];

  for (const candle of ordered) {
    const previousTimestamp = kept[kept.length - 1]?.timestamp ?? boundaryAnchor(anchor, timeframe);
    if (Math.abs(previousTimestamp - candle.timestamp) > maxGap) break;
    kept.push(candle);
  }

  return direction === 'earlier' ? kept.reverse() : kept;
}

/**
 * Start of the candlestick that contains `anchor`. Bitget calendar bars
 * (day/week) open on the UTC+8 boundary, so the grid carries a -8h offset; the
 * intraday step sizes all divide 8h, so the same phase shift keeps minute/hour
 * boundaries aligned to the top of the hour.
 */
function boundaryAnchor(anchor: number, timeframe: ReviewTimeframe): number {
  const step = timeframeMs(timeframe);
  const offset = -8 * 60 * 60_000;
  return Math.floor((anchor - offset) / step) * step + offset;
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
