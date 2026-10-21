import type { Candlestick } from '../domain/candlestick';
import {
  SQUEEZE_LOOKBACKS,
  SQUEEZE_MAX_RUN,
  detectBoxBrace,
  type BoxBrace,
} from '../domain/box-brace';
import {
  COARSE_TIMEFRAME,
  DEFAULT_COARSE_PARAMS,
  coarseScreen,
  coarseStructure,
  scanTimeframes,
  type ScanResponse,
  type ScanRow,
  type ShrinkScanParams,
} from '../domain/coin-scan';
import {
  levelAlert,
  linesFromDrawings,
  scaleLinesToSource,
  scaleStartIndex,
  type LevelAlert,
  type LevelLine,
} from '../domain/level-alert';
import { canonicalInstrument } from '../domain/instrument-symbol';
import { isCandleInSession, isMarketOpen, marketSession } from '../domain/market-session';
import type { MarketClass } from '../domain/market-class';
import { isScannable } from '../domain/scan-pool';
import { scanScopeOf, type MarketDataSource, type ScanScope } from '../domain/scan-scope';
import type { ReviewTimeframe } from '../domain/trade';
import { timeframeMs } from './candlestick-service';
import type { CandleSource, Ticker, TickerSource } from './market-data';
import { binanceRateGate, type RateGate } from './http';
import type { DrawingStore } from './drawing-store';

/** Concurrency cap for the per-(coin, timeframe) candle fetches. */
const SCAN_CONCURRENCY = 5;

/**
 * Candle window per (coin, timeframe) — a single value for EVERY timeframe
 * (user decision: the lookback must not vary with the period). The volatility
 * detector needs a band + a same-length preceding stretch, so the window must
 * hold both at a reasonable band length.
 */
const SCAN_WINDOW = 100;

/**
 * Raw-candle window for session-gated instruments, which are the only ones whose
 * candles get filtered: closed-market stretches (overnight, weekends, holidays)
 * are dropped before the detector runs, so ~2× the raw bars are needed to end up
 * with `SCAN_WINDOW` tradable ones. Measured density for US equities is 16h of
 * session per 24h weekday (67%), and 0% across a weekend — 2× keeps a normal
 * weekday at a full window and a Monday-morning window at ~2/3 of it, while
 * staying inside Binance's cheapest klines weight band (< 500 → weight 2).
 */
const GATED_SCAN_WINDOW = SCAN_WINDOW * 2;

/** Parameters of the box-braces method (see `detectBoxBrace`). */
export type BoxBraceScanParams = {
  scope?: ScanScope;
  /** Echoed only: the route resolves and validates the source. */
  source?: MarketDataSource;
  minQuoteVolume24h: number;
  /** Scan anchor (epoch ms); absent → now, and the candles are refreshed. */
  anchor?: number;
  /** Box length bounds and the height/travel ceiling, defaulted by `detectBoxBrace`. */
  minRun?: number;
  maxRun?: number;
  maxHeightRatio?: number;
};

/** One row of the box-braces scan. */
export type BoxBraceRow = {
  instrument: string;
  lastPrice: number;
  change24h: number;
  quoteVolume24h: number;
  /** 1-based rank inside this scan's open pool (24h volume order). */
  volumeRank: number;
  box: BoxBrace;
};

/** Response of the box-braces scan: the rows plus the same footnotes the shrink scan reports. */
export type BoxBraceScanResponse = {
  rows: BoxBraceRow[];
  params: BoxBraceScanParams & { scope: ScanScope; anchor: number };
  scannedAt: string;
  /** Open pool size the scan ran on. */
  scanned: number;
  warnings?: string[];
  skippedInstruments?: string[];
  failedInstruments?: string[];
  metadataUnavailable?: boolean;
};

/** Neutral placeholders for a timeframe with no convergence structure. */
/** Raw candles to request for one instrument: gated classes pay for the dropped bars. */
function scanWindowFor(marketClass: MarketClass | undefined): number {
  return marketClass !== undefined && marketSession(marketClass) !== null ? GATED_SCAN_WINDOW : SCAN_WINDOW;
}

