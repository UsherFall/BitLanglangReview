import type { Candlestick } from '../domain/candlestick';
import type { ReviewTimeframe } from '../domain/trade';
import { timeframeMs } from './candlestick-service';
import type { CandlestickStore } from './candlestick-store';
import { defaultBitgetMarketFetchJson, type FetchJson } from './http';
import type { CandleRequest, CandleSource } from './market-data';

/**
 * Bitget v2 mix candlestick payload. Each row is
 * `[timestamp(ms), open, high, low, close, baseVolume, quoteVolume]` — note
 * there is NO exchange-side completion flag (unlike OKX's `confirm` or
 * Binance's `closeTime`), so the closed-bar judgement is time-based.
 * `data` is empty when no candles exist for the requested window (history
 * deeper than the exchange serves, or a delisted symbol).
 */
type BitgetCandlesResponse = {
  code?: unknown;
  msg?: unknown;
  data?: string[][];
};

const BITGET_BASE_URL = 'https://api.bitget.com';
const BITGET_CANDLES_PATH = '/api/v2/mix/market/candles';
/**
 * The deeper-history sibling of `/candles`. Measured 2026-10-15: `/candles` only
 * serves back to ≈2023-10 on 1D while this one reaches ≈2019-10, both at 90 rows
 * per request. Used for the OLD pages of a paged read; the newest page stays on
 * `/candles` so the bars a paged caller sees first are byte-identical to what the
 * single-request path (and therefore the coin scan) fetches.
 *
 * Measured 10/21: the two endpoints read the request window on DIFFERENT bar
 * times. `/candles` returns the newest `limit` bars whose OPEN falls in
 * (startTime, endTime] (startTime is an exclusive bound); `/history-candles`
 * applies the same shape to CLOSE times — with only `endTime` it returns the
 * newest `limit` bars that had already closed by it (close ≤ endTime, equality
 * included). Cursor arithmetic must respect which reading a page uses.
 */
const BITGET_HISTORY_CANDLES_PATH = '/api/v2/mix/market/history-candles';
const BITGET_PRODUCT_TYPE = 'USDT-FUTURES';

/**
 * Rows ONE request may return. The endpoint's `limit` is capped per granularity
 * and 1D is capped at 90 (measured: `limit=200` still returns 90), so paging is
 * the only way to reach a longer window on 1D.
 */
const BITGET_PAGE_BARS = 90;

/** Bitget caps a single candles request's startTime~endTime span at 90 days. */
const BITGET_MAX_RANGE_MS = 90 * 24 * 60 * 60_000;

/**
 * Store-key prefix for Bitget candles. The shared `CandlestickStore`'s primary
 * key is `(instrument, timeframe, timestamp)` with NO source column, so two
 * sources sharing a symbol vocabulary collide — which is exactly what happened
 * with the retired Bitget source and Binance (both `base+USDT`), producing
 * duplicate daily bars (spec `market-data.md`, cache-key namespace rule 09/07).
 * Bitget symbols ARE Binance symbols (`BTCUSDT`), so every store read/write
 * here is namespaced; the network request and the returned candles keep the
 * native symbol. OKX is safe without this only because of its `-USDT-SWAP`
 * suffix.
 */
export const BITGET_KEY_PREFIX = 'bitget:';

