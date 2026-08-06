import type { Candlestick } from './candlestick';
import type { ReviewTimeframe } from './trade';

export const scanTimeframes: ReviewTimeframe[] = ['5m', '15m', '1H', '4H', '1D'];

/**
 * Volatility-compression threshold: compression <= maxCompression to qualify.
 * compression = mean amplitude of the recent boxWindow bars / mean amplitude of
 * the boxWindow bars immediately before them, so a coin only qualifies when its
 * current volatility is meaningfully smaller than its own recent past.
 */
export const DEFAULT_MAX_COMPRESSION = 0.8;
/**
 * Latest-trend threshold: latestTrend <= maxLatestTrend to qualify.
 * latestTrend = mean amplitude of the trailing trendWindow bars / mean amplitude
 * of the trendWindow bars immediately before them, so a coin only qualifies when
 * its volatility is still shrinking toward the present (收窄), not just smaller
 * than some earlier past (which compression alone cannot distinguish from a coin
 * that has always been quiet).
 */
export const DEFAULT_MAX_LATEST_TREND = 0.9;
/**
 * Number of trailing completed bars used to compute latestTrend. Default 3, not
 * 2: a 2-bar window makes the gate twitchy — one wider bar (e.g. ONUSDT 4H
 * @08-05 16:00, latestTrend 1.16 with tr=2 vs 0.52 with tr=3) flips the verdict
 * even though the convergence is obvious. 3 bars averages out the single-bar
 * blip while still rejecting a genuinely flattened/widening coin (≈ 1.0+).
 */
export const DEFAULT_TREND_WINDOW = 3;

/**
 * Box windows scanned by the plateau convergence gate. A coin converges when it
 * compresses (compression) and is still narrowing (latestTrend) across at least
 * `plateauMin` consecutive box windows, which filters isolated one-window noise
 * and adapts to the natural box length of each instrument.
 */
export const PLATEAU_BOX_WINDOWS = [3, 4, 5, 6] as const;
/** Minimum number of consecutive qualified box windows for a coin to qualify. */
export const DEFAULT_PLATEAU_MIN = 2;

export type ShrinkScanParams = {
  method: 'shrink';
  topN: number;
  minQuoteVolume24h: number;
  /** Scan anchor (epoch ms): bars whose close time <= anchor are treated as completed. Absent → now. */
  anchor?: number;
  /** Volatility-compression threshold; absent falls back to DEFAULT_MAX_COMPRESSION. */
  maxCompression?: number;
  /** Latest-trend threshold; absent falls back to DEFAULT_MAX_LATEST_TREND. */
  maxLatestTrend?: number;
  /** Number of trailing bars for the latest-trend windows; absent falls back to DEFAULT_TREND_WINDOW. */
  trendWindow?: number;
  /** Minimum consecutive qualified plateau windows; absent falls back to DEFAULT_PLATEAU_MIN. */
  plateauMin?: number;
};

/**
 * One timeframe's convergence verdict for a scanned coin. The multi-timeframe
 * scan (5m/15m/1H/4H/1D) produces one entry per timeframe per coin; the coin is
 * 收敛 on the timeframes where `qualified` is true.
 */
export type ScanTimeframeResult = {
  timeframe: ReviewTimeframe;
  /** Compression of the best plateau window (bestBoxWindow). */
  compression: number;
  /** Latest-trend of the best plateau window. */
  latestTrend: number;
  /** Score of the best plateau window = compression + latestTrend. */
  score: number;
  /** Longest run of consecutive qualified plateau windows. */
  plateauWidth: number;
  /** Box window of the best plateau window. */
  bestBoxWindow: number;
  /** plateauWidth >= plateauMin. */
  qualified: boolean;
};

export type ScanRow = {
  instrument: string;
  lastPrice: number;
  change24h: number;
  quoteVolume24h: number;
  /** All 5 timeframes in scanTimeframes order, each with its own convergence verdict. */
  timeframes: ScanTimeframeResult[];
  /** Subset of timeframes where qualified is true (收敛周期 column data). */
  convergenceTimeframes: ReviewTimeframe[];
  qualifiedCount: number;
  /** Min score across qualified timeframes; a row always has >= 1 qualified timeframe. */
  bestScore: number;
  /** Always true (scanned rows only include coins with >= 1 qualified timeframe), kept for compatibility. */
  qualified: boolean;
};

export type ScanResponse = {
  scanned: ScanRow[];
  qualifiedCount: number;
  params: ShrinkScanParams;
  scannedAt: string;
};

export type QuietMetrics = {
  compression: number;
  latestTrend: number;
  /** Sort key = compression + latestTrend; lower = converging harder. */
  score: number;
  qualified: boolean;
};

export type QuietMetricsParams = {
  /** Volatility-compression window. */
  boxWindow: number;
  /** Volatility-compression threshold; absent falls back to DEFAULT_MAX_COMPRESSION. */
  maxCompression?: number;
  /** Latest-trend threshold; absent falls back to DEFAULT_MAX_LATEST_TREND. */
  maxLatestTrend?: number;
  /** Number of trailing bars for the latest-trend windows; absent falls back to DEFAULT_TREND_WINDOW. */
  trendWindow?: number;
};

