import {
  HEAT_POOL_TOP_N,
  HEAT_TIMEFRAME,
  HEAT_WINDOW_BARS,
  HEAT_WINDOW_MS,
  HEAT_MOVERS_LIMIT,
  VOLATILE_THRESHOLD_PCT,
  classifyTier,
  normalizeToBinance,
  type HeatRow,
  type MarketHeatResult,
  type MarketHeatSkips,
} from '../domain/market-heat';
import type { Candlestick } from '../domain/candlestick';
import { isMarketOpen } from '../domain/market-session';
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
 * NOTE: this service ALWAYS runs against Binance sources (injected by
 * `app-plugin.ts`), independent of `MARKET_DATA_SOURCE`, because the pool is
 * defined as Binance USDT-M top-N and only Binance metadata can gate TradFi
 * sessions.
 */
export class MarketHeatService {
  /** anchor -> (instrument -> row|null; null = coin had no 24h window there). */
  private readonly anchorRows = new Map<number, Map<string, HeatRow | null>>();

  constructor(
    private readonly tickerSource: TickerSource,
    private readonly candleSource: CandleSource,
    private readonly rateLimitWarnings: Pick<RateGate, 'takeWarnings'> = binanceRateGate,
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

    // Session gating matches the scan: a closed TradFi contract never occupies
    // a pool slot (it just sits quiet when its exchange is shut).
    const open: Ticker[] = [];
    const closed: string[] = [];
    for (const ticker of tickers) {
      if (isMarketOpen(ticker.marketClass ?? 'CRYPTO', input.anchor)) open.push(ticker);
      else closed.push(ticker.instrument);
    }
    const pool = open.slice(0, poolTopN);
    const poolInstruments = pool.map((ticker) => ticker.instrument);

    const reviewBinance = input.reviewInstrument ? normalizeToBinance(input.reviewInstrument) : null;
    const unmappedReviewInstrument = Boolean(input.reviewInstrument) && reviewBinance === null;
    const requests = new Set(poolInstruments);
    if (reviewBinance && !requests.has(reviewBinance)) requests.add(reviewBinance);

    const rowsByInstrument = this.anchorCache(input.anchor);
    const missing = [...requests].filter((instrument) => !rowsByInstrument.has(instrument));
    await this.fetchMissing(missing, rowsByInstrument, input.anchor, reviewBinance);

    // Stats over the coins this request actually asked for (pool ∪ review coin).
    let coveredCount = 0;
    let noDataCount = 0;
    let upCount = 0;
    let downCount = 0;
    let volatileCount = 0;
    const covered: HeatRow[] = [];
    for (const instrument of requests) {
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

    let reviewRow: HeatRow | null = null;
    if (reviewBinance) {
      const cached = rowsByInstrument.get(reviewBinance);
      if (cached) reviewRow = { ...cached, isReviewCoin: true };
    }

    const skipped: MarketHeatSkips = { closedCount: closed.length, noDataCount, unmappedReviewInstrument };
    return {
      tier,
      stats: {
        // Pool size = every instrument this reading tried to cover (top-N pool
        // plus a forced review coin), before no-data members are skipped.
        poolSize: requests.size,
        coveredCount,
        medianChangePct,
        upCount,
        downCount,
        volatileCount,
      },
      topGainers: gainers,
      topLosers: losers,
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
    await mapLimit(instruments, HEAT_CONCURRENCY, async (instrument) => {
      // The reviewed coin may name a symbol that no longer exists on Binance;
      // degrade it to "no data" instead of failing the whole reading.
      const degradeToNull = instrument === reviewBinance;
      try {
        const candles = await this.candleSource.getCandlesticks({
          instrument,
          timeframe: HEAT_TIMEFRAME,
          anchor,
          direction: 'earlier',
          limit: HEAT_WINDOW_BARS,
        });
        rowsByInstrument.set(instrument, heatRowFromCandles(candles, instrument, step, refTime, anchor));
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
): HeatRow | null {
  if (candles.length === 0) return null;
  const last = candles[candles.length - 1];
  // Completed-bar guard: a still-forming bar would distort the "as of anchor"
  // reading. The Binance/OKX sources already exclude forming bars on 'earlier',
  // but the review coin path may feed arbitrary data.
  if (last.timestamp + step > anchor) return null;
  let refIndex = -1;
  for (let i = candles.length - 1; i >= 0; i -= 1) {
    if (candles[i].timestamp + step <= refTime) {
      refIndex = i;
      break;
    }
  }
  if (refIndex < 0) return null;
  const refClose = candles[refIndex].close;
  const curClose = last.close;
  if (!(refClose > 0) || !(curClose > 0)) return null;
  // Candles carry base volume only; quote volume ≈ Σ close × volume.
  let quote = 0;
  for (let i = refIndex; i < candles.length; i += 1) quote += candles[i].close * candles[i].volume;
  return {
    instrument,
    changePct: (curClose / refClose - 1) * 100,
    windowQuoteVolume: quote,
    isReviewCoin: false,
  };
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
