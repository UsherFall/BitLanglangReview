import type { Candlestick } from './candlestick';
import type { ReviewTimeframe } from './trade';

export const scanTimeframes: ReviewTimeframe[] = ['5m', '15m', '1H', '4H', '1D'];

/** Number of trailing completed bars used for the volatility-compression windows. */
export const DEFAULT_BOX_WINDOW = 12;
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
/** Number of trailing completed bars used to compute latestTrend. */
export const DEFAULT_TREND_WINDOW = 4;

export type ShrinkScanParams = {
  method: 'shrink';
  timeframe: ReviewTimeframe;
  topN: number;
  ratioThreshold: number;
  consecutive: number;
  window: number;
  minQuoteVolume24h: number;
  /** Volatility-compression window; absent falls back to DEFAULT_BOX_WINDOW. */
  boxWindow?: number;
  /** Volatility-compression threshold; absent falls back to DEFAULT_MAX_COMPRESSION. */
  maxCompression?: number;
  /** Latest-trend threshold; absent falls back to DEFAULT_MAX_LATEST_TREND. */
  maxLatestTrend?: number;
  /** Number of trailing bars for the latest-trend windows; absent falls back to DEFAULT_TREND_WINDOW. */
  trendWindow?: number;
};

export type ScanRow = {
  instrument: string;
  lastPrice: number;
  change24h: number;
  quoteVolume24h: number;
  currentVolume: number;
  averageVolume: number;
  ratio: number;
  amplitudeRatio: number;
  intensity: number;
  consecutiveQuiet: number;
  compression: number;
  latestTrend: number;
  qualified: boolean;
};

export type ScanResponse = {
  scanned: ScanRow[];
  qualifiedCount: number;
  params: ShrinkScanParams;
  scannedAt: string;
};

export type QuietMetrics = {
  currentVolume: number;
  averageVolume: number;
  ratio: number;
  amplitudeRatio: number;
  intensity: number;
  consecutiveQuiet: number;
  compression: number;
  latestTrend: number;
  qualified: boolean;
};

export type QuietMetricsParams = Pick<
  ShrinkScanParams,
  'ratioThreshold' | 'consecutive' | 'window' | 'boxWindow' | 'maxCompression' | 'maxLatestTrend' | 'trendWindow'
>;

// Used instead of Infinity so JSON serialization never produces null.
const LARGE_RATIO = 1_000_000_000;

function amplitudeOf(candle: Candlestick): number {
  return (candle.high - candle.low) / candle.low;
}

/**
 * Computes quiet-consolidation (缩量盘整) metrics for the last completed
 * candlestick: volume shrinking and price range narrowing at the same time.
 *
 * The caller must pass only completed candlesticks (the still-forming bar is
 * excluded before this call). Candlesticks may arrive in any order; they are
 * sorted ascending by timestamp here.
 *
 * A candlestick is *calm* when its volume ratio is below `ratioThreshold`
 * (volume shrinking against its own trailing `window` mean). Amplitude no
 * longer gates calm: a coin that has been quiet for a long time has an
 * amplitude ratio near 1 (current ≈ its own mean) and must not be rejected
 * for not being "freshly" quiet. A coin qualifies only when it is 收敛
 * (converging): its recent volatility compressed against its own past
 * (`compression <= maxCompression`) and still shrinking toward the present
 * (`latestTrend <= maxLatestTrend`). There is no box-shape gate: a slow-slope
 * compression (a coin whose per-bar amplitude keeps narrowing while the price
 * drifts) is a legitimate 收敛 and must not be rejected for not being a tight
 * box — that was the v2 boxTightness bug that mis-fired on gold-style
 * compression.
 *
 * compression is a scale-free volatility-compression measure over the trailing
 * `boxWindow` completed bars (recent) against the `boxWindow` bars immediately
 * before them (prior): meanAmp(recent) / meanAmp(prior), where meanAmp is the
 * mean per-bar (high - low) / low. A coin whose current volatility has shrunk
 * meaningfully against its own past scores below 1; a coin that was always
 * quiet scores ≈ 1 (no "tension") and is rejected. When the prior window is
 * all-flat but the recent window is not, compression is reported as
 * `LARGE_RATIO` (the coin "woke up" from flat, which is not convergence); when
 * both windows are flat, compression is 0 and the volume-shrink gate carries
 * the verdict.
 *
 * latestTrend is the tension-in-the-present gate: the trailing `trendWindow`
 * completed bars (latest) against the `trendWindow` bars immediately before them
 * (middle), meanAmp(latest) / meanAmp(middle). compression only asks "is it
 * quieter than before"; latestTrend asks "is it still getting quieter". A coin
 * that has flattened out (latest ≈ middle → latestTrend ≈ 1) or is widening
 * (latest > middle) has no 收窄 feel and is rejected; a coin still converging
 * scores below 1. Boundary: a flat middle window with an active latest window
 * reports `LARGE_RATIO`; two flat windows report 0 and the other gates carry the
 * verdict.
 *
 * Returns null when there is not enough history (fewer than
 * `window + consecutive` candles, fewer than `2 * boxWindow` candles so both
 * compression windows exist, or fewer than `2 * trendWindow` candles so both
 * latest-trend windows exist), when a volume window average is zero, or when a
 * price is non-positive.
 */
