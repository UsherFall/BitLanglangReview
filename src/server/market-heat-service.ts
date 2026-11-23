import {
  HEAT_POOL_TOP_N,
  HEAT_ACTIVITY_POOL_TOP_N,
  HEAT_BASELINE_DAILY_BARS,
  HEAT_TIMEFRAME,
  HEAT_WINDOW_BARS,
  HEAT_WINDOW_MS,
  HEAT_MOVERS_LIMIT,
  VOLATILE_THRESHOLD_PCT,
  classifyTier,
  computeActivityScore,
  normalizeToBinance,
  type HeatRow,
  type MarketHeatResult,
  type MarketHeatSkips,
} from '../domain/market-heat';
import type { Candlestick } from '../domain/candlestick';
import { isMarketOpen } from '../domain/market-session';
import { isScannable } from '../domain/scan-pool';
import { timeframeMs } from './candlestick-service';
import type { CandleSource, Ticker, TickerSource } from './market-data';
import { binanceRateGate, type RateGate } from './http';

/** Concurrency cap for per-coin candle fetches inside one heat computation. */
const HEAT_CONCURRENCY = 3;

/** In-memory anchor cache: rows survive across trades that share an anchor. */
const MAX_CACHED_ANCHORS = 50;

/**
 * Market temperature (市场热度): at a review anchor (trade entry/exit time),
 * aggregates the 24h change distribution of the top Binance USDT-M pool and the
 * reviewed coin into a five-tier heat reading plus gainers/losers lists.
 *
 * Historical tickers are never persisted, so every coin's move is computed from
 * its candles around the anchor (`HEAT_TIMEFRAME`, 100 bars covering 25h). Each
 * per-coin fetch writes into the shared candlestick cache, and rows for an
 * anchor are memoized in memory, so:
 *
 * - reopening the same anchor issues zero network requests;
 * - consecutive review anchors reuse whichever 24h slices already sit in cache;
 * - an interrupted run (418 ban) keeps already-fetched coins for a cheaper retry.
 *
 * Rate-limit behavior follows the scan: 429 backoff pauses the whole pipeline,
 * 418 fails fast with a warning surfaced on the response; no silent retry.
 *
 * NOTE: each instance runs against the ticker/candle sources selected for the
 * request, independent of `MARKET_DATA_SOURCE`, because the pool is defined by
 * that source's USDT perpetual universe and session metadata.
 */
export class MarketHeatService {
  /** anchor -> (instrument -> row|null; null = coin had no 24h window there). */
  private readonly anchorRows = new Map<number, Map<string, HeatRow | null>>();

  constructor(
    private readonly tickerSource: TickerSource,
    private readonly candleSource: CandleSource,
    private readonly rateLimitWarnings: Pick<RateGate, 'takeWarnings'> = binanceRateGate,
    private readonly dailyGrid: 'utc' | 'shanghai' = 'utc',
  ) {}

