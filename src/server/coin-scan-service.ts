import {
  defaultStructureParams,
  probeStructure,
  scanTimeframes,
  type ScanResponse,
  type ScanRow,
  type ShrinkScanParams,
  type StructureResult,
} from '../domain/coin-scan';
import type { ReviewTimeframe } from '../domain/trade';
import { isMarketOpen } from '../domain/market-session';
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

/** Neutral placeholders for a timeframe with no convergence structure. */
function neutralStructure(): StructureResult {
  return { structure: null, position: 0, score: 0, touchCount: 0, qualified: false };
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
    // Order: 24h-volume threshold → closed-market exclusion → topN slice. A
    // closed TradFi contract must NOT occupy a topN slot (it would otherwise
    // crowd out a live crypto/commodity and burn its topN×5 klines budget).
    const pooled = tickers.filter((ticker) => ticker.quoteVolume24h >= params.minQuoteVolume24h);
    const open: Ticker[] = [];
    const skippedInstruments: string[] = [];
    for (const ticker of pooled) {
      // Absent marketClass (OKX, metadata down, ungated class) => CRYPTO => always open.
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
      // Request starts are paced globally in `defaultBinanceFetchJson`, so the
      // whole scan shares the Binance rate budget with every other caller.
      const candles = await this.candleSource.getCandlesticks({
        instrument: ticker.instrument,
        timeframe,
        anchor,
        direction: 'earlier',
        limit: SCAN_WINDOW,
        // Fresh bars on every 扫描 click: bypass the shared candle cache freshness
        // gate and update the local cache (user decision).
        refresh: params.anchor === undefined,
      });
      // Drop the still-forming bar by time (timestamp + step > anchor). The
      // candle cache may or may not contain the forming bar, so slicing the
      // newest element unconditionally would wrongly drop the newest COMPLETED
      // bar. The anchor applies to every timeframe, so a historical scan sees
      // each timeframe's bars as of that instant.
      const completed = candles.filter((candle) => candle.timestamp + timeframeMs(timeframe) <= anchor);
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
    // Echo the effective params, including the resolved anchor (Date.now() when
    // absent), so the response.params.anchor always reflects what was actually used.
    const echoedParams = { ...params, anchor };
    const response: ScanResponse = {
      scanned,
      qualifiedCount: scanned.length,
      params: echoedParams,
      scannedAt: new Date().toISOString(),
    };
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