/**
 * Candlestick source backed by Bitget's public `v2/mix/market/candles`
 * endpoint (no API key). `request.instrument` is the native Bitget
 * USDT-FUTURES symbol (`BTCUSDT`); the store key is namespaced with
 * `BITGET_KEY_PREFIX`.
 *
 * Bitget day/week/month bars open on the UTC+8 calendar (the exchange's native
 * trading day), so — like the OKX service and unlike the Binance source — the
 * boundary seed carries a -8h offset. The intraday steps (5m…4H) all divide 8h,
 * so minute/hour boundaries stay aligned to the top of the hour.
 *
 * Granularity is passed through unchanged: Bitget mix tokens are identical to
 * `ReviewTimeframe` (`1m/5m/15m/1H/4H/1D/1W/1M` — note the CAPITAL H/D; the
 * spot API uses lowercase `1h/1day`). `tests/bitget-candles.test.ts` asserts
 * the passthrough against the endpoint's legal set.
 *
 * The endpoint returns the still-forming bar, and rows carry no completion
 * flag, so a bar is admitted only once it has CLOSED — judged by its close
 * time (`barCloseTime`), never by the anchor.
 *
 * `earlier` keeps the bars strictly before the anchor INCLUDING the bar that
 * CONTAINS the anchor (`open < anchor`) — the same rule OKX and Binance
 * follow, and the one the review charts need: the entry's own bar is the bar
 * the entry marker sits on. A bar is CLOSED when its close time has passed
 * (`isClosedBar`), which is a question about the bar itself, NOT about the
 * anchor: a review's anchor is a trade entry in the past, so the bar
 * containing it closed long ago. Judging closure by the anchor instead
 * (`open + step <= anchor`) dropped exactly that bar and left a one-bar hole
 * at the entry — measured 10/22 on the user's own Bitget positions: the
 * window jumped from the bar before the entry to the bar after it, so the
 * entry marker had no candle under it and the series looked broken.
 */
export class BitgetCandleSource implements CandleSource {
  constructor(
    private readonly store: CandlestickStore,
    private readonly fetchJson: FetchJson = defaultBitgetMarketFetchJson,
  ) {}

  async getCandlesticks(request: CandleRequest): Promise<Candlestick[]> {
    const cached = this.listCached(request);
    if (!request.refresh && cached.length >= request.limit && isCacheFresh(request, cached) && coversAnchorBar(request, cached)) {
      return cached;
    }

    if (request.allowPaging && request.direction === 'earlier') {
      return this.fetchEarlierPaged(request, cached);
    }
    if (request.allowPaging && request.direction === 'later') {
      return this.fetchLaterPaged(request, cached);
    }

    const step = timeframeMs(request.timeframe);
    const url = new URL(`${BITGET_BASE_URL}${BITGET_CANDLES_PATH}`);
    url.searchParams.set('productType', BITGET_PRODUCT_TYPE);
    url.searchParams.set('symbol', request.instrument);
    url.searchParams.set('granularity', request.timeframe);
    url.searchParams.set('limit', String(request.limit));
    if (request.direction === 'earlier') {
      // The endpoint returns the newest `limit` bars at or before `endTime`
      // (measured), so capping at the anchor-1 gives exactly the completed
      // bars just before it.
      url.searchParams.set('endTime', String(request.anchor - 1));
    } else {
      // For "later" the window must ALSO cap endTime, otherwise the endpoint
      // would return the newest bars in [startTime, now] — a block far past
      // the anchor. The span is clamped to Bitget's 90-day request limit so
      // coarse timeframes (1D/1W/1M at limit 150) page in chunks instead of
      // getting an HTTP 400; the containing bar is dropped by the filter below.
      url.searchParams.set('startTime', String(request.anchor + 1));
      url.searchParams.set('endTime', String(request.anchor + Math.min(step * request.limit, BITGET_MAX_RANGE_MS)));
    }

    const payload = (await this.fetchJson(url.toString())) as BitgetCandlesResponse;
    // Bitget wraps business errors in an HTTP 200 body.
    if (payload?.code !== undefined && payload.code !== '00000') {
      throw new Error(`Bitget 行情错误 code=${String(payload.code)}${payload.msg ? `: ${String(payload.msg)}` : ''}`);
    }
    const key = storeKey(request.instrument);
    const candles = (Array.isArray(payload?.data) ? payload.data : [])
      .map((row) => toCandlestick(key, request.timeframe, row))
      .filter((candle) => {
        if (request.direction === 'earlier') {
          // Bars strictly before the anchor, including the bar CONTAINING it
          // (open < anchor), and only bars that have already closed.
          return candle.timestamp < request.anchor && isClosedBar(candle.timestamp, request.timeframe);
        }
        return candle.timestamp > request.anchor;
      })
      .sort((a, b) => a.timestamp - b.timestamp);
    this.store.save(candles);
    return this.listCached(request);
  }

