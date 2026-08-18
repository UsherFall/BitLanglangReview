import type { Candlestick } from '../domain/candlestick';
import type { ReviewTimeframe } from '../domain/trade';
import { timeframeMs } from './candlestick-service';
import type { CandlestickStore } from './candlestick-store';
import { defaultBinanceFetchJson, type FetchJson } from './http';
import type { CandleRequest, CandleSource } from './market-data';

/**
 * Binance USDT-M perpetual kline row:
 * [openTime, open, high, low, close, volume, closeTime, quoteVol, trades,
 *  takerBuyBase, takerBuyQuote, ignore].
 */
type BinanceKline = [string, string, string, string, string, string, string, string, string, string, string, string];

/**
 * Candlestick source backed by Binance `fapi/v1/klines`. `timestamp` is the
 * candle `openTime` (UTC 0:00 boundary — Binance daily candles align with the
 * user's chart view, so NO OKX-style -8h offset is applied).
 *
 * The still-forming bar is dropped before saving to the cache
 * (`openTime + intervalMs <= anchor`), matching the scan's expectation that
 * every metric is computed only over completed candles. Caching reuses the
 * shared `CandlestickStore`; instrument names (`XAUUSDT` vs OKX `XAU-USDT-SWAP`)
 * differ, so Binance and OKX candles never collide in the store.
 */
export class BinanceCandleSource implements CandleSource {
  constructor(
    private readonly store: CandlestickStore,
    private readonly fetchJson: FetchJson = defaultBinanceFetchJson,
  ) {}

  async getCandlesticks(request: CandleRequest): Promise<Candlestick[]> {
    const cached = this.listCached(request);
    if (!request.refresh && cached.length >= request.limit && isCacheFresh(request, cached)) {
      return cached;
    }

    const step = timeframeMs(request.timeframe);
    const url = new URL('https://fapi.binance.com/fapi/v1/klines');
    url.searchParams.set('symbol', request.instrument);
    url.searchParams.set('interval', toBinanceInterval(request.timeframe));
    url.searchParams.set('limit', String(request.limit));
    if (request.direction === 'earlier') {
      // Candles with openTime <= anchor - 1 (endTime is inclusive).
      url.searchParams.set('endTime', String(request.anchor - 1));
    } else {
      // Map intra-candle anchors to the containing candlestick boundary, then
      // start at the next boundary so the first returned candle is the one
      // immediately after the anchor.
      url.searchParams.set('startTime', String(boundaryAnchor(request.anchor, request.timeframe) + step));
    }

    const rows = (await this.fetchJson(url.toString())) as BinanceKline[];
    const candles = (Array.isArray(rows) ? rows : [])
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
 * Cache-freshness gate: a full cache is only reused when it covers the moment
 * being read. A "current" scan (anchor near now) whose newest cached bar lags
 * the anchor by more than two steps is STALE — a previous scan populated the
 * store and repeat scans would otherwise keep returning old bars forever. A
 * historical anchor (fixed point in the past) is always fresh: that data never
 * changes. `cached` is ascending-sorted, so its last element is the newest bar.
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
 * Binance candles are aligned to UTC 0:00, so the containing candlestick
 * boundary is a plain floor of the anchor. Unlike the OKX service there is no
 * -8h offset for daily candles.
 */
function boundaryAnchor(anchor: number, timeframe: ReviewTimeframe): number {
  const step = timeframeMs(timeframe);
  return Math.floor(anchor / step) * step;
}

function toCandlestick(instrument: string, timeframe: ReviewTimeframe, row: BinanceKline): Candlestick {
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

function toBinanceInterval(timeframe: ReviewTimeframe): string {
  const map: Record<ReviewTimeframe, string> = {
    '1m': '1m',
    '5m': '5m',
    '15m': '15m',
    '1H': '1h',
    '4H': '4h',
    '1D': '1d',
    '1W': '1w',
    '1M': '1M',
  };
  return map[timeframe];
}
