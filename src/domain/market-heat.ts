/**
 * Market temperature (市场热度): decides whether the market at a review anchor
 * was hot or cold by aggregating the 24h change distribution of the selected
 * source's top pool. Pure domain: no IO, no fetch. All tier thresholds and window
 * sizes are constants here so they can be recalibrated in one place once real
 * data is available.
 */

/** 24h trailing window of each coin's change, measured at the anchor. */
export const HEAT_WINDOW_MS = 24 * 60 * 60 * 1000;
/** 15m bars × 100 = 25h of lookback, enough to cover a 24h window. */
export const HEAT_TIMEFRAME = '15m';
export const HEAT_WINDOW_BARS = 100;

/** Default pool size: selected-source USDT perpetuals top-N by 24h quote volume. */
export const HEAT_POOL_TOP_N = 80;
/** Wider universe for the activity worklist; tier/stats stay on HEAT_POOL_TOP_N. */
export const HEAT_ACTIVITY_POOL_TOP_N = 120;
/** Completed daily bars used by relative volume/range baselines. */
export const HEAT_BASELINE_DAILY_BARS = 20;

/** Breadth/median tier boundaries (暂定, recalibrate against real data). */
export const TIER_UP_RATIO = 0.6;
export const TIER_MEDIAN_PCT = 1;

/** |24h change| above this counts a coin as 异动. */
export const VOLATILE_THRESHOLD_PCT = 5;

/** Gainers/losers list length on each side. */
export const HEAT_MOVERS_LIMIT = 10;

/** 热 / 偏热 / 中性 / 偏冷 / 冷 五档温度。 */
export type MarketTier = 'hot' | 'warm' | 'neutral' | 'cool' | 'cold';

/** One pool coin's 24h move at the anchor. */
export type HeatRow = {
  /** Selected-source symbol (e.g. BTCUSDT, or the source's native name). */
  instrument: string;
  /** 24h change in percent, trailing from the anchor. */
  changePct: number;
  /** Approximate USDT quote volume over the 24h window (Σ close × volume). */
  windowQuoteVolume: number;
  /** Rolling 24h quote volume / median of the last 20 completed daily values. */
  quoteVolumeRatio20d?: number | null;
  /** Rolling 24h high-low range / median of the last 20 completed daily ranges. */
  rangeRatio20d?: number | null;
  /** Descriptive attention ordering only: sqrt(volume ratio × range ratio). */
  activityScore?: number | null;
  /** Last-4h hourly quote volume / previous-20h hourly quote volume. */
  recent4hVolumeIntensity?: number | null;
  /** True when this row is the trade being reviewed (forced into the pool). */
  isReviewCoin: boolean;
};

export type MarketHeatStats = {
  /** Pool size before skipping (closed / no-data members are excluded). */
  poolSize: number;
  /** Coins that contributed a change value. */
  coveredCount: number;
  /** Median 24h change (%) across covered coins. */
  medianChangePct: number;
  upCount: number;
  downCount: number;
  /** Coins with |24h change| >= VOLATILE_THRESHOLD_PCT. */
  volatileCount: number;
};

export type MarketHeatSkips = {
  /** Pool members whose market session was closed at the anchor (休市跳过). */
  closedCount: number;
  /** Pool members with no 24h window (listed later, or cache gap). */
  noDataCount: number;
  /** True when the reviewed symbol could not be normalized to a Binance name. */
  unmappedReviewInstrument: boolean;
};

export type MarketHeatResult = {
  tier: MarketTier;
  stats: MarketHeatStats;
  topGainers: HeatRow[];
  topLosers: HeatRow[];
  /** Full activity-sorted worklist (null metrics last); old boards stay unchanged. */
  activityCandidates?: HeatRow[];
  /** Activity universe target size (120 in production); never changes stats.poolSize. */
  activityPoolSize?: number;
  /** The reviewed coin's row when it exists in the pool and has data. */
  reviewCoin: HeatRow | null;
  skipped: MarketHeatSkips;
  /** Rate-limit backoff warnings surfaced during computation (Binance 429). */
  warnings: string[];
};

/**
 * Five-tier temperature from the pool's breadth and median move:
 *
 * | tier    | condition                                             |
 * |---------|-------------------------------------------------------|
 * | hot     | upRatio >= TIER_UP_RATIO AND median >= +TIER_MEDIAN_PCT |
 * | cold    | downRatio >= TIER_UP_RATIO AND median <= -TIER_MEDIAN_PCT |
 * | warm    | upRatio >= TIER_UP_RATIO OR median >= +TIER_MEDIAN_PCT |
 * | cool    | downRatio >= TIER_UP_RATIO OR median <= -TIER_MEDIAN_PCT |
 * | neutral | otherwise (split, flat market)                        |
 *
 * upRatio = fraction of covered coins with change > 0, median in percent.
 * A contradictory reading (breadth up but median deeply down) resolves to warm
 * via the OR branch, deterministically.
 */
export function classifyTier(upRatio: number, medianPct: number): MarketTier {
  const breadthUp = upRatio >= TIER_UP_RATIO;
  const breadthDown = 1 - upRatio >= TIER_UP_RATIO;
  const magnitudeUp = medianPct >= TIER_MEDIAN_PCT;
  const magnitudeDown = medianPct <= -TIER_MEDIAN_PCT;
  if (breadthUp && magnitudeUp) return 'hot';
  if (breadthDown && magnitudeDown) return 'cold';
  if (breadthUp || magnitudeUp) return 'warm';
  if (breadthDown || magnitudeDown) return 'cool';
  return 'neutral';
}

/**
 * Maps a review symbol onto the Binance USDT-M perpetual name of the same
 * underlying asset, so the reviewed coin can be forced into a Binance-named
 * pool:
 *
 * - OKX `BTC-USDT-SWAP` → `BTCUSDT` (base before `-USDT` + `USDT`)
 * - Binance/Bitget `BTCUSDT` → unchanged
 *
 * Returns null when the symbol cannot be interpreted (e.g. a coin with no
 * Binance USDT-M pair) — the caller reports it instead of failing.
 */
/** Null-safe activity ordering metric; never manufactures a value from an invalid baseline. */
export function computeActivityScore(volumeRatio: number | null, rangeRatio: number | null): number | null {
  if (volumeRatio === null || rangeRatio === null) return null;
  if (!Number.isFinite(volumeRatio) || !Number.isFinite(rangeRatio)) return null;
  if (volumeRatio <= 0 || rangeRatio <= 0) return null;
  return Math.sqrt(volumeRatio * rangeRatio);
}

export function normalizeToBinance(symbol: string): string | null {
  const trimmed = symbol.trim().toUpperCase();
  const swapMatch = /^([A-Z0-9]+)-USDT-SWAP$/.exec(trimmed);
  if (swapMatch) return `${swapMatch[1]}USDT`;
  if (/^[A-Z0-9]+USDT$/.test(trimmed)) return trimmed;
  return null;
}
