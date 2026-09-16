import {
  defaultStructureParams,
  probeStructure,
  scanTimeframes,
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
   * Multi-timeframe convergence scan: pulls the top-N pool's candles once per
   * timeframe (parallel pool over the shared candle cache), probes each
   * (coin, timeframe) window for a volatility convergence (波动率越来越小), and
   * returns one row per coin that converges on at least one timeframe, sorted by
   * qualifiedCount desc then bestScore desc (score larger = stronger).
   */
  async scanShrink(params: ShrinkScanParams): Promise<ScanResponse> {
    // Discard stale rate-limit warnings (e.g. left by an earlier scan) so only
    // warnings raised DURING this scan are reported.
    this.rateLimitWarnings.takeWarnings();
    const tickers = await this.tickerSource.listTickers();
    const anchor = params.anchor ?? Date.now();
    // Sub-module of 选品: `crypto` (always open) or `equity` (session-gated).
    const scope = params.scope ?? 'crypto';
    // Order: 24h-volume threshold → pool policy → scope → closed-market exclusion
    // → topN slice. A closed instrument must NOT occupy a topN slot (it would
    // otherwise crowd out a live one and burn its topN×5 klines budget), and the
    // same goes for classes the scan does not cover at all, or that belong to the
    // other sub-module (the two pools are disjoint by construction).
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
    const top = open.slice(0, params.topN);
    const structureParams = defaultStructureParams();
    // minScore gate: a timeframe counts as converged only when its structure is
    // qualified AND (minScore absent OR score >= minScore).
    const minScore = params.minScore ?? 0;

    // One fetch task per (coin, timeframe). Current scans request a refresh so
    // every click on 扫描 gets fresh bars; historical anchored scans still reuse
    // the shared candle cache because that data does not change.
    const tasks = top.flatMap((ticker) =>
      scanTimeframes.map((timeframe) => ({ ticker, timeframe })),
    );
    const results = await mapLimit(tasks, SCAN_CONCURRENCY, async ({ ticker, timeframe }) => {
      const step = timeframeMs(timeframe);
      // Request starts are paced globally in `defaultBinanceFetchJson`, so the
      // whole scan shares the Binance rate budget with every other caller.
      const candles = await this.candleSource.getCandlesticks({
        instrument: ticker.instrument,
        timeframe,
        anchor,
        direction: 'earlier',
        limit: scanWindowFor(ticker.marketClass),
        // Fresh bars on every 扫描 click: bypass the shared candle cache freshness
        // gate and update the local cache (user decision).
        refresh: params.anchor === undefined,
      });
      const marketClass = ticker.marketClass ?? 'CRYPTO';
      // Two independent filters, both needed:
      // - drop the still-forming bar by time (the cache may or may not hold it,
      //   so slicing the newest element unconditionally would wrongly drop the
      //   newest COMPLETED bar);
      // - keep only candles that contain real trading time, so a closed-market
      //   stretch can never read as a quiet 蓄力 band. Ungated classes (crypto,
      //   commodity) trade around the clock and lose nothing.
      const completed = candles.filter(
        (candle) => candle.timestamp + step <= anchor && isCandleInSession(marketClass, candle.timestamp, step),
      );
      const structure = probeStructure(completed, structureParams);
      return { ticker, timeframe, structure };
    });
    const byCoinAndTimeframe = new Map(results.map((r) => [`${r.ticker.instrument}:${r.timeframe}`, r.structure]));

    const scanned: ScanRow[] = [];
    for (const ticker of top) {
      const structures = {} as Record<ReviewTimeframe, StructureResult>;
      for (const timeframe of scanTimeframes) {
        const structure = byCoinAndTimeframe.get(`${ticker.instrument}:${timeframe}`);
        structures[timeframe] = structure ?? neutralStructure();
      }
      const converged = scanTimeframes.filter((timeframe) => {
        const structure = structures[timeframe];
        return structure.qualified && structure.score >= minScore;
      });
      // Only coins with >= 1 qualified (and score-passing) timeframe appear
      // (宁少勿滥); a coin with no convergence is not shown at all.
      if (converged.length === 0) continue;
      scanned.push({
        instrument: ticker.instrument,
        lastPrice: ticker.lastPrice,
        change24h: ticker.change24h,
        quoteVolume24h: ticker.quoteVolume24h,
        structures,
        convergedTimeframes: converged,
        qualifiedCount: converged.length,
        // Strongest score across the qualified timeframes (larger = stronger).
        bestScore: Math.max(...converged.map((timeframe) => structures[timeframe].score)),
        qualified: true,
      });
    }

    // Multi-timeframe convergence first (cross-timeframe consistency is a
    // stronger signal), then the strongest structure within each count.
    scanned.sort((a, b) => b.qualifiedCount - a.qualifiedCount || b.bestScore - a.bestScore);
    // Echo the effective params, including the resolved scope and anchor
    // (Date.now() when absent), so the response always reflects what ran.
    const echoedParams = { ...params, scope, anchor };
    const response: ScanResponse = {
      scanned,
      qualifiedCount: scanned.length,
      params: echoedParams,
      scannedAt: new Date().toISOString(),
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