  /**
   * Paged `earlier` read: the newest page always, then older pages only for the
   * stretch the cache does not already hold. One request cannot satisfy a long
   * `limit` on 1D (90-bar cap), so "give me `limit` bars" needs this loop.
   *
   * The cache is what makes it affordable: older bars never change, so only the
   * NEWEST page is ever re-read on a refresh — a warm cache costs exactly one
   * request per call, the same as the single-request path.
   */
  private async fetchEarlierPaged(request: CandleRequest, cached: Candlestick[]): Promise<Candlestick[]> {
    const perPage = Math.min(BITGET_PAGE_BARS, request.limit);
    const newestIsUsable = !request.refresh && cached.length > 0 && isCacheFresh(request, cached) && coversAnchorBar(request, cached);
    if (!newestIsUsable) {
      const added = await this.requestEarlierPage(request, BITGET_CANDLES_PATH, request.anchor - 1, perPage);
      if (added === 0) {
        // `/candles` keeps only a rolling window per granularity (measured
        // 10/21: 1m~1H a few weeks, 4H months, 1D ~3.7 years). An anchor that
        // predates it answers empty, which used to strand the walk: no cached
        // bar means no `oldest` cursor, the loop below never runs, and
        // `/history-candles` — which serves every age measured (5m at 13
        // months, 1D to ~2019) — was never asked. Seed from it instead.
        //
        // The seed's `endTime` must be `anchor + step`, NOT `anchor`: this
        // endpoint reads the window on CLOSE times (`/candles` reads open
        // times — see the TRAP note in the walk below), so `endTime = anchor`
        // admits only bars that had already closed by the anchor and leaves out
        // the bar CONTAINING the anchor — the very bar the entry marker needs.
        // `anchor + step` is the containing bar's own close, so it is admitted
        // (measured 10/22: APRUSDT 5m, entry 13:57:03Z — the seed at
        // `endTime=anchor` returned bars ending at 13:50 and the 13:55 bar
        // was missing, leaving a 10-minute hole under the entry marker).
        await this.requestEarlierPage(request, BITGET_HISTORY_CANDLES_PATH, request.anchor + timeframeMs(request.timeframe), perPage);
      }
    }
    // Walk back until the contiguous run reaches `limit` or the exchange runs out.
    // `maxPages` is a runaway stop, not a budget: a healthy read needs
    // ceil(limit / perPage) pages and every iteration advances the cursor.
    const maxPages = Math.ceil(request.limit / perPage) + 2;
    for (let page = 0; page < maxPages; page += 1) {
      const have = this.listCached(request);
      if (have.length >= request.limit) break;
      const oldest = have[0]?.timestamp;
      if (oldest === undefined) break;
      // The cursor is `oldest` itself, NOT `oldest - 1`. The two endpoints do not
      // agree on `endTime`: `/candles` returns the bar CONTAINING endTime while
      // `/history-candles` returns only bars that had already CLOSED by it
      // (measured 2026-10-15). Asking for `oldest - 1` therefore drops the bar
      // right below the newest page and leaves a one-day hole, which
      // `contiguousCandles` refuses to cross — so `oldest` never moves and the
      // same page is re-requested forever. `oldest` is contiguous under both
      // readings (the overlap is an upsert of a bar we already have).
      const added = await this.requestEarlierPage(request, BITGET_HISTORY_CANDLES_PATH, oldest, perPage);
      // Belt and braces: a page that saves rows but does not extend the
      // contiguous run (a hole of any other shape) must stop the walk rather
      // than spin. Without this, the bug above cost 19 minutes of refetching.
      if (added === 0 || this.listCached(request).length <= have.length) break;
    }
    return this.listCached(request);
  }