  async computeHeat(input: {
    anchor: number;
    /** Review symbol as shown in the workbook/Bitget (e.g. BTC-USDT-SWAP). */
    reviewInstrument?: string;
    /** Pool size override (defaults to HEAT_POOL_TOP_N); used by tests to keep pools small. */
    poolTopN?: number;
  }): Promise<MarketHeatResult> {
    // Discard stale warnings so only those raised DURING this computation report.
    this.rateLimitWarnings.takeWarnings();

    const poolTopN = input.poolTopN ?? HEAT_POOL_TOP_N;
    const tickers = await this.tickerSource.listTickers();

    // Pool policy + session gating match the scan: classes the scan does not
    // cover are not part of the 场子 reading either, and a closed TradFi contract
    // never occupies a pool slot (it just sits quiet when its exchange is shut).
    const open: Ticker[] = [];
    const closed: string[] = [];
    for (const ticker of tickers) {
      if (!isScannable(ticker.marketClass)) continue;
      if (isMarketOpen(ticker.marketClass ?? 'CRYPTO', input.anchor)) open.push(ticker);
      else closed.push(ticker.instrument);
    }
    const pool = open.slice(0, poolTopN);
    const activityPool = open.slice(0, input.poolTopN ?? HEAT_ACTIVITY_POOL_TOP_N);
    const poolInstruments = pool.map((ticker) => ticker.instrument);

    const reviewBinance = input.reviewInstrument ? normalizeToBinance(input.reviewInstrument) : null;
    const unmappedReviewInstrument = Boolean(input.reviewInstrument) && reviewBinance === null;
    const statsRequests = new Set(poolInstruments);
    const activityRequests = new Set(activityPool.map((ticker) => ticker.instrument));
    if (reviewBinance) {
      statsRequests.add(reviewBinance);
      activityRequests.add(reviewBinance);
    }
    const requests = new Set([...statsRequests, ...activityRequests]);

    const rowsByInstrument = this.anchorCache(input.anchor);
    const missing = [...requests].filter((instrument) => !rowsByInstrument.has(instrument));
    await this.fetchMissing(missing, rowsByInstrument, input.anchor, reviewBinance);

    // Stats over the Top80 market pool only. The wider activity universe must
    // not change breadth, median, tier, or the legacy gainers/losers boards.
    let coveredCount = 0;
    let noDataCount = 0;
    let upCount = 0;
    let downCount = 0;
    let volatileCount = 0;
    const covered: HeatRow[] = [];
    for (const instrument of statsRequests) {
      const row = rowsByInstrument.get(instrument);
      if (!row) {
        noDataCount += 1;
        continue;
      }
      coveredCount += 1;
      covered.push(row);
      if (row.changePct > 0) upCount += 1;
      else if (row.changePct < 0) downCount += 1;
      if (Math.abs(row.changePct) >= VOLATILE_THRESHOLD_PCT) volatileCount += 1;
    }

    const changes = covered.map((row) => row.changePct).sort((a, b) => a - b);
    const medianChangePct = changes.length > 0 ? median(changes) : 0;
    // Zero covered coins is "no reading", not a cold market.
    const tier = coveredCount > 0 ? classifyTier(upCount / coveredCount, medianChangePct) : 'neutral';

    // Boards copy each cached row so the review-coin flag is derived from the
    // CURRENT request — never mutated onto rows shared across anchors/trades.
    const flagReview = (row: HeatRow): HeatRow => ({ ...row, isReviewCoin: row.instrument === reviewBinance });
    const gainers = covered.filter((row) => row.changePct > 0).sort((a, b) => b.changePct - a.changePct).slice(0, HEAT_MOVERS_LIMIT).map(flagReview);
    const losers = covered.filter((row) => row.changePct < 0).sort((a, b) => a.changePct - b.changePct).slice(0, HEAT_MOVERS_LIMIT).map(flagReview);
    const activityCandidates = [...activityRequests]
      .map((instrument) => rowsByInstrument.get(instrument))
      .filter((row): row is HeatRow => Boolean(row))
      .map(flagReview)
      .sort(compareActivityRows);

    let reviewRow: HeatRow | null = null;
    if (reviewBinance) {
      const cached = rowsByInstrument.get(reviewBinance);
      if (cached) reviewRow = { ...cached, isReviewCoin: true };
    }

    const skipped: MarketHeatSkips = { closedCount: closed.length, noDataCount, unmappedReviewInstrument };
    return {
      tier,
      stats: {
        // Pool size = every instrument in the Top80 market reading plus a forced
        // review coin. Activity-only members are deliberately excluded.
        poolSize: statsRequests.size,
        coveredCount,
        medianChangePct,
        upCount,
        downCount,
        volatileCount,
      },
      topGainers: gainers,
      topLosers: losers,
      activityCandidates,
      activityPoolSize: input.poolTopN ?? HEAT_ACTIVITY_POOL_TOP_N,
      reviewCoin: reviewRow,
      skipped,
      warnings: this.rateLimitWarnings.takeWarnings(),
    };
  }

  private anchorCache(anchor: number): Map<string, HeatRow | null> {
    let rows = this.anchorRows.get(anchor);
    if (!rows) {
      if (this.anchorRows.size >= MAX_CACHED_ANCHORS) {
        const oldest = this.anchorRows.keys().next().value;
        if (oldest !== undefined) this.anchorRows.delete(oldest);
      }
      rows = new Map();
      this.anchorRows.set(anchor, rows);
    }
    return rows;
  }

  private async fetchMissing(
    instruments: string[],
    rowsByInstrument: Map<string, HeatRow | null>,
    anchor: number,
    reviewBinance: string | null,
  ): Promise<void> {
    const step = timeframeMs(HEAT_TIMEFRAME);
    const refTime = anchor - HEAT_WINDOW_MS;
    // A live anchor can sit inside the current 15m bar. Fetch from the completed
    // boundary so OKX's earlier-contiguity seed cannot reject its newest closed
    // candle; heatRowFromCandles still judges the original anchor below.
    const candleAnchor = Math.floor(anchor / step) * step;
    const dailyAnchor = dailyFetchAnchor(anchor, this.dailyGrid);
    await mapLimit(instruments, HEAT_CONCURRENCY, async (instrument) => {
      // The reviewed coin may name a symbol that no longer exists on Binance;
      // degrade it to "no data" instead of failing the whole reading.
      const degradeToNull = instrument === reviewBinance;
      try {
        const [candles, dailyCandles] = await Promise.all([
          this.candleSource.getCandlesticks({
            instrument,
            timeframe: HEAT_TIMEFRAME,
            anchor: candleAnchor,
            direction: 'earlier',
            limit: HEAT_WINDOW_BARS,
          }),
          this.candleSource.getCandlesticks({
            instrument,
            timeframe: '1D',
            anchor: dailyAnchor,
            direction: 'earlier',
            limit: HEAT_BASELINE_DAILY_BARS + 1,
          }),
        ]);
        rowsByInstrument.set(instrument, heatRowFromCandles(candles, instrument, step, refTime, anchor, dailyCandles));
      } catch (error) {
        if (degradeToNull) {
          rowsByInstrument.set(instrument, null);
          return;
        }
        throw error;
      }
    });
  }
}

