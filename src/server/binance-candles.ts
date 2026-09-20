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
 * `earlier` returns the bars strictly before the anchor — including the bar that
 * CONTAINS the anchor — matching `CandlestickService` (OKX) so a review window
 * centred on a trade entry never drops the entry's own bar. That rule is NOT in
 * conflict with the closed-bar invariant below: an anchor in the past can only
 * sit inside a bar that has already closed, so the anchor's own bar is still
 * returned. A LIVE anchor (now) loses the in-progress bar instead, which is the
 * accepted behaviour change (a half-formed bar has wrong high/low/close and
 * breaks contiguity with its neighbours).
 *
 * Closed-bar invariant: the store — and therefore the read path, which always
 * ends in `listCached` — only ever holds CLOSED bars, judged by the exchange's
 * own `closeTime` (row[6]). See `getCandlesticks` for why the nominal step must
 * not be used for that judgement. Caching reuses the shared `CandlestickStore`;
 * instrument names (`XAUUSDT` vs OKX `XAU-USDT-SWAP`) differ, so Binance and OKX
 * candles never collide in the store.
 *
 * Namespace warning: the cache key IS the native `base+USDT` symbol, so Binance
 * rows collide with any OTHER source whose symbol vocabulary is also
 * `base+USDT` (e.g. the retired Bitget candle source wrote the same keys and
 * its leftovers mixed with Binance rows, producing duplicate daily bars).
 * OKX is safe only because its names carry the `-USDT-SWAP` suffix. If a future
 * source shares the `base+USDT` namespace, it MUST namespace its cache keys
 * (e.g. a source prefix) — the `(instrument, timeframe, timestamp)` primary key
 * cannot tell two such sources apart.
 */
export class BinanceCandleSource implements CandleSource {
  constructor(
    private readonly store: CandlestickStore,
    private readonly fetchJson: FetchJson = defaultBinanceFetchJson,
  ) {}

  async getCandlesticks(request: CandleRequest): Promise<Candlestick[]> {
    const cached = this.listCached(request);
    if (!request.refresh && cached.length >= request.limit && isCacheFresh(request, cached) && coversAnchorBar(request, cached)) {
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
      // Drop the still-forming bar BEFORE it can reach the cache: `closeTime`
      // (row[6]) is the bar's last millisecond, so `closeTime < now` means the
      // exchange has finalised it. This gate is direction-agnostic because an
      // `earlier` request anchored at "now" returns the in-progress bar too.
      // Do NOT derive it from `timestamp + timeframeMs(timeframe)`: the nominal
      // `1M` step is 30 days, so a 31-day month would let a still-running bar
      // through and a 28-day month would discard an already-closed one.
      .filter((row) => Number(row[6]) < Date.now())
      .map((row) => toCandlestick(request.instrument, request.timeframe, row))
      .filter((candle) => {
        if (request.direction === 'earlier') {
          // Bars strictly before the anchor, matching `CandlestickService`: the
          // anchor's containing bar has an open time below the anchor and is
          // therefore kept, so an entry candle is never left out of the window.
          return candle.timestamp < request.anchor;
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

/**
 * Cache-completeness gate for `earlier`. A cache that holds `limit` bars but
 * stops one bar short of the anchor (rows written before the anchor's containing
 * bar became part of `earlier`) must NOT satisfy the cache hit — otherwise the
 * hole is permanent, because `listBefore` happily returns a full-looking run
 * that simply ends too early. The newest cached bar must therefore reach the
 * reading moment: one bar of slack is expected (a boundary anchor has its
 * containing bar in `later`, so `earlier` stops at `anchor - step`), a two-bar
 * hole is not.
 *
 * The spacing comes from the cache itself — `contiguousCandles` guarantees a
 * gapless run — rather than from `boundaryAnchor`: that floors by the nominal
 * `1W`/`1M` step, but Binance weeks open on Monday and months on the 1st, so a
 * floored reference lands INSIDE the current bar and would report "one bar
 * short" forever, bypassing the cache on every request. The nominal step is kept
 * as a floor so a short calendar month (28 days) cannot tighten the check.
 *
 * The comparison target is `min(anchor, now - step)`, NOT the raw anchor: only
 * closed bars are cached, so for a live anchor the anchor's own bar is
 * legitimately missing and asking for it would force a refetch every time. See
 * the inline note below.
 */
function coversAnchorBar(request: CandleRequest, cached: Candlestick[]): boolean {
  if (request.direction !== 'earlier') return true;
  const newest = cached[cached.length - 1]?.timestamp;
  if (newest === undefined) return false;
  const step = timeframeMs(request.timeframe);
  const previous = cached[cached.length - 2]?.timestamp;
  const spacing = Math.max(step, previous === undefined ? 0 : newest - previous);
  // Since only closed bars are cached, for a LIVE anchor the anchor's own bar is
  // LEGITIMATELY absent — comparing against the raw anchor would demand a bar
  // that cannot exist yet and bypass the cache on every single request.
  // `now - step` is the newest bar that can possibly be closed, so it is the
  // real upper bound of what the cache is allowed to reach; a historical anchor
  // is below it and keeps being compared against itself.
  const target = Math.min(request.anchor, Date.now() - step);
  return target - newest <= spacing;
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