export function computeQuietMetrics(candles: readonly Candlestick[], params: QuietMetricsParams): QuietMetrics | null {
  const { ratioThreshold, consecutive, window } = params;
  const boxWindow = params.boxWindow ?? DEFAULT_BOX_WINDOW;
  const maxCompression = params.maxCompression ?? DEFAULT_MAX_COMPRESSION;
  const maxLatestTrend = params.maxLatestTrend ?? DEFAULT_MAX_LATEST_TREND;
  const trendWindow = params.trendWindow ?? DEFAULT_TREND_WINDOW;
  const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
  const count = sorted.length;
  if (count < window + consecutive || count < 2 * boxWindow || count < 2 * trendWindow) return null;
  if (sorted.some((candle) => candle.low <= 0)) return null;

  // Sliding window means; ratio of candle i is value[i] / mean(window before i).
  const volumeAverages: number[] = new Array(count).fill(0);
  const volumeRatios: number[] = [];
  const amplitudeRatios: number[] = [];
  const calm: boolean[] = [];
  for (let i = window; i < count; i += 1) {
    let volumeSum = 0;
    let amplitudeSum = 0;
    for (let j = i - window; j < i; j += 1) {
      volumeSum += sorted[j].volume;
      amplitudeSum += amplitudeOf(sorted[j]);
    }
    const volumeAverage = volumeSum / window;
    if (volumeAverage <= 0) return null;
    const amplitudeAverage = amplitudeSum / window;
    volumeAverages[i] = volumeAverage;

    const volumeRatio = sorted[i].volume / volumeAverage;
    const currentAmplitude = amplitudeOf(sorted[i]);
    const amplitudeRatio = amplitudeAverage <= 0
      ? currentAmplitude === 0 ? 0 : LARGE_RATIO
      : currentAmplitude / amplitudeAverage;

    volumeRatios.push(volumeRatio);
    amplitudeRatios.push(amplitudeRatio);
    calm.push(volumeRatio < ratioThreshold);
  }

  const lastIndex = count - 1;
  const quietScores: number[] = [];
  for (let k = volumeRatios.length - consecutive; k < volumeRatios.length; k += 1) {
    quietScores.push((volumeRatios[k] + amplitudeRatios[k]) / 2);
  }
  const intensity = quietScores.reduce((sum, score) => sum + score, 0) / consecutive;

  let consecutiveQuiet = 0;
  for (let k = calm.length - 1; k >= 0 && calm[k]; k -= 1) {
    consecutiveQuiet += 1;
  }

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
  // the trailing boxWindow bars when trendWindow <= boxWindow, which the route
  // enforces. A coin still converging scores below 1; a flattened or widening
  // coin scores >= 1 and is rejected.
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

  return {
    currentVolume: sorted[lastIndex].volume,
    averageVolume: volumeAverages[lastIndex],
    ratio: volumeRatios[volumeRatios.length - 1],
    amplitudeRatio: amplitudeRatios[amplitudeRatios.length - 1],
    intensity,
    consecutiveQuiet,
    compression,
    latestTrend,
    qualified:
      consecutiveQuiet >= consecutive &&
      compression <= maxCompression &&
      latestTrend <= maxLatestTrend,
  };
}
