import type { Candlestick } from './candlestick';
import type { ReviewTimeframe } from './trade';

export const scanTimeframes: ReviewTimeframe[] = ['5m', '15m', '1H', '4H', '1D'];

/** Number of trailing completed bars used to compute boxTightness. */
export const DEFAULT_BOX_WINDOW = 12;
/** Scale-free box-shape threshold: boxTightness <= maxBoxRatio to qualify. */
export const DEFAULT_MAX_BOX_RATIO = 0.9;

export type ShrinkScanParams = {
  method: 'shrink';
  timeframe: ReviewTimeframe;
  topN: number;
  ratioThreshold: number;
  consecutive: number;
  window: number;
  minQuoteVolume24h: number;
  /** Box-shape window; absent falls back to DEFAULT_BOX_WINDOW. */
  boxWindow?: number;
  /** Box-shape tightness threshold; absent falls back to DEFAULT_MAX_BOX_RATIO. */
  maxBoxRatio?: number;
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
  boxTightness: number;
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
  boxTightness: number;
  qualified: boolean;
};

export type QuietMetricsParams = Pick<
  ShrinkScanParams,
  'ratioThreshold' | 'consecutive' | 'window' | 'boxWindow' | 'maxBoxRatio'
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
 * for not being "freshly" quiet. The shape requirement is carried by
 * `boxTightness` instead: the trailing `boxWindow` completed bars must form a
 * tight box (`boxTightness <= maxBoxRatio`). A large candle anywhere inside
 * the last `boxWindow` bars stretches the box range and pushes `boxTightness`
 * over the threshold, which is what keeps fresh flags (a big candle followed
 * by a small consolidation) out.
 *
 * boxTightness is a scale-free shape measure over the trailing `boxWindow`
 * completed bars: R / (m * sqrt(boxWindow)), where R is the total range
 * (maxHigh - minLow) / minLow and m is the mean per-bar amplitude
 * (high - low) / low. A genuine box oscillates in place so R ≈ m * sqrt(N)
 * → boxTightness ≈ 1; a one-sided trend accumulates drift so R ≈ m * N
 * → boxTightness ≈ sqrt(N); a large candle inside the window makes R large
 * relative to m, so boxTightness climbs well above 1. Because it is divided
 * by sqrt(N) and normalized to the instrument's own amplitude, one threshold
 * works for every N, timeframe, and absolute volatility level. m <= 0
 * (all-flat bars) yields boxTightness 0 (a perfect box).
 *
 * Returns null when there is not enough history (fewer than
 * `window + consecutive` candles, or fewer than `boxWindow` candles), when a
 * volume window average is zero, or when a price is non-positive.
 */
export function computeQuietMetrics(candles: readonly Candlestick[], params: QuietMetricsParams): QuietMetrics | null {
  const { ratioThreshold, consecutive, window } = params;
  const boxWindow = params.boxWindow ?? DEFAULT_BOX_WINDOW;
  const maxBoxRatio = params.maxBoxRatio ?? DEFAULT_MAX_BOX_RATIO;
  const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
  const count = sorted.length;
  if (count < window + consecutive || count < boxWindow) return null;
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

  // Box-shape tightness over the trailing `boxWindow` completed bars.
  let maxHigh = -Infinity;
  let minLow = Infinity;
  let trailingAmplitudeSum = 0;
  for (let i = count - boxWindow; i < count; i += 1) {
    const candle = sorted[i];
    maxHigh = Math.max(maxHigh, candle.high);
    minLow = Math.min(minLow, candle.low);
    trailingAmplitudeSum += amplitudeOf(candle);
  }
  const range = (maxHigh - minLow) / minLow;
  const meanAmplitude = trailingAmplitudeSum / boxWindow;
  const boxTightness = meanAmplitude > 0 ? range / (meanAmplitude * Math.sqrt(boxWindow)) : 0;

  return {
    currentVolume: sorted[lastIndex].volume,
    averageVolume: volumeAverages[lastIndex],
    ratio: volumeRatios[volumeRatios.length - 1],
    amplitudeRatio: amplitudeRatios[amplitudeRatios.length - 1],
    intensity,
    consecutiveQuiet,
    boxTightness,
    qualified: consecutiveQuiet >= consecutive && boxTightness <= maxBoxRatio,
  };
}