export type PlateauWindow = {
  boxWindow: number;
  compression: number;
  latestTrend: number;
  score: number;
  qualified: boolean;
};

export type PlateauResult = {
  /** Per-box-window verdicts in PLATEAU_BOX_WINDOWS order. */
  windows: PlateauWindow[];
  /** Longest run of consecutive qualified windows. */
  plateauWidth: number;
  /** Compression of the best window. */
  compression: number;
  /** Latest-trend of the best window. */
  latestTrend: number;
  /** Score of the best window. */
  score: number;
  /** Box window of the best window. */
  bestBoxWindow: number;
  /** plateauWidth >= plateauMin. */
  qualified: boolean;
};

export type PlateauParams = {
  maxCompression: number;
  maxLatestTrend: number;
  trendWindow: number;
  plateauMin: number;
};

// Used instead of Infinity so JSON serialization never produces null.
const LARGE_RATIO = 1_000_000_000;

function amplitudeOf(candle: Candlestick): number {
  return (candle.high - candle.low) / candle.low;
}

/**
 * Computes pure-price 收敛 (convergence) metrics for the last completed
 * candlestick. Volume plays no role: the user's stance is "看裸 K" — a coin is
 * 收敛 when its price range has compressed against its own past and is still
 * narrowing toward the present.
 *
 * The caller must pass only completed candlesticks (the still-forming bar is
 * excluded before this call). Candlesticks may arrive in any order; they are
 * sorted ascending by timestamp here.
 *
 * compression is a scale-free volatility-compression measure over the trailing
 * `boxWindow` completed bars (recent) against the `boxWindow` bars immediately
 * before them (prior): meanAmp(recent) / meanAmp(prior), where meanAmp is the
 * mean per-bar (high - low) / low. A coin whose current volatility has shrunk
 * meaningfully against its own past scores below 1; a coin that was always
 * quiet scores ≈ 1 (no "tension") and is rejected. When the prior window is
 * all-flat but the recent window is not, compression is reported as
 * `LARGE_RATIO` (the coin "woke up" from flat, which is not convergence); when
 * both windows are flat, compression is 0 and the latestTrend gate carries the
 * verdict.
 *
 * latestTrend is the tension-in-the-present gate: the trailing `trendWindow`
 * completed bars (latest) against the `trendWindow` bars immediately before them
 * (middle), meanAmp(latest) / meanAmp(middle). compression only asks "is it
 * quieter than before"; latestTrend asks "is it still getting quieter". A coin
 * that has flattened out (latest ≈ middle → latestTrend ≈ 1) or is widening
 * (latest > middle) has no 收窄 feel and is rejected; a coin still converging
 * scores below 1. Boundary: a flat middle window with an active latest window
 * reports `LARGE_RATIO`; two flat windows report 0 and the compression gate
 * carries the verdict.
 *
 * score = compression + latestTrend is the pure-price ranking key (both are
 * mean-amplitude ratios, so they are same-unit and additive). qualified requires
 * compression <= maxCompression AND latestTrend <= maxLatestTrend.
 *
 * Returns null when there is not enough history (fewer than `2 * boxWindow`
 * candles so both compression windows exist, or fewer than `2 * trendWindow`
 * candles so both latest-trend windows exist) or when a price is non-positive.
 */
export function computeQuietMetrics(candles: readonly Candlestick[], params: QuietMetricsParams): QuietMetrics | null {
  const boxWindow = params.boxWindow;
  const maxCompression = params.maxCompression ?? DEFAULT_MAX_COMPRESSION;
  const maxLatestTrend = params.maxLatestTrend ?? DEFAULT_MAX_LATEST_TREND;
  const trendWindow = params.trendWindow ?? DEFAULT_TREND_WINDOW;
  const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
  const count = sorted.length;
  if (count < 2 * boxWindow || count < 2 * trendWindow) return null;
  if (sorted.some((candle) => candle.low <= 0)) return null;

  // Volatility compression: the trailing `boxWindow` completed bars (recent)
  // vs the `boxWindow` bars immediately before them (prior). Mean amplitudes
  // feed the compression ratio.
  let recentAmplitudeSum = 0;
  for (let i = count - boxWindow; i < count; i += 1) {
    recentAmplitudeSum += amplitudeOf(sorted[i]);
  }
  let priorAmplitudeSum = 0;
  for (let i = count - 2 * boxWindow; i < count - boxWindow; i += 1) {
    priorAmplitudeSum += amplitudeOf(sorted[i]);
  }
  const meanRecentAmplitude = recentAmplitudeSum / boxWindow;
  const meanPriorAmplitude = priorAmplitudeSum / boxWindow;
  const compression = meanPriorAmplitude > 0
    ? meanRecentAmplitude / meanPriorAmplitude
    : meanRecentAmplitude > 0 ? LARGE_RATIO : 0;

  // Latest-trend: the trailing `trendWindow` completed bars (latest) vs the
  // `trendWindow` bars immediately before them (middle). Both windows sit inside
  // the trailing boxWindow bars because trendWindow <= boxWindow, which the
  // plateau caller enforces via tr(bw) = min(trendWindow, bw - 1). A coin still
  // converging scores below 1; a flattened or widening coin scores >= 1 and is
  // rejected.
  let latestAmplitudeSum = 0;
  for (let i = count - trendWindow; i < count; i += 1) {
    latestAmplitudeSum += amplitudeOf(sorted[i]);
  }
  let middleAmplitudeSum = 0;
  for (let i = count - 2 * trendWindow; i < count - trendWindow; i += 1) {
    middleAmplitudeSum += amplitudeOf(sorted[i]);
  }
  const meanLatestAmplitude = latestAmplitudeSum / trendWindow;
  const meanMiddleAmplitude = middleAmplitudeSum / trendWindow;
  const latestTrend = meanMiddleAmplitude > 0
    ? meanLatestAmplitude / meanMiddleAmplitude
    : meanLatestAmplitude > 0 ? LARGE_RATIO : 0;

  const score = compression + latestTrend;
  return {
    compression,
    latestTrend,
    score,
    qualified: compression <= maxCompression && latestTrend <= maxLatestTrend,
  };
}

