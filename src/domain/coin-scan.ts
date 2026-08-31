import type { Candlestick } from './candlestick';
import type { ReviewTimeframe } from './trade';

export const scanTimeframes: ReviewTimeframe[] = ['5m', '15m', '1H', '4H', '1D'];

/**
 * The only convergence structure kind: a volatility convergence (波动率越来越小).
 * The fractal triangle module (swing detection / backscan / classifyStructure)
 * was removed — the scan judges a coin purely by whether its recent band is
 * meaningfully quieter than the same-length stretch before it.
 */
export type ConvergenceStructure = 'convergence';

/**
 * One timeframe's convergence verdict. `structure === null` means that timeframe
 * has no convergence at all; the other fields are then meaningless and the
 * service fills them with neutral zeros.
 */
export type StructureResult = {
  /** Structure type; null = this timeframe has no convergence. */
  structure: ConvergenceStructure | null;
  /** Position inside the band, 0..1: (lastPrice - rangeLow) / (rangeHigh - rangeLow). */
  position: number;
  /** Convergence strength score, larger = stronger. Sort key. */
  score: number;
  /** Touch count — always 0 now (no swing touches); kept for the row contract. */
  touchCount: number;
  /** True when the band passed the volatility-shrink + containment gates. */
  qualified: boolean;
};

/**
 * Calibration knobs for `detectConvergence`, kept internal (not exposed in the
 * UI). No coin-own "typical volatility" baseline and no absolute thresholds —
 * every measure is relative to the same-length segment before the band.
 */
export type StructureParams = {
  /**
   * Minimum band length (in K bars). A band needs enough bars to be a real
   * 蓄力 phase, not a 2-bar blip. Absent → `DEFAULT_CONVERGENCE_MIN_RUN`.
   */
  minRun?: number;
  /**
   * Volatility-shrink gate: a band qualifies as a convergence only when its own
   * median per-bar volatility is < this × the median volatility of the SAME-LENGTH
   * segment immediately before it — the price is meaningfully quieter than it was.
   * Internal spikes are absorbed by the median. Absent → `DEFAULT_CONVERGENCE_RATIO`.
   */
  convergenceRatio?: number;
  /**
   * Flatness tolerance for the band, scaled by the band's own median bar
   * volatility (runMed): an edge (low or high regression) counts as flat when its
   * total drift is <= this × runMed. A rising/falling trend (whose relative
   * amplitude naturally shrinks as price rises) is NOT a 安静带 and must be
   * rejected; scaling by the band's own noise keeps the tolerance relative, not
   * absolute. Absent → `DEFAULT_CONVERGENCE_FLAT_RATIO`.
   */
  flatRatio?: number;
  /**
   * Score length scale: the length contribution `clamp01(runLen / lengthScale)`
   * reaches full marks at this many bars. Absent → `DEFAULT_CONVERGENCE_LENGTH_SCALE`.
   */
  lengthScale?: number;
};

/**
 * Minimal scan parameters (extreme UI panel: no swing/touch/slope knobs). The
 * structure thresholds live in `StructureParams` (file-top defaults, calibrated
 * on real data); only the output-strength knob is exposed.
 */
export type ShrinkScanParams = {
  method: 'shrink';
  topN: number;
  minQuoteVolume24h: number;
  /** Scan anchor (epoch ms): bars whose close time <= anchor are treated as completed. Absent → now. */
  anchor?: number;
  /** 结构强度阈值主旋钮;调高 = 宁少勿滥. Timeframes with score < minScore don't count as converged. */
  minScore?: number;
};

/**
 * One scanned coin. The scan covers all of `scanTimeframes`; a row exists only
 * when the coin converges on at least one timeframe (宁少勿滥).
 */
export type ScanRow = {
  instrument: string;
  lastPrice: number;
  change24h: number;
  quoteVolume24h: number;
  /** Per-timeframe structure verdicts, keyed by ReviewTimeframe (scanTimeframes order). */
  structures: Record<ReviewTimeframe, StructureResult>;
  /** Timeframes with a qualified structure (收敛周期 column). */
  convergedTimeframes: ReviewTimeframe[];
  qualifiedCount: number;
  /** Strongest score across qualified timeframes; a row always has >= 1 qualified timeframe. */
  bestScore: number;
  /** Always true (scanned rows only include coins with >= 1 qualified timeframe). */
  qualified: boolean;
};