/**
 * Whether a failed candle fetch must abort the WHOLE scan instead of being
 * isolated to its own instrument (10/13).
 *
 * Read off the gate, not the error message: a 418 means the IP is banned, and
 * firing more requests only prolongs the ban (`waitOutGate`'s rationale in
 * `http.ts`), so the scan stops right there. Every other failure — timeout,
 * network error, a 429 whose retries are exhausted, or an exchange business
 * error — is the instrument's own problem and never justifies dropping the
 * results of the hundreds of instruments that did fetch fine.
 */
function isIpBanned(gate: Pick<RateGate, 'reason'> | undefined): boolean {
  return gate?.reason() === '418';
}

export class CoinScanService {
  constructor(
    private readonly tickerSource: TickerSource,
    private readonly candleSource: CandleSource,
    private readonly rateLimitGate: Pick<RateGate, 'takeWarnings' | 'reason'> = binanceRateGate,
    /**
     * The user's own drawn levels. Optional: a scan without a store still works,
     * it just reports no 距线 for anybody (the column shows `—`).
     */
    private readonly drawingStore?: DrawingStore,
  ) {}

  /**
   * Two-stage scan over the scope's whole open pool.
   *
   * Stage 1 fetches the coarse timeframe (1D) for EVERY candidate — one klines
   * request each — and screens the pool on its own percentiles: keep the coins
   * whose 23-day range and net drift both sit in the pool's lowest `qR`/`qN`
   * fraction AND whose position inside their whole 1D series is not at the
   * absolute bottom (`COARSE_POS_RANGE_FLOOR` — an absolute rail, unlike the two
   * pool-relative cuts). Rows are the survivors.
   *
   * Stage 2 measures 距你标的线: for every timeframe the USER drew a line on,
   * and only for the instruments that drew one, the scan fetches that
   * timeframe's candles and reports how far the price is from the line, scaled
   * by that coin's own volatility. A coin with no line costs nothing beyond
   * its stage-1 request.
   *
   * 10/20: the automatic convergence detector was removed from this scan — nine
   * attempts at it had all failed, and the user ruled that "收敛算法实现不了"
   * (10-19-fakeout-retest-quality/research/HANDOFF.md §3.1). The user draws the
   * lines; the scan only measures the distance.
   */
  async scanShrink(params: ShrinkScanParams): Promise<ScanResponse> {
    // Discard stale rate-limit warnings (e.g. left by an earlier scan) so only
    // warnings raised DURING this scan are reported.
    this.rateLimitGate.takeWarnings();
    const tickers = await this.tickerSource.listTickers();
    const anchor = params.anchor ?? Date.now();
    // Sub-module of 选品: `crypto` (always open) or `equity` (session-gated).
    const scope = params.scope ?? 'crypto';
    // Order: 24h-volume floor → pool policy → scope → closed-market exclusion.
    // A closed instrument never fires a klines request, and the same goes for
    // classes the scan does not cover at all, or that belong to the other
    // sub-module (the two pools are disjoint by construction).
    const pooled = tickers.filter((ticker) => ticker.quoteVolume24h >= params.minQuoteVolume24h);
    const open: Ticker[] = [];
    const skippedInstruments: string[] = [];
    for (const ticker of pooled) {
      // Absent marketClass (OKX, metadata down, unclassified) => crypto => scannable and always open.
      if (!isScannable(ticker.marketClass)) continue;
      if (scanScopeOf(ticker.marketClass) !== scope) continue;
      if (isMarketOpen(ticker.marketClass ?? 'CRYPTO', anchor)) open.push(ticker);
      else skippedInstruments.push(ticker.instrument);
    }
    // `topN` is an optional CAP now (上限保护): the approved labels sit as deep
    // as 24h-volume rank #319, so a hard top-N gate hid them. Absent → the whole
    // open pool.
    const candidates = params.topN === undefined ? open : open.slice(0, params.topN);
    // Current scans request a refresh so every click on 扫描 gets fresh bars;
    // historical anchored scans still reuse the shared candle cache because that
    // data does not change.
    const refresh = params.anchor === undefined;

    /**
     * The user's drawn levels, per timeframe, keyed by the CANONICAL instrument
     * name (`BTCUSDT`), not the stored name.
     *
     * 10/21: the drawings are stored with the instrument of the chart they were
     * drawn on — the trade review draws on OKX (`BTC-USDT-SWAP`) while the scan
     * pool is Bitget/Binance (`BTCUSDT`). Matching the raw names found NOTHING,
     * so every row read `—` and the 距线 column never meant anything. The
     * canonical name is used for MATCHING only; the stored names are untouched.
     *
     * Only the timeframes the user actually drew on are measured — the scan
     * fetches a timeframe's candles ONLY for instruments that have a line on it,
     * so the extra requests scale with the number of watched coins, not with
     * the pool.
     */
    const linesByTimeframe = new Map<ReviewTimeframe, Map<string, LevelLine[]>>();
    if (this.drawingStore) {
      for (const timeframe of scanTimeframes) {
        const drawings = this.drawingStore.listDrawingsByTimeframe(timeframe);
        if (!drawings.length) continue;
        const byInstrument = new Map<string, LevelLine[]>();
        for (const drawing of drawings) {
          const lines = linesFromDrawings([drawing], drawing.instrument, timeframe);
          if (!lines.length) continue;
          const canonical = canonicalInstrument(drawing.instrument);
          const bucket = byInstrument.get(canonical) ?? [];
          bucket.push(...lines);
          byInstrument.set(canonical, bucket);
        }
        if (byInstrument.size) linesByTimeframe.set(timeframe, byInstrument);
      }
    }

    // ---- Stage 1: the coarse timeframe for the WHOLE candidate pool ----
    // Per-instrument failures are isolated here (10/13): one timed-out klines
    // request used to reject `mapLimit`'s `Promise.all` and take the whole scan
    // down with it, discarding every result fetched so far. A failed candidate
    // now reports no candles, which is the SAME shape a too-short history has —
    // `coarseStructure` reads null, the instrument leaves the percentile base
    // and can never pass — so no new screen branch is introduced. It is a silent
    // omission by nature, which is what `failedInstruments` in the response is
    // there to undo.
    const failedInstruments = new Set<string>();
    /**
     * Why a line could NOT be carried into this source's price basis (10/21).
     * Reported so a «—» or a slightly-off distance is never silently wrong.
     */
    const scaleNotes = new Set<string>();
    const coarseFetches = await mapLimit(candidates, SCAN_CONCURRENCY, async (ticker) => {
      try {
        return { ticker, completed: await this.completedCandles(ticker, COARSE_TIMEFRAME, anchor, refresh) };
      } catch (error) {
        if (isIpBanned(this.rateLimitGate)) throw error;
        failedInstruments.add(ticker.instrument);
        return { ticker, completed: null };
      }
    });
    // The cuts come from THIS scan's own pool — never from a frozen absolute
    // W/D pair, whose pool rate decays as the market moves (see `coarseScreen`).
    const measures = coarseFetches.map(({ completed }) =>
      completed === null ? null : coarseStructure(completed, DEFAULT_COARSE_PARAMS),
    );
    const { screen, passes } = coarseScreen(measures, DEFAULT_COARSE_PARAMS);

    /**
     * ---- Stage 2: the timeframes the user drew lines on ----
     *
     * Only (survivor × timeframe-with-a-line-on-it) pairs are fetched. A coin
     * with no drawn line needs no extra candles at all, so the request count
     * scales with the WATCH LIST, not with the pool.
     */
    const tasks = coarseFetches
      .filter((_, index) => passes[index])
      .flatMap(({ ticker }) =>
        [...linesByTimeframe.entries()]
          .filter(([, byInstrument]) => byInstrument.has(canonicalInstrument(ticker.instrument)))
          .map(([timeframe]) => ({ ticker, timeframe })),
      );
    const results = await mapLimit(tasks, SCAN_CONCURRENCY, async ({ ticker, timeframe }) => {
      try {
        const completed = await this.completedCandles(ticker, timeframe, anchor, refresh);
        const lines = linesByTimeframe.get(timeframe)?.get(canonicalInstrument(ticker.instrument)) ?? [];
        // 10/21: the line was drawn on ANOTHER venue's chart, so its price has
        // to be carried into this venue's price basis before the distance is
        // meaningful. `scaleLinesToSource` uses the drawing's frozen reference
        // (the close of the bar it was drawn on) and this source's close at the
        // same instant; when either is missing it falls back to factor 1 and
        // says so.
        const { lines: scaled, notes } = scaleLinesToSource(lines, (refTime) => closeAt(completed, refTime));
        for (const note of notes) scaleNotes.add(`${ticker.instrument} ${timeframe}: ${note}`);
        const at = completed.at(-1)?.timestamp ?? anchor;
        const alert = levelAlert(completed, scaled, at, scaleStartIndex(completed, scaled));
        return { ticker, timeframe, alert };
      } catch (error) {
        if (isIpBanned(this.rateLimitGate)) throw error;
        failedInstruments.add(ticker.instrument);
        // Dropped rather than faked: a missing alert is an omission, and filling
        // it with a "far" verdict would claim a measurement that never happened.
        return { ticker, timeframe, alert: null };
      }
    });
    const alertByCoinAndTimeframe = new Map<string, LevelAlert>();
    for (const { ticker, timeframe, alert } of results) {
      if (alert !== null) alertByCoinAndTimeframe.set(`${ticker.instrument}:${timeframe}`, alert);
    }

    const scanned: ScanRow[] = [];
    for (const [index, { ticker, completed }] of coarseFetches.entries()) {
      if (!passes[index] || completed === null || failedInstruments.has(ticker.instrument)) continue;
      const levelAlerts = {} as Record<ReviewTimeframe, LevelAlert | null>;
      for (const timeframe of scanTimeframes) {
        if (timeframe === COARSE_TIMEFRAME) {
          // Already fetched in stage 1 — the coarse window IS this series.
          // Same canonical match and same cross-venue price basis as stage 2.
          const lines = linesByTimeframe.get(timeframe)?.get(canonicalInstrument(ticker.instrument)) ?? [];
          const at = completed.at(-1)?.timestamp ?? anchor;
          if (!lines.length) {
            levelAlerts[timeframe] = null;
            continue;
          }
          const { lines: scaled, notes } = scaleLinesToSource(lines, (refTime) => closeAt(completed, refTime));
          for (const note of notes) scaleNotes.add(`${ticker.instrument} ${timeframe}: ${note}`);
          levelAlerts[timeframe] = levelAlert(completed, scaled, at, scaleStartIndex(completed, scaled));
          continue;
        }
        levelAlerts[timeframe] = alertByCoinAndTimeframe.get(`${ticker.instrument}:${timeframe}`) ?? null;
      }
      const alertTimeframes = scanTimeframes.filter((timeframe) => levelAlerts[timeframe]?.state === 'alert');
      const measure = measures[index]!;
      scanned.push({
        instrument: ticker.instrument,
        lastPrice: ticker.lastPrice,
        change24h: ticker.change24h,
        quoteVolume24h: ticker.quoteVolume24h,
        levelAlerts,
        alertTimeframes,
        coarse: {
          pass: true,
          rangePct: measure.rangePct,
          netPct: measure.netPct,
          posRange: measure.posRange,
          rangePctThreshold: screen.rangePctThreshold,
          netPctThreshold: screen.netPctThreshold,
        },
      });
    }

    /**
     * Order: the coins the user should look at FIRST — the ones whose price is
     * closest to a line they drew. 10/20: the old order was "highest converged
     * level, then cross-timeframe consistency, then the strongest score", which
     * ranked a coin by the STRENGTH of a structure the algorithm guessed. Now the
     * user draws the lines, so the only meaningful order is "how close is the
     * price to my line".
     *
     * Key: the smallest ratio (distance ÷ that coin's own volatility scale) wins.
     * A row with no line at all has no ratio and sinks below every measured one.
     */
    const closestRatio = (row: ScanRow): number => {
      const ratios = Object.values(row.levelAlerts)
        .filter((alert): alert is LevelAlert => alert !== null)
        .map((alert) => alert.ratio);
      return ratios.length ? Math.min(...ratios) : Number.POSITIVE_INFINITY;
    };
    scanned.sort((a, b) => closestRatio(a) - closestRatio(b));
    // Echo the effective params, including the resolved scope and anchor
    // (Date.now() when absent), so the response always reflects what ran.
    const echoedParams = { ...params, scope, anchor };
    const response: ScanResponse = {
      scanned,
      qualifiedCount: scanned.length,
      params: echoedParams,
      scannedAt: new Date().toISOString(),
      coarse: {
        windowDays: DEFAULT_COARSE_PARAMS.windowDays,
        pctRange: DEFAULT_COARSE_PARAMS.pctRange,
        pctNet: DEFAULT_COARSE_PARAMS.pctNet,
        poolSize: screen.poolSize,
        rangePctThreshold: screen.rangePctThreshold,
        netPctThreshold: screen.netPctThreshold,
        candidates: candidates.length,
      },
    };
    // A degraded metadata snapshot means NO instrument carried a class, so every
    // closed equity contract was judged as if it were crypto. Say so: this is the
    // one failure mode that silently brings the closed-market pollution back.
    if (this.tickerSource.metadataAvailable?.() === false) response.metadataUnavailable = true;
    // Surface any rate-limit backoffs the scan hit (Binance 429) — a scan can
    // still succeed while the pipeline had to pause for the weight window.
    const warnings = this.rateLimitGate.takeWarnings();
    if (warnings.length > 0) response.warnings = warnings;
    if (skippedInstruments.length > 0) response.skippedInstruments = skippedInstruments;
    // Instruments whose candles could not be fetched. A non-empty list does NOT
    // make the scan a failure — the rest of the pool is real — but it must be
    // visible, because these are valid candidates missing from the result.
    if (failedInstruments.size > 0) response.failedInstruments = [...failedInstruments];
    // Lines that could not be carried into this source's price basis (10/21).
    // Present only when at least one line degraded — a degraded line still
    // measures, but on the wrong price basis, so the user has to know.
    if (scaleNotes.size > 0) response.levelScaleNotes = [...scaleNotes];
    return response;
  }

