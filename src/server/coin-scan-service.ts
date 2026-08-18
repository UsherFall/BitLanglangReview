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
import { timeframeMs } from './candlestick-service';
import type { CandleSource, TickerSource } from './market-data';

/** Concurrency cap for the per-(coin, timeframe) candle fetches. */
const SCAN_CONCURRENCY = 10;

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
  ) {}

  /**
   * Multi-timeframe convergence scan: pulls the top-N pool's candles once per
   * timeframe (parallel pool over the shared candle cache), probes each
   * (coin, timeframe) window for a volatility convergence (波动率越来越小), and
   * returns one row per coin that converges on at least one timeframe, sorted by
   * qualifiedCount desc then bestScore desc (score larger = stronger).
   */
  async scanShrink(params: ShrinkScanParams): Promise<ScanResponse> {
    const tickers = await this.tickerSource.listTickers();
    const top = tickers
      .filter((ticker) => ticker.quoteVolume24h >= params.minQuoteVolume24h)
      .slice(0, params.topN);

    const anchor = params.anchor ?? Date.now();
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
      const candles = await this.candleSource.getCandlesticks({
        instrument: ticker.instrument,
        timeframe,
        anchor,
        direction: 'earlier',
        limit: SCAN_WINDOW,
          // The user asks for a fresh scan every time they click 扫描, so bypass
          // the shared candle cache freshness gate and update the local cache.
          refresh: params.anchor === undefined,
                    
          // the shared candle cache freshness gate and update the local cache.
  
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
    return { scanned, qualifiedCount: scanned.length, params: echoedParams, scannedAt: new Date().toISOString() };
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
