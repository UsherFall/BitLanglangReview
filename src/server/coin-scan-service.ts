import type { Candlestick } from '../domain/candlestick';
import {
  COARSE_TIMEFRAME,
  DEFAULT_COARSE_PARAMS,
  coarseScreen,
  coarseStructure,
  defaultStructureParams,
  probeStructure,
  scanTimeframes,
  timeframeMinScore,
  type ScanResponse,
  type ScanRow,
  type ShrinkScanParams,
  type StructureResult,
} from '../domain/coin-scan';
import { isCandleInSession, isMarketOpen, marketSession } from '../domain/market-session';
import type { MarketClass } from '../domain/market-class';
import { isScannable } from '../domain/scan-pool';
import { scanScopeOf } from '../domain/scan-scope';
import type { ReviewTimeframe } from '../domain/trade';
import { timeframeMs } from './candlestick-service';
import type { CandleSource, Ticker, TickerSource } from './market-data';
import { binanceRateGate, type RateGate } from './http';

/** Concurrency cap for the per-(coin, timeframe) candle fetches. */
const SCAN_CONCURRENCY = 5;

/** Every timeframe except the coarse one: fetched ONLY for the coarse screen's survivors. */
const REMAINING_TIMEFRAMES = scanTimeframes.filter((timeframe) => timeframe !== COARSE_TIMEFRAME);

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

/** Neutral placeholders for a timeframe with no convergence structure. */
function neutralStructure(): StructureResult {
  return { structure: null, position: 0, score: 0, touchCount: 0, qualified: false };
}

/** Raw candles to request for one instrument: gated classes pay for the dropped bars. */
function scanWindowFor(marketClass: MarketClass | undefined): number {
  return marketClass !== undefined && marketSession(marketClass) !== null ? GATED_SCAN_WINDOW : SCAN_WINDOW;
}

export class CoinScanService {
  constructor(
    private readonly tickerSource: TickerSource,
    private readonly candleSource: CandleSource,
    private readonly rateLimitWarnings: Pick<RateGate, 'takeWarnings'> = binanceRateGate,
  ) {}