  /**
   * One `earlier` request against `path`, ending at `endTime` (inclusive — see
   * the cursor note in `fetchEarlierPaged`). Bars are saved (primary-key upsert,
   * so an overlapping page is harmless) and the count this page contributed is
   * returned, which is how the paging loop detects "the exchange has no more".
   */
  private async requestEarlierPage(
    request: CandleRequest,
    path: string,
    endTime: number,
    limit: number,
  ): Promise<number> {
    const url = new URL(`${BITGET_BASE_URL}${path}`);
    url.searchParams.set('productType', BITGET_PRODUCT_TYPE);
    url.searchParams.set('symbol', request.instrument);
    url.searchParams.set('granularity', request.timeframe);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('endTime', String(endTime));

    const payload = (await this.fetchJson(url.toString())) as BitgetCandlesResponse;
    if (payload?.code !== undefined && payload.code !== '00000') {
      throw new Error(`Bitget 行情错误 code=${String(payload.code)}${payload.msg ? `: ${String(payload.msg)}` : ''}`);
    }
    const step = timeframeMs(request.timeframe);
    const key = storeKey(request.instrument);
    const candles = (Array.isArray(payload?.data) ? payload.data : [])
      .map((row) => toCandlestick(key, request.timeframe, row))
      .filter((candle) => candle.timestamp < request.anchor && isClosedBar(candle.timestamp, request.timeframe))
      .sort((a, b) => a.timestamp - b.timestamp);
    this.store.save(candles);
    return candles.length;
  }

  /**
   * Paged `later` read (10/21) — the mirror of `fetchEarlierPaged`.
   *
   * Why it exists: the charts ask for 150 bars, and Bitget's single request
   * caps at 90 — on `later` that is a hard wall, because the window is
   * [anchor+1, anchor+span] and the span is clamped to Bitget's 90-day range
   * limit. Without paging, scrolling FORWARD in a 1D chart stops after 90
   * bars (and much sooner on 1W/1M, whose span exceeds 90 days outright).
   *
   * The walk is the mirror of the `earlier` one: the first page covers
   * [anchor+1, anchor+span]; every further page starts at the newest bar held
   * and moves FORWARD. `/history-candles` is the deep-history endpoint, but
   * for a FORWARD walk the plain `/candles` endpoint is the right one — it
   * serves the newest bars in the requested window, and `startTime`/`endTime`
   * bound it.
   */
  private async fetchLaterPaged(request: CandleRequest, cached: Candlestick[]): Promise<Candlestick[]> {
    const perPage = Math.min(BITGET_PAGE_BARS, request.limit);
    const step = timeframeMs(request.timeframe);
    // `/candles` answers with the newest `limit` bars whose OPEN falls inside
    // (startTime, endTime], and `startTime` is an EXCLUSIVE bound (measured
    // 10/21: a startTime equal to a bar's open excludes that bar). The first
    // page therefore spans EXACTLY (anchor, anchor + step * perPage]: that
    // window holds exactly perPage grid bars, the first one right after the
    // anchor. The previous `anchor+1 … anchor+1+span` window excluded the first
    // bar whenever `anchor+1` landed on a grid point (an entry exactly on a bar
    // boundary) or let the 90-row cap drop it, and `contiguousCandles` then cut
    // the whole page to nothing — every 5m/4H later read after a boundary entry
    // returned []. 1D only survived because its 16:00Z opens sit 8h off the
    // anchor's natural grid. The span is clamped to Bitget's 90-day request cap
    // so coarse timeframes (1W/1M) page in chunks instead of erroring; the
    // window then holds fewer bars per page, which the walk below pages through.
    const pageSpan = Math.min(step * perPage, BITGET_MAX_RANGE_MS);
    await this.requestLaterPage(request, BITGET_CANDLES_PATH, request.anchor, request.anchor + pageSpan, perPage);
    // `/candles`' rolling window does not reach old anchors — an empty (or
    // non-adjacent) first page leaves `listCached` empty and would strand the
    // walk exactly like the earlier direction. Seed from `/history-candles`,
    // which serves every age measured.
    if (this.listCached(request).length === 0) {
      await this.requestHistoryLaterPage(request, request.anchor, perPage);
    }
    // Then walk forward until the window is full or the exchange runs out.
    // `maxPages` is a runaway stop, not a budget: a healthy read needs
    // ceil(limit / perPage) pages and every iteration advances the cursor.
    const maxPages = Math.ceil(request.limit / perPage) + 2;
    for (let page = 0; page < maxPages; page += 1) {
      const have = this.listCached(request);
      if (have.length >= request.limit) break;
      const newest = have.at(-1)?.timestamp;
      if (newest === undefined) break;
      // The cursor is the newest bar held: the next page starts right after
      // it. The overlap is harmless — the store upserts on the primary key.
      const added = await this.requestLaterPage(request, BITGET_CANDLES_PATH, newest + 1, newest + 1 + pageSpan, perPage);
      if (added === 0 || this.listCached(request).length <= have.length) {
        // The page sits before `/candles`' rolling window (an empty answer, or
        // a straddling window whose bars sit past a hole the contiguity gate
        // refuses to cross). `/history-candles` serves every age measured, so
        // page the same stretch from it; if it has nothing either, the
        // exchange is genuinely out of bars and the walk stops.
        const historyAdded = await this.requestHistoryLaterPage(request, newest, perPage);
        if (historyAdded === 0 || this.listCached(request).length <= have.length) break;
        continue;
      }
    }
    return this.listCached(request);
  }