export type ScanResponse = {
  scanned: ScanRow[];
  qualifiedCount: number;
  params: ShrinkScanParams;
  scannedAt: string;
  /**
   * Rate-limit warnings raised DURING this scan (Binance HTTP 429 backoffs).
   * The scan still succeeded, but the pipeline had to pause for the IP's weight
   * window to cool down. Present only when at least one backoff occurred.
   */
  warnings?: string[];
};

/** Minimum band length (in K bars) for a volatility convergence. */
export const DEFAULT_CONVERGENCE_MIN_RUN = 5;
/**
 * Volatility-shrink gate: a band qualifies as a convergence only when its own
 * median per-bar volatility is < this × the median volatility of the SAME-LENGTH
 * segment immediately before it — "波动率越来越小". 0.9 admits mild but real
 * shrinks (e.g. a band at 84% of its preceding stretch); the calm-dominant score
 * then ranks strength honestly. A band at ~1.0× (no shrink) is rejected.
 */
export const DEFAULT_CONVERGENCE_RATIO = 0.9;
/**
 * Score length scale for a convergence band: the length contribution
 * `clamp01(runLen / lengthScale)` reaches full marks at this many bars. 16 = a
 * ~1.3-hour 5m band scores full length marks.
 */
export const DEFAULT_CONVERGENCE_LENGTH_SCALE = 16;
/**
 * Flatness tolerance for a convergence band, scaled by the band's own median
 * bar volatility: an edge counts as flat when its total drift is <= this × runMed.
 * 2.0 = the band's low/high edges may drift at most two typical bars across its
 * span before it reads as a trend rather than a quiet flat band.
 */
export const DEFAULT_CONVERGENCE_FLAT_RATIO = 2.0;
/**
 * Score calm weight: how much the band's quietness relative to the preceding
 * stretch drives the score. Calm dominates length (0.7/0.3): a mild shrink (band
 * only ~1.2× quieter than before) scores low, a strong shrink scores high.
 */
export const CONVERGENCE_SCORE_CALM_WEIGHT = 0.7;
/** Score length weight for a convergence band (maturity bonus). Calm dominates. */
export const CONVERGENCE_SCORE_LENGTH_WEIGHT = 0.3;

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** Median of an array; 0 for an empty array. Robust to spikes. */
function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Total drift of a price series across a segment: the absolute slope of the OLS
 * regression (x = bar index) times the segment span, normalized by the mean
 * price. Relative (not absolute), so one tolerance works across coins and
 * timeframes. Used by the band's flatness gate.
 */
function edgeDrift(prices: readonly number[], startIndex: number): number {
  const n = prices.length;
  if (n < 2) return 0;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i += 1) {
    const x = startIndex + i;
    sumX += x;
    sumY += prices[i];
    sumXY += x * prices[i];
    sumXX += x * x;
  }
  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) return 0;
  const slope = (n * sumXY - sumX * sumY) / denominator;
  const meanPrice = sumY / n;
  if (meanPrice === 0) return 0;
  return (Math.abs(slope) * (n - 1)) / meanPrice;
}

/**
 * Volatility convergence (波动率越来越小) detection. Walks the RAW BARS looking for
 * a recent band whose bar-to-bar volatility is meaningfully below the same-length
 * segment immediately before it. Every measure is RELATIVE — there is no
 * coin-own "typical volatility" baseline and no absolute threshold, because each
 * coin's volatility differs (BTC ~0.15% per 5m bar vs a small cap ~5%).
 *
 * Sliding scan over every possible band start (the band always ends at the last
 * bar); a band must pass:
 * - **Volatility shrink**: the band's median per-bar volatility `runMed` is
 *   `< convergenceRatio × preMed`, where `preMed` is the median volatility of the
 *   SAME-LENGTH segment immediately before the band — the price is meaningfully
 *   quieter than it was. Internal spikes are absorbed by the median.
 * - **Containment**: the current price is inside the band's `[min low, max high]`
 *   range (with a small tolerance) — a price that has broken out is no longer 蓄力.
 *
 * The best band is scored **calm-dominant**: `0.7 × relativeCalm + 0.3 × length`,
 * where `relativeCalm = 1 - runMed/preMed` and `length = runLen / lengthScale`.
 *
 * Known consequence: a crash-then-pause band (a big dump followed by a calm
 * stretch) IS detected as a strong shrink, because its band is far quieter than
 * the dump that preceded it. Whether that deserves exclusion is a calibration
 * decision left open (see task notes) — the real-scan output marks these for the
 * user to judge.
 */