  /**
   * Two-stage convergence scan over the scope's whole open pool.
   *
   * Stage 1 fetches the coarse timeframe (1D) for EVERY candidate — one klines
   * request each — and screens the pool on its own percentiles: keep the coins
   * whose 23-day range and net drift both sit in the pool's lowest `qR`/`qN`
   * fraction AND whose position inside their whole 1D series is not at the
   * absolute bottom (`COARSE_POS_RANGE_FLOOR` — an absolute rail, unlike the two
   * pool-relative cuts). Stage 2 then fetches the remaining four timeframes ONLY
   * for the survivors, which is what makes the expanded pool affordable (a
   * rejected coin costs exactly one request). Rows are the survivors, ordered by
   * their highest converged level, then `qualifiedCount`, then `bestScore`; the
   * per-timeframe convergence verdicts are reported alongside but no longer decide
   * inclusion.
   */
  async scanShrink(params: ShrinkScanParams): Promise<ScanResponse> {
    // Discard stale rate-limit warnings (e.g. left by an earlier scan) so only
    // warnings raised DURING this scan are reported.
    this.rateLimitWarnings.takeWarnings();
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
    const structureParams = defaultStructureParams();
    // minScore gate: a timeframe counts as converged only when its structure is
    // qualified AND its score reaches its OWN effective threshold — the single
    // knob shifted by the level's offset, so a 4H/1D contraction clears a
    // slightly lower bar (see `TIMEFRAME_SCORE_OFFSET`).
    const minScore = params.minScore ?? 0;
    // Current scans request a refresh so every click on 扫描 gets fresh bars;
    // historical anchored scans still reuse the shared candle cache because that
    // data does not change.
    const refresh = params.anchor === undefined;

    // ---- Stage 1: the coarse timeframe for the WHOLE candidate pool ----
    const coarseFetches = await mapLimit(candidates, SCAN_CONCURRENCY, async (ticker) => ({
      ticker,
      completed: await this.completedCandles(ticker, COARSE_TIMEFRAME, anchor, refresh),
    }));
    // The cuts come from THIS scan's own pool — never from a frozen absolute
    // W/D pair, whose pool rate decays as the market moves (see `coarseScreen`).
    const measures = coarseFetches.map(({ completed }) => coarseStructure(completed, DEFAULT_COARSE_PARAMS));
    const { screen, passes } = coarseScreen(measures, DEFAULT_COARSE_PARAMS);

    // ---- Stage 2: the other four timeframes, only for the survivors ----
    const tasks = coarseFetches
      .filter((_, index) => passes[index])
      .flatMap(({ ticker }) => REMAINING_TIMEFRAMES.map((timeframe) => ({ ticker, timeframe })));
    const results = await mapLimit(tasks, SCAN_CONCURRENCY, async ({ ticker, timeframe }) => {
      const completed = await this.completedCandles(ticker, timeframe, anchor, refresh);
      return { ticker, timeframe, structure: probeStructure(completed, structureParams) };
    });
    const byCoinAndTimeframe = new Map(results.map((r) => [`${r.ticker.instrument}:${r.timeframe}`, r.structure]));

    const scanned: ScanRow[] = [];
    for (const [index, { ticker, completed }] of coarseFetches.entries()) {
      if (!passes[index]) continue;
      const structures = {} as Record<ReviewTimeframe, StructureResult>;
      for (const timeframe of scanTimeframes) {
        if (timeframe === COARSE_TIMEFRAME) {
          // Already fetched in stage 1 — the coarse window IS this series.
          structures[timeframe] = probeStructure(completed, structureParams) ?? neutralStructure();
          continue;
        }
        structures[timeframe] = byCoinAndTimeframe.get(`${ticker.instrument}:${timeframe}`) ?? neutralStructure();
      }
      const converged = scanTimeframes.filter((timeframe) => {
        const structure = structures[timeframe];
        return structure.qualified && structure.score >= timeframeMinScore(timeframe, minScore);
      });
      const measure = measures[index]!;
      scanned.push({
        instrument: ticker.instrument,
        lastPrice: ticker.lastPrice,
        change24h: ticker.change24h,
        quoteVolume24h: ticker.quoteVolume24h,
        structures,
        convergedTimeframes: converged,
        qualifiedCount: converged.length,
        // Strongest score across the converged timeframes (larger = stronger);
        // 0 when the coarse screen kept a coin that converges nowhere.
        bestScore: converged.length > 0 ? Math.max(...converged.map((timeframe) => structures[timeframe].score)) : 0,
        qualified: true,
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

    // Order: the highest qualified level first (a lone 1D contraction is a rarer
    // setup than a short-timeframe one), then cross-timeframe consistency, then
    // the strongest structure within each count. The level is the
    // `scanTimeframes` index (5m = 0 … 1D = 4), derived here rather than stored
    // on the row — `ScanRow` keeps its contract, and `convergedTimeframes`
    // already lets a caller read the strongest timeframe off. A coin the coarse
    // screen kept but which converges nowhere has no level, reads as -1, and
    // sinks below every converging row. Equal keys keep the original ticker
    // (24h-volume) order: `Array#sort` is stable.
    const highestLevel = (row: ScanRow) =>
      row.convergedTimeframes.length === 0
        ? -1
        : Math.max(...row.convergedTimeframes.map((timeframe) => scanTimeframes.indexOf(timeframe)));
    scanned.sort(
      (a, b) => highestLevel(b) - highestLevel(a) || b.qualifiedCount - a.qualifiedCount || b.bestScore - a.bestScore,
    );
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
    const warnings = this.rateLimitWarnings.takeWarnings();
    if (warnings.length > 0) response.warnings = warnings;
    if (skippedInstruments.length > 0) response.skippedInstruments = skippedInstruments;
    return response;
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