  /**
   * One `later` request against `path`, covering [startTime, endTime].
   * `startTime` is Bitget's EXCLUSIVE lower bound on the open time; `null`
   * omits it, which `/history-candles` pages rely on (an endTime-only request
   * is also exempt from the 90-day startTime~endTime span cap).
   * Bars are saved (primary-key upsert) and the count this page contributed is
   * returned, which is how the paging loop detects "the exchange has no more".
   */
  private async requestLaterPage(
    request: CandleRequest,
    path: string,
    startTime: number | null,
    endTime: number,
    limit: number,
  ): Promise<number> {
    const url = new URL(`${BITGET_BASE_URL}${path}`);
    url.searchParams.set('productType', BITGET_PRODUCT_TYPE);
    url.searchParams.set('symbol', request.instrument);
    url.searchParams.set('granularity', request.timeframe);
    url.searchParams.set('limit', String(limit));
    if (startTime !== null) url.searchParams.set('startTime', String(startTime));
    url.searchParams.set('endTime', String(endTime));

    const payload = (await this.fetchJson(url.toString())) as BitgetCandlesResponse;
    if (payload?.code !== undefined && payload.code !== '00000') {
      throw new Error(`Bitget 行情错误 code=${String(payload.code)}${payload.msg ? `: ${String(payload.msg)}` : ''}`);
    }
    const step = timeframeMs(request.timeframe);
    const key = storeKey(request.instrument);
    const candles = (Array.isArray(payload?.data) ? payload.data : [])
      .map((row) => toCandlestick(key, request.timeframe, row))
      .filter((candle) => candle.timestamp > request.anchor)
      .sort((a, b) => a.timestamp - b.timestamp);
    this.store.save(candles);
    return candles.length;
  }