/**
 * Multi-window convergence verdict over the same set of completed candlesticks.
 * Scans every box window in PLATEAU_BOX_WINDOWS with the pure-price gate
 * (computeQuietMetrics) and requires `plateauMin` consecutive qualified windows
 * so an isolated single-window convergence (e.g. a coin that happened to align
 * with exactly one box length) does not qualify. Each box window uses
 * tr(bw) = min(trendWindow, bw - 1), which keeps the latest-trend windows inside
 * the box window and avoids the bw = trendWindow degeneration where the latest
 * window equals the recent window.
 *
 * A box window whose history is insufficient (< 2 * bw completed bars, or fewer
 * than 2 * tr(bw) bars for its latest-trend windows) or that hits a non-positive
 * price reports qualified = false and never contributes to a consecutive run —
 * a freshly listed coin with only small-bw history still qualifies through its
 * small windows without the null large windows breaking the run.
 *
 * Returns null when no box window could be computed at all (fewer than
 * 2 * PLATEAU_BOX_WINDOWS[0] completed bars or a non-positive price).
 */
export function computePlateau(candles: readonly Candlestick[], params: PlateauParams): PlateauResult | null {
  const windows: PlateauWindow[] = [];
  let anyComputed = false;
  for (const boxWindow of PLATEAU_BOX_WINDOWS) {
    // tr(bw) = min(trendWindow, boxWindow): bw=3 with the default trendWindow
    // collapses the latest-trend windows onto the box windows (latest == recent,
    // middle == prior), so compression and latestTrend are the same value and the
    // compression gate carries bw=3. That matches the case-library plateau
    // ({3,4} for HYPE 1H, {3,4,5} for ONUSDT 4H): a 2-bar latest window at bw=3
    // is too twitchy (HYPE 1H lt 0.905 > 0.9, one wider bar flips the verdict).
    // A null metrics result (insufficient history for this box window) reports a
    // non-qualified window with an infinite score so it is never selected as the
    // best window.
    const metrics = computeQuietMetrics(candles, {
      boxWindow,
      maxCompression: params.maxCompression,
      maxLatestTrend: params.maxLatestTrend,
      trendWindow: Math.min(params.trendWindow, boxWindow),
    });
    if (metrics) {
      anyComputed = true;
      windows.push({ boxWindow, ...metrics });
    } else {
      windows.push({ boxWindow, compression: 0, latestTrend: 0, score: Number.POSITIVE_INFINITY, qualified: false });
    }
  }
  if (!anyComputed) return null;

  // plateauWidth = longest consecutive run of qualified windows. A null window
  // resets the run, so a gap in the middle is not merged across.
  let plateauWidth = 0;
  let currentRun = 0;
  for (const window of windows) {
    currentRun = window.qualified ? currentRun + 1 : 0;
    plateauWidth = Math.max(plateauWidth, currentRun);
  }

  // Best window: the qualified window with the smallest score; when no window
  // qualifies, the computed window with the smallest score (null-window entries
  // carry an infinite score and never win). `anyComputed` guarantees at least
  // one finite-score window exists, so `pool[0]` is always defined.
  const computedWindows = windows.filter((window) => Number.isFinite(window.score));
  const qualifiedWindows = computedWindows.filter((window) => window.qualified);
  const pool = qualifiedWindows.length > 0 ? qualifiedWindows : computedWindows;
  let best = pool[0];
  for (const window of pool) {
    if (window.score < best.score) best = window;
  }

  return {
    windows,
    plateauWidth,
    qualified: plateauWidth >= params.plateauMin,
    compression: best.compression,
    latestTrend: best.latestTrend,
    score: best.score,
    bestBoxWindow: best.boxWindow,
  };
}