  /**
   * Box-braces scan (箱体蓄力): the second method, and the one the shrink
   * method cannot express. Every open pool member gets ONE 1D read; the box is
   * detected on the bars up to the anchor, so the scan fires BEFORE a breakout
   * and never uses bars the reviewer could not have seen at that anchor.
   *
   * The daily bar count is capped by `SQUEEZE_MAX_RUN` plus the move lookbacks,
   * which is why this method is CHEAPER than the shrink scan: one request per
   * instrument, no second stage, no coarse screen. That also means it does NOT
   * depend on the coarse screen's pool cuts: a box under a move is exactly the
   * structure the coarse screen rejects for being wide.
   */
  async scanBoxBrace(params: BoxBraceScanParams): Promise<BoxBraceScanResponse> {
    this.rateLimitGate.takeWarnings();
    const tickers = await this.tickerSource.listTickers();
    const anchor = params.anchor ?? Date.now();
    const scope = params.scope ?? 'crypto';
    const rows: BoxBraceRow[] = [];
    const open: Ticker[] = [];
    const skippedInstruments: string[] = [];
    for (const ticker of tickers) {
      if (ticker.quoteVolume24h < params.minQuoteVolume24h) continue;
      if (!isScannable(ticker.marketClass)) continue;
      if (scanScopeOf(ticker.marketClass) !== scope) continue;
      if (isMarketOpen(ticker.marketClass ?? 'CRYPTO', anchor)) open.push(ticker);
      else skippedInstruments.push(ticker.instrument);
    }
    // One 1D read per instrument, no second stage: the same isolation contract
    // as the shrink scan (a failed fetch is the instrument's own problem).
    const order = new Map(open.map((ticker, index) => [ticker, index + 1] as const));
    const failedInstruments = new Set<string>();
    const fetched = await mapLimit(open, SCAN_CONCURRENCY, async (ticker) => {
      try {
        return { ticker, box: await this.boxBraceOf(ticker, anchor, params) };
      } catch (error) {
        if (isIpBanned(this.rateLimitGate)) throw error;
        failedInstruments.add(ticker.instrument);
        return { ticker, box: null };
      }
    });
    for (const { ticker, box } of fetched) {
      if (box === null) continue;
      rows.push({
        instrument: ticker.instrument,
        lastPrice: ticker.lastPrice,
        change24h: ticker.change24h,
        quoteVolume24h: ticker.quoteVolume24h,
        volumeRank: order.get(ticker) ?? 0,
        box,
      });
    }
    // Tightest box first: `squeeze` is a ratio, so it orders across coins of any
    // size. Ties keep the pool order (24h volume), because `Array#sort` is stable.
    rows.sort((a, b) => a.box.squeeze - b.box.squeeze);
    const response: BoxBraceScanResponse = {
      rows,
      params: { ...params, scope, anchor },
      scannedAt: new Date().toISOString(),
      scanned: open.length,
    };
    if (this.tickerSource.metadataAvailable?.() === false) response.metadataUnavailable = true;
    if (skippedInstruments.length > 0) response.skippedInstruments = skippedInstruments;
    if (failedInstruments.size > 0) response.failedInstruments = [...failedInstruments];
    const warnings = this.rateLimitGate.takeWarnings();
    if (warnings.length > 0) response.warnings = warnings;
    return response;
  }