export function detectConvergence(candles: readonly Candlestick[], params: StructureParams): StructureResult | null {
  const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
  const minRun = params.minRun ?? DEFAULT_CONVERGENCE_MIN_RUN;
  if (sorted.length < minRun * 2) return null; // need room for a band + its preceding stretch
  if (sorted.some((candle) => candle.low <= 0)) return null;

  const vol = sorted.map((candle) => (candle.high - candle.low) / candle.low);
  const convergenceRatio = params.convergenceRatio ?? DEFAULT_CONVERGENCE_RATIO;
  const flatRatio = params.flatRatio ?? DEFAULT_CONVERGENCE_FLAT_RATIO;
  const lengthScale = params.lengthScale ?? DEFAULT_CONVERGENCE_LENGTH_SCALE;
  const last = sorted.length - 1;
  const lastPrice = sorted[last].close;

  let best: { score: number; runLen: number; rangeLow: number; rangeHigh: number } | null = null;
  for (let start = last - minRun + 1; start >= 0; start -= 1) {
    const runLen = last - start + 1;
    const preStart = start - runLen;
    if (preStart < 0) continue; // not enough preceding bars for this band length
    const band = sorted.slice(start, last + 1);
    const runMed = median(vol.slice(start, last + 1));
    // ---- flatness: the band is a quiet horizontal band, not a trend. A rising
    // trend's relative amplitude shrinks as price climbs, which would otherwise
    // fake a "volatility shrink"; the tolerance is scaled by the band's own
    // noise (runMed) so it stays relative, never absolute. ----
    const flatTol = flatRatio * runMed;
    if (Math.max(edgeDrift(band.map((c) => c.low), start), edgeDrift(band.map((c) => c.high), start)) > flatTol) continue;
    const preMed = median(vol.slice(preStart, start));
    // ---- volatility shrink: band quieter than the same-length stretch before ----
    if (runMed >= convergenceRatio * preMed) continue;
    // ---- containment: current price inside the band's [min low, max high] ----
    const rangeLow = Math.min(...band.map((c) => c.low));
    const rangeHigh = Math.max(...band.map((c) => c.high));
    const tolerance = 0.1 * (rangeHigh - rangeLow);
    if (lastPrice < rangeLow - tolerance || lastPrice > rangeHigh + tolerance) continue;
    // ---- score: calm-dominant (shrinking degree + length maturity) ----
    const relativeCalm = clamp01(1 - runMed / preMed);
    const lengthContribution = clamp01(runLen / lengthScale);
    const score = clamp01(
      CONVERGENCE_SCORE_CALM_WEIGHT * relativeCalm +
        CONVERGENCE_SCORE_LENGTH_WEIGHT * lengthContribution,
    );
    if (best === null || score > best.score) {
      best = { score, runLen, rangeLow, rangeHigh };
    }
  }
  if (best === null) return null;
  const rangeHeight = best.rangeHigh - best.rangeLow;
  const position = clamp01(rangeHeight > 0 ? (lastPrice - best.rangeLow) / rangeHeight : 0.5);
  return { structure: 'convergence', position, score: best.score, touchCount: 0, qualified: true };
}

/**
 * Combination entry point. With the triangle module removed this simply forwards
 * to `detectConvergence`; the name is kept so the service and callers have one
 * stable probe API.
 */
export function probeStructure(candles: readonly Candlestick[], params: StructureParams): StructureResult | null {
  return detectConvergence(candles, params);
}

/**
 * Builds a `StructureParams` from the file-top default constants, so callers (the
 * service, tests) don't repeat the calibration values.
 */
export function defaultStructureParams(overrides?: Partial<StructureParams>): StructureParams {
  return {
    minRun: DEFAULT_CONVERGENCE_MIN_RUN,
    convergenceRatio: DEFAULT_CONVERGENCE_RATIO,
    flatRatio: DEFAULT_CONVERGENCE_FLAT_RATIO,
    lengthScale: DEFAULT_CONVERGENCE_LENGTH_SCALE,
    ...overrides,
  };
}