/**
 * Builds one coin's 24h-move row from ascending completed candles fetched just
 * before the anchor. The current price is the newest completed close; the
 * reference is the close of the last candle completed before `anchor − 24h`.
 * Returns null when the history does not reach that far back (listed later, or a
 * cache/fetch gap), which the caller counts as a no-data skip.
 */
function heatRowFromCandles(
  candles: Candlestick[],
  instrument: string,
  step: number,
  refTime: number,
  anchor: number,
  dailyCandles: Candlestick[],
): HeatRow | null {
  // Completed-bar guard: the anchor's containing bar is still forming at the
  // anchor instant and would distort the "as of anchor" reading. Sources may
  // return it (OKX always has, and Binance does now that `earlier` includes the
  // anchor's bar), so drop incomplete bars here rather than degrading the whole
  // instrument to no-data.
  const completed = candles.filter((candle) => candle.timestamp + step <= anchor);
  if (completed.length === 0) return null;
  const last = completed[completed.length - 1];
  let refIndex = -1;
  for (let i = completed.length - 1; i >= 0; i -= 1) {
    if (completed[i].timestamp + step <= refTime) {
      refIndex = i;
      break;
    }
  }
  if (refIndex < 0) return null;
  const refClose = completed[refIndex].close;
  const curClose = last.close;
  if (!(refClose > 0) || !(curClose > 0)) return null;
  // Candles carry base volume only; quote volume ≈ Σ close × volume.
  let quote = 0;
  for (let i = refIndex; i < completed.length; i += 1) quote += completed[i].close * completed[i].volume;
  const activityBars = completed.slice(refIndex);
  const firstOpen = activityBars[0]?.open ?? curClose;
  const high = Math.max(...activityBars.map((candle) => candle.high));
  const low = Math.min(...activityBars.map((candle) => candle.low));
  const currentRangePct = (high - low) / firstOpen * 100;
  const recentBars = activityBars.slice(-16);
  const previousBars = activityBars.slice(0, -16);
  const recentQuote = recentBars.reduce((sum, candle) => sum + candle.close * candle.volume, 0);
  const previousQuote = previousBars.reduce((sum, candle) => sum + candle.close * candle.volume, 0);

  // One extra daily bar is requested because the anchor's own day may still be
  // forming. Only completed daily candles enter the 20-day baseline.
  const baseline = dailyCandles
    .filter((candle) => candle.timestamp + HEAT_WINDOW_MS <= anchor)
    .slice(-HEAT_BASELINE_DAILY_BARS);
  const dailyQuotes = baseline.map((candle) => candle.close * candle.volume).sort((a, b) => a - b);
  const dailyRanges = baseline.map((candle) => (candle.high - candle.low) / candle.open * 100).sort((a, b) => a - b);
  const enoughBaseline = baseline.length >= HEAT_BASELINE_DAILY_BARS && dailyQuotes.length > 0 && dailyRanges.length > 0;
  const baselineQuote = enoughBaseline ? median(dailyQuotes) : 0;
  const baselineRange = enoughBaseline ? median(dailyRanges) : 0;
  const quoteVolumeRatio20d = baselineQuote > 0 && quote > 0 ? quote / baselineQuote : null;
  const rangeRatio20d = baselineRange > 0 && currentRangePct > 0 ? currentRangePct / baselineRange : null;
  return {
    instrument,
    changePct: (curClose / refClose - 1) * 100,
    windowQuoteVolume: quote,
    quoteVolumeRatio20d,
    rangeRatio20d,
    activityScore: computeActivityScore(quoteVolumeRatio20d, rangeRatio20d),
    recent4hVolumeIntensity: recentBars.length > 0 && previousBars.length > 0 && previousQuote > 0
      ? (recentQuote / recentBars.length) / (previousQuote / previousBars.length)
      : null,
    isReviewCoin: false,
  };
}

function dailyFetchAnchor(anchor: number, grid: 'utc' | 'shanghai'): number {
  const offset = grid === 'shanghai' ? 8 * 60 * 60 * 1000 : 0;
  return Math.floor((anchor + offset) / HEAT_WINDOW_MS) * HEAT_WINDOW_MS - offset;
}

function compareActivityRows(a: HeatRow, b: HeatRow): number {
  const aScore = a.activityScore ?? Number.NEGATIVE_INFINITY;
  const bScore = b.activityScore ?? Number.NEGATIVE_INFINITY;
  if (aScore !== bScore) return bScore - aScore;
  return Math.abs(b.changePct) - Math.abs(a.changePct);
}

function median(sortedAsc: number[]): number {
  const mid = Math.floor(sortedAsc.length / 2);
  if (sortedAsc.length % 2 === 1) return sortedAsc[mid]!;
  return (sortedAsc[mid - 1]! + sortedAsc[mid]!) / 2;
}

/** Runs `mapper` over `items` with at most `concurrency` in-flight promises. */
async function mapLimit<T, R>(items: readonly T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}
