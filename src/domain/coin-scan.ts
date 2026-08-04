import type { Candlestick } from './candlestick';
import type { ReviewTimeframe } from './trade';

export const scanTimeframes: ReviewTimeframe[] = ['5m', '15m', '1H', '4H', '1D'];

export type ShrinkScanParams = {
  method: 'shrink';
  timeframe: ReviewTimeframe;
  topN: number;
  ratioThreshold: number;
  consecutive: number;
  window: number;
  minQuoteVolume24h: number;
};

export type ScanRow = {
  instrument: string;
  lastPrice: number;
  change24h: number;
  quoteVolume24h: number;
  currentVolume: number;
  averageVolume: number;
  ratio: number;
  intensity: number;
  consecutiveShrunk: number;
  qualified: boolean;
};

export type ScanResponse = {
  scanned: ScanRow[];
  qualifiedCount: number;
  params: ShrinkScanParams;
  scannedAt: string;
};

export type ShrinkMetrics = {
  currentVolume: number;
  averageVolume: number;
  ratio: number;
  intensity: number;
  consecutiveShrunk: number;
  qualified: boolean;
};

export type ShrinkMetricsParams = Pick<ShrinkScanParams, 'ratioThreshold' | 'consecutive' | 'window'>;

/**
 * Computes shrink-volume metrics for the last completed candlestick.
 *
 * The caller must pass only completed candlesticks (the still-forming bar is
 * excluded before this call). Candlesticks may arrive in any order; they are
 * sorted ascending by timestamp here.
 *
 * Returns null when there is not enough history to compute the metrics
 * (fewer than `window + consecutive` candles) or when a window average is
 * zero, which makes the volume ratio undefined.
 */
export function computeShrinkMetrics(candles: readonly Candlestick[], params: ShrinkMetricsParams): ShrinkMetrics | null {
  const { ratioThreshold, consecutive, window } = params;
  const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
  const count = sorted.length;
  if (count < window + consecutive) return null;

  // Sliding average of the `window` candles before each candle at or after
  // index `window`; the ratio of candle i is volume[i] / averages[i].
  const averages: number[] = new Array(count).fill(0);
  const ratios: number[] = [];
  for (let i = window; i < count; i += 1) {
    let sum = 0;
    for (let j = i - window; j < i; j += 1) sum += sorted[j].volume;
    const average = sum / window;
    if (average <= 0) return null;
    averages[i] = average;
    ratios.push(sorted[i].volume / average);
  }

  const lastIndex = count - 1;
  const intensity = ratios.slice(-consecutive).reduce((sum, ratio) => sum + ratio, 0) / consecutive;

  let consecutiveShrunk = 0;
  for (let i = ratios.length - 1; i >= 0 && ratios[i] < ratioThreshold; i -= 1) {
    consecutiveShrunk += 1;
  }

  return {
    currentVolume: sorted[lastIndex].volume,
    averageVolume: averages[lastIndex],
    ratio: ratios[ratios.length - 1],
    intensity,
    consecutiveShrunk,
    qualified: consecutiveShrunk >= consecutive,
  };
}