  /**
   * One FORWARD page from `/history-candles` (10/21): an endTime-only request
   * landing the `limit` bars right after the cursor.
   *
   * That endpoint reads its window on CLOSE times — the mirror of the earlier
   * walk's TRAP (`/candles` reads open times) — and answers with the newest
   * `limit` bars that had already closed by `endTime`. `endTime = cursor +
   * (limit + 1) * step` therefore selects exactly the bars opening in
   * (cursor, cursor + limit * step], for a cursor on OR off the grid: the
   * newest close it can admit is the last target bar's own close, and the
   * bar at the cursor itself is the (limit+1)-th back, dropped by the row cap.
   * Omitting `startTime` keeps the request outside the 90-day span cap, which
   * the (limit+1)-step span would otherwise exceed on 1D and coarser.
   */
  private async requestHistoryLaterPage(request: CandleRequest, cursor: number, limit: number): Promise<number> {
    const step = timeframeMs(request.timeframe);
    return this.requestLaterPage(request, BITGET_HISTORY_CANDLES_PATH, null, cursor + (limit + 1) * step, limit);
  }

  private listCached(request: CandleRequest): Candlestick[] {
    const key = storeKey(request.instrument);
    const cached = request.direction === 'earlier'
      ? this.store.listBefore({ instrument: key, timeframe: request.timeframe, before: request.anchor, limit: request.limit })
      : this.store.listAfter({ instrument: key, timeframe: request.timeframe, after: request.anchor, limit: request.limit });
    const contiguous = contiguousCandles(cached, request.anchor, request.timeframe, request.direction);
    // The namespaced key is a storage detail; callers get their own instrument back.
    return contiguous.map((candle) => (candle.instrument === key ? { ...candle, instrument: request.instrument } : candle));
  }
}

/** Storage key for a native Bitget symbol (see `BITGET_KEY_PREFIX`). */
function storeKey(instrument: string): string {
  return `${BITGET_KEY_PREFIX}${instrument}`;
}

/**
 * Same cache-freshness gate as the other sources: a full cache is reused only
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

/**
 * Cache-completeness gate for `earlier`, carried over from `BinanceCandleSource`:
 * a cache that holds `limit` bars but stops one bar short of the anchor must
 * NOT satisfy the hit, or the hole is permanent. Mirrors the Binance
 * implementation exactly (same `target = min(anchor, now - step)` reasoning,
 * same cache-derived spacing).
 */
function coversAnchorBar(request: CandleRequest, cached: Candlestick[]): boolean {
  if (request.direction !== 'earlier') return true;
  const newest = cached[cached.length - 1]?.timestamp;
  if (newest === undefined) return false;
  const step = timeframeMs(request.timeframe);
  const previous = cached[cached.length - 2]?.timestamp;
  const spacing = Math.max(step, previous === undefined ? 0 : newest - previous);
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
 * Close time of the bar that opens at `timestamp`, in ms.
 *
 * The nominal step is right for every timeframe except `1M`: a calendar month
 * is 28–31 days, so `timestamp + 30d` is off by a day twice a year and would
 * judge a bar closed while it still runs (or not yet closed after it ended).
 * Bitget's month bar opens on the 1st at 00:00 Beijing (= the 16:00Z of the
 * previous day), so its close is the NEXT 1st at 00:00 Beijing.
 *
 * The weekly bar is exactly 7 days (Bitget opens weeks on Monday 00:00
 * Beijing) and the daily bar exactly 24 hours, so the nominal step holds for
 * them.
 */
function barCloseTime(timestamp: number, timeframe: ReviewTimeframe): number {
  if (timeframe !== '1M') return timestamp + timeframeMs(timeframe);
  // Beijing wall clock, read through the UTC getters.
  const beijing = new Date(timestamp + 8 * 60 * 60_000);
  const close = Date.UTC(beijing.getUTCFullYear(), beijing.getUTCMonth() + 1, 1) - 8 * 60 * 60_000;
  return close;
}

/**
 * Whether the bar opening at `timestamp` has already closed.
 *
 * The judgement is about the BAR, never about the request's anchor: a review's
 * anchor is a trade entry in the past, and the bar containing that entry
 * closed long ago. Judging closure against the anchor instead dropped that
 * very bar and left a one-bar hole at the entry (measured 10/22).
 */
function isClosedBar(timestamp: number, timeframe: ReviewTimeframe): boolean {
  return barCloseTime(timestamp, timeframe) <= Date.now();
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