  /** Reads the 1D history this method can see and returns the box, or null. */
  private async boxBraceOf(ticker: Ticker, anchor: number, params: BoxBraceScanParams): Promise<BoxBrace | null> {
    // The window the detector needs: the box plus the widest move lookback.
    const limit = SQUEEZE_MAX_RUN + Math.max(...SQUEEZE_LOOKBACKS) + 10;
    const step = timeframeMs('1D');
    const candles = await this.candleSource.getCandlesticks({
      instrument: ticker.instrument,
      timeframe: '1D',
      anchor,
      direction: 'earlier',
      limit,
      refresh: params.anchor === undefined,
      // Paging ON: venues that cap a page at 90 daily bars need 2 pages for this.
      allowPaging: true,
    });
    const completed = candles.filter((candle) => candle.timestamp + step <= anchor);
    const marketClass = ticker.marketClass ?? 'CRYPTO';
    const tradable = completed.filter((candle) => isCandleInSession(marketClass, candle.timestamp, step));
    return detectBoxBrace(tradable, {
      minRun: params.minRun,
      maxRun: params.maxRun,
      maxHeightRatio: params.maxHeightRatio,
    });
  }

  /**
   * One (coin, timeframe) candle fetch, reduced to the bars a detector may see:
   * the still-forming bar is dropped BY TIME (the cache may or may not hold it,
   * so slicing the newest element unconditionally would wrongly drop the newest
   * COMPLETED bar) and untraded bars are dropped so a closed-market stretch can
   * never read as a quiet 蓄力 band. Ungated classes (crypto, commodity) trade
   * around the clock and lose nothing. Request starts are paced globally in
   * `defaultBinanceFetchJson` / `defaultBitgetMarketFetchJson`.
   */
  private async completedCandles(
    ticker: Ticker,
    timeframe: ReviewTimeframe,
    anchor: number,
    refresh: boolean,
  ): Promise<Candlestick[]> {
    const step = timeframeMs(timeframe);
    const candles = await this.candleSource.getCandlesticks({
      instrument: ticker.instrument,
      timeframe,
      anchor,
      direction: 'earlier',
      limit: scanWindowFor(ticker.marketClass),
      refresh,
    });
    const marketClass = ticker.marketClass ?? 'CRYPTO';
    return candles.filter(
      (candle) => candle.timestamp + step <= anchor && isCandleInSession(marketClass, candle.timestamp, step),
    );
  }
}

/**
 * The close of the bar at (or just before) `timestamp`.
 *
 * Used to carry a line's price basis across venues (10/21): the line was drawn
 * against the close of some bar, and the factor is this source's close at the
 * SAME instant divided by that one. The bar is matched by EXACT timestamp
 * first and then by the newest bar at or before it, because the two venues cut
 * their days differently (Binance 00:00Z, OKX/Bitget 00:00 Beijing) — a
 * timestamp is therefore a moment, not a bar.
 */
function closeAt(candles: readonly Candlestick[], timestamp: number): number | undefined {
  let best: Candlestick | undefined;
  for (const candle of candles) {
    if (candle.timestamp === timestamp) return candle.close;
    if (candle.timestamp < timestamp && (!best || candle.timestamp > best.timestamp)) best = candle;
  }
  return best?.close;
}

/** Runs `mapper` over `items` with at most `concurrency` in-flight promises. */
async function mapLimit<T, R>(items: readonly T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}
