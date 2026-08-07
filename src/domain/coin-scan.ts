import type { Candlestick } from './candlestick';
import type { ReviewTimeframe } from './trade';

export const scanTimeframes: ReviewTimeframe[] = ['5m', '15m', '1H', '4H', '1D'];

/**
 * Kind of convergence structure. A coin is 蓄力待突破 when its swing structure has
 * collapsed into one of these two shapes:
 * - `triangle`: converging trend lines (lower highs + higher lows, or one side
 *   flat). Direction is not locked — both bullish and bearish wedges qualify.
 * - `box`: a horizontal channel (both edges slope ≈ 0) whose height is narrow
 *   relative to the coin's own past volatility.
 */
export type ConvergenceStructure = 'triangle' | 'box';

/**
 * One timeframe's convergence verdict. `structure === null` means that timeframe
 * has no convergent structure at all; the other fields are then meaningless and
 * the service fills them with neutral zeros.
 */
export type StructureResult = {
  /** Structure type; null = this timeframe has no convergence structure. */
  structure: ConvergenceStructure | null;
  /** Position inside the structure, 0..1: box = (lastPrice - boxLow) / (boxHigh - boxLow); triangle = current price between the two trend lines. */
  position: number;
  /** Convergence strength score, larger = stronger. Sort key. */
  score: number;
  /** Touch count (sum of swing points on both edges). */
  touchCount: number;
  /** True when the structure passed the maturity gate (touchMin per edge). */
  qualified: boolean;
};

/**
 * Classification thresholds for `classifyStructure` / `probeStructure`.
 *
 * `slopeTolerance`, `touchMin` and `maxBoxRelativeHeight` are the calibration
 * knobs the design keeps internal (not exposed in the UI); `lastPrice` and
 * `priorAmplitude` are data that `probeStructure` measures from the candles and
 * injects so the pure classifier can stay stateless. Tests may pass them
 * directly; when absent the box low-volatility gate is skipped rather than
 * guessed (see `classifyStructure`).
 */
export type StructureParams = {
  /**
   * Horizontal-drift tolerance for a box edge: an edge counts as flat when the
   * regression line's TOTAL drift across the edge's swing span, normalized by
   * the edge's mean price, is <= slopeTolerance. Total-drift (not per-bar slope)
   * is used so a long, slowly-tilting structure is not mistaken for a box — the
   * drift is scale-free (relative to the edge's own price), so one value works
   * for any timeframe and volatility level.
   */
  slopeTolerance: number;
  /**
   * Minimum touch points per edge for a structure to be mature (宁少勿滥). Both
   * edges need at least touchMin swing points. Must be >= 2 — a 1-point edge
   * cannot feed a linear regression, so lower values are clamped to 2.
   */
  touchMin: number;
  /**
   * Box low-volatility gate: (boxHeight / midPrice) / priorAmplitude must be
   * strictly less than this. The box must be a *convergence from larger
   * volatility* — an always-quiet coin (box width ≈ its own amplitude) has no
   * 蓄力 tension and is rejected.
   */
  maxBoxRelativeHeight: number;
  /** Data: latest completed close, used for `position`. Filled by probeStructure. */
  lastPrice?: number;
  /**
   * Data: mean per-bar amplitude ((high - low) / low) of the coin's own recent
   * past, used by the box low-volatility gate. Filled by probeStructure from the
   * candle window; a naturally quiet coin has priorAmplitude ≈ boxRelativeHeight
   * → ratio ≈ 1 → rejected.
   */
  priorAmplitude?: number;
  /**
   * Data: current bar index = the last candle's index in the ascending-sorted
   * candle array. Filled by probeStructure; tests may pass it directly. Trend
   * lines, widths and positions are all anchored at this bar (extrapolated to
   * where price is NOW), so a structure whose apex is already behind the current
   * bar is rejected. Absent → falls back to the last swing's index (backward
   * compatible for direct classifyStructure unit calls).
   */
  currentIndex?: number;
  /**
   * Recency gate: a structure's last swing must be within this many bars of
   * currentIndex to be "现役". A swing sequence whose most recent touch is far in
   * the past describes an old, already-resolved shape, not 蓄力待突破. Absent →
   * `DEFAULT_MAX_RECENT_BARS`.
   */
  maxRecentBars?: number;
  /**
   * Monotonicity tolerance for a triangle's trending edges. Each successive
   * swing on a rising edge must not fall more than this fraction below the
   * previous swing, and each swing on a falling edge must not rise more than
   * this fraction above the previous swing. This catches an outlier swing that
   * pulls the OLS regression into the right sign while the edge is not actually
   * monotonic (HEI's deep-low dip, HFT's post-crash rebound). A flat edge may
   * wiggle within its flat tolerance and is not checked. Absent →
   * `DEFAULT_MONOTONIC_TOLERANCE`.
   */
  monotonicTolerance?: number;
  /**
   * Box edge range gate: an edge's (max - min) / mean swing-price spread must be
   * <= this for the edge to count as a horizontal channel. Complements the
   * regression-slope flat test — a slow drift plus one deep spike can net a zero
   * slope while visibly not being a horizontal box. Absent →
   * `DEFAULT_BOX_RANGE_TOLERANCE`.
   */
  boxRangeTolerance?: number;
};

/**
 * A fractal swing point. `index` is the bar index into the ascending-sorted
 * candle array, kept as the regression x-coordinate so trend lines can be
 * extrapolated to the current bar for `position`. `price` is high[i] for a swing
 * high and low[i] for a swing low.
 */
export type SwingPoint = {
  /** Bar index (into the sorted candle array) where the fractal was found. */
  index: number;
  /** Bar open time (ms). */
  timestamp: number;
  /** Fractal price: high[i] for a swing high, low[i] for a swing low. */
  price: number;
  kind: 'high' | 'low';
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
};

/**
 * Candidate fractal N set for the probing scan. Each coin/timeframe runs
 * `detectSwings` at every N and keeps the N that yields the most regular
 * structure (see `probeStructure`), so a small consolidation shows up at a small
 * N and a large one at a large N without a pre-fixed window.
 */
export const STRUCTURE_SWING_N = [2, 3, 4, 5, 6, 8, 10, 12] as const;

/**
 * Horizontal-drift tolerance for a box edge: the edge's total drift across its
 * swing span, as a fraction of the edge's mean price, must be <= this for the
 * edge to count as flat (a box). An edge drifting more than this is "trending"
 * and can form a triangle side. Calibrated on real data (implement stage);
 * 0.02 = an edge may drift at most 2% of its own price from first to last swing
 * and still count as a horizontal box edge.
 */
export const DEFAULT_SLOPE_TOLERANCE = 0.02;
/** Minimum touch points per edge for a mature structure (both edges). */
export const DEFAULT_TOUCH_MIN = 2;
/**
 * Box low-volatility gate: (boxHeight / midPrice) / priorAmplitude must be
 * strictly < this. 0.8 = the box must be meaningfully narrower than the coin's
 * own average bar amplitude, so an always-quiet coin (ratio ≈ 1) is rejected —
 * it has no "从大波动收敛到小" 蓄力 tension.
 */
export const DEFAULT_MAX_BOX_RELATIVE_HEIGHT = 0.8;
/**
 * Only the most recent swings describe the *current* structure. Older swings
 * (e.g. the trend before the consolidation) would skew the edge regressions, so
 * classification windows to the last `DEFAULT_MAX_STRUCTURE_SWINGS` swings.
 */
export const DEFAULT_MAX_STRUCTURE_SWINGS = 8;
/**
 * Recency gate default: a structure's last swing must be within this many bars
 * of the current bar (currentIndex) to count as "现役". Calibrated on real data —
 * on 1D this is ~12 days, on 5m ~12 bars. A swing sequence whose most recent
 * touch is older than this has already resolved; the trend lines would still
 * extrapolate to a non-crossing width only by chance.
 */
export const DEFAULT_MAX_RECENT_BARS = 12;
/**
 * Monotonicity tolerance for a triangle's trending edges: a later swing may move
 * against the edge's required direction by at most this fraction of the previous
 * swing's price before the edge is judged non-monotonic. 0.02 = a rising low may
 * pull back at most 2% per step; HEI's 0.1969 → 0.1816 (−7.8%) deep-low dip and
 * HFT's post-crash rebound both exceed it. Calibrated on real data (implement
 * stage); separate from slopeTolerance because it verifies the swing SEQUENCE,
 * not the regression line.
 */
export const DEFAULT_MONOTONIC_TOLERANCE = 0.02;
/**
 * Box edge range gate: an edge's (max − min) / mean swing-price spread must be
 * <= this for a horizontal channel. Same order of magnitude as slopeTolerance
 * but slightly looser — an edge that regresses flat can legitimately wobble
 * more than its net drift. 0.05 = the edge may spread at most 5% of its mean
 * price. Calibrated on real data (implement stage).
 */
export const DEFAULT_BOX_RANGE_TOLERANCE = 0.05;

/** Score normalization for the touch contribution: this many touches = full marks. */
const TOUCH_SCALE = DEFAULT_MAX_STRUCTURE_SWINGS;

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

function maxValue(values: readonly number[]): number {
  let max = -Infinity;
  for (const value of values) if (value > max) max = value;
  return max;
}

function minValue(values: readonly number[]): number {
  let min = Infinity;
  for (const value of values) if (value < min) min = value;
  return min;
}

/**
 * Directional monotonicity check for a triangle edge. A trending edge must not
 * contain a swing that clearly moves AGAINST the edge's required direction —
 * a single outlier swing can pull the OLS regression into the right sign while
 * the edge is not actually monotonic (the HEI deep-low dip and HFT post-crash
 * rebound both fooled slope-only classification). The edge is therefore
 * verified swing-by-swing on top of the regression test.
 *
 *   'up'   -> a later price falling below prev * (1 - tol) breaks monotonicity
 *   'down' -> a later price rising above prev * (1 + tol) breaks monotonicity
 *   'flat' -> not checked (a flat edge may wiggle within its flat tolerance)
 *
 * `tolerance` is the per-step relative slack (DEFAULT_MONOTONIC_TOLERANCE).
 */
function isDirectionalMonotonic(
  prices: readonly number[],
  direction: 'up' | 'down' | 'flat',
  tolerance: number,
): boolean {
  if (direction === 'flat' || prices.length < 2) return true;
  for (let i = 1; i < prices.length; i += 1) {
    const prev = prices[i - 1];
    const curr = prices[i];
    if (direction === 'up' && curr < prev * (1 - tolerance)) return false;
    if (direction === 'down' && curr > prev * (1 + tolerance)) return false;
  }
  return true;
}

/** Mean per-bar relative amplitude ((high - low) / low) across the candles. */
function meanAmplitude(candles: readonly Candlestick[]): number {
  if (candles.length === 0) return 0;
  let sum = 0;
  for (const candle of candles) sum += (candle.high - candle.low) / candle.low;
  return sum / candles.length;
}

type RegPoint = { x: number; y: number };
type RegLine = { slope: number; intercept: number };

/**
 * Ordinary least-squares fit y = slope * x + intercept. Returns null when fewer
 * than 2 points or all x-coordinates coincide (a vertical line has no slope).
 */
function linearRegression(points: readonly RegPoint[]): RegLine | null {
  const n = points.length;
  if (n < 2) return null;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (const point of points) {
    sumX += point.x;
    sumY += point.y;
    sumXY += point.x * point.y;
    sumXX += point.x * point.x;
  }
  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

/**
 * Detects fractal swing highs/lows over the completed candles with a single
 * fractal width `n`:
 *
 *   swing high at bar i ⟺ high[i] is strictly greater than the n highs on each side
 *   swing low  at bar i ⟺ low[i]  is strictly less   than the n lows  on each side
 *
 * Pure and deterministic: the input is never mutated (a copy is sorted ascending
 * by timestamp). Consecutive same-direction swing points are collapsed to the
 * extreme (highest high / lowest low) so each edge is single-valued for
 * regression. Returns an empty array when there are fewer than 2n + 1 bars (not
 * enough fractal context) or a price is non-positive (structure math divides by
 * price).
 */
export function detectSwings(candles: readonly Candlestick[], n: number): SwingPoint[] {
  const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
  if (sorted.length < 2 * n + 1) return [];
  if (sorted.some((candle) => candle.low <= 0)) return [];

  const raw: SwingPoint[] = [];
  for (let i = n; i < sorted.length - n; i += 1) {
    const bar = sorted[i];
    let isHigh = true;
    let isLow = true;
    for (let j = i - n; j <= i + n; j += 1) {
      if (j === i) continue;
      if (bar.high <= sorted[j].high) isHigh = false;
      if (bar.low >= sorted[j].low) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) raw.push({ index: i, timestamp: bar.timestamp, price: bar.high, kind: 'high' });
    if (isLow) raw.push({ index: i, timestamp: bar.timestamp, price: bar.low, kind: 'low' });
  }

  // Collapse consecutive same-direction swings to the extreme. Strict fractal
  // comparisons already prevent two adjacent *same-direction* points, but a wide
  // bar can be BOTH a swing high and a swing low, and the dedup keeps the edge
  // regression single-valued regardless.
  const deduped: SwingPoint[] = [];
  for (const point of raw) {
    const last = deduped[deduped.length - 1];
    if (last && last.kind === point.kind) {
      if (point.kind === 'high' ? point.price > last.price : point.price < last.price) {
        deduped[deduped.length - 1] = point;
      }
    } else {
      deduped.push(point);
    }
  }
  return deduped;
}

/**
 * Classifies a swing sequence into a box or a triangle, returning a fully
 * scored `StructureResult` when a structure is present, or null when the swing
 * geometry does not form either shape.
 *
 * Box:   both edge regressions are flat (edge total drift across the swing span
 *        / meanPrice <= slopeTolerance), the box height is narrow relative to
 *        the coin's own past amplitude (priorAmplitude), and each edge is
 *        touched >= touchMin times.
 * Triangle: highs slope < 0 + lows slope > 0 (symmetric wedge), or one side flat
 *        (rising triangle: flat highs + rising lows; falling triangle: falling
 *        highs + flat lows). The trending side must be beyond the flat tolerance,
 *        so a near-box is not mislabelled a triangle. Each edge >= touchMin.
 *
 * Position: box = (lastPrice - boxLow) / (boxHigh - boxLow); triangle = where
 * lastPrice sits between the two trend lines at the current bar.
 *
 * Score: box = mean(compression + flatness + touch contributions); triangle =
 * mean(convergence + touch contributions). Both land in [0, 1] so a box and a
 * triangle are comparable sort keys — higher = stronger.
 *
 * Everything is anchored to the CURRENT bar (`params.currentIndex`, the last
 * candle index), not the last swing: trend lines are extrapolated to where price
 * is now, so a triangle whose apex is already behind the current bar (width <= 0
 * at the current bar) is rejected as resolved, and the convergence score measures
 * the width that remains at the current bar instead of saturating at the
 * narrowest swing point.
 *
 * The `priorAmplitude` low-volatility gate is applied only when a finite value is
 * supplied (probeStructure always supplies it). Absent, the gate is skipped so a
 * direct unit-test call without candle context is not spuriously rejected.
 */
export function classifyStructure(swings: readonly SwingPoint[], params: StructureParams): StructureResult | null {
  // A box/triangle needs at least one swing high and one swing low per edge; with
  // fewer than 4 swings the geometry cannot be verified (2 high + 2 low minimum).
  if (swings.length < 4) return null;

  // Window to the most recent swings: older ones describe an earlier regime (e.g.
  // the trend that preceded the consolidation) and would tilt the edge regressions.
  const recent = swings.slice(-DEFAULT_MAX_STRUCTURE_SWINGS);
  const highs = recent.filter((swing) => swing.kind === 'high');
  const lows = recent.filter((swing) => swing.kind === 'low');
  const touchMin = Math.max(params.touchMin, 2);
  if (highs.length < touchMin || lows.length < touchMin) return null;

  // Anchor everything to the current bar. probeStructure injects the last candle
  // index; a direct call without it falls back to the last swing index.
  const currentIndex = params.currentIndex ?? recent[recent.length - 1].index;
  // Recency gate (both structure kinds): the structure's last swing must be close
  // enough to the current bar to be 现役. A touch far in the past describes an
  // old, already-resolved shape whose trend lines only extrapolate by chance.
  const maxRecentBars = params.maxRecentBars ?? DEFAULT_MAX_RECENT_BARS;
  if (currentIndex - recent[recent.length - 1].index > maxRecentBars) return null;

  const highLine = linearRegression(highs.map((swing) => ({ x: swing.index, y: swing.price })));
  const lowLine = linearRegression(lows.map((swing) => ({ x: swing.index, y: swing.price })));
  if (!highLine || !lowLine) return null;

  const highPrices = highs.map((swing) => swing.price);
  const lowPrices = lows.map((swing) => swing.price);
  const meanHigh = mean(highPrices);
  const meanLow = mean(lowPrices);
  // Total edge drift across its swing span, as a fraction of the edge's mean
  // price. Total (not per-bar) drift keeps long, slowly-tilting structures from
  // looking flat — a 100-bar edge tilting 10% has a tiny per-bar slope yet is
  // clearly trending, and would be mislabelled a box by any per-bar tolerance.
  const highSpan = highs[highs.length - 1].index - highs[0].index;
  const lowSpan = lows[lows.length - 1].index - lows[0].index;
  const highDrift = (Math.abs(highLine.slope) * highSpan) / meanHigh;
  const lowDrift = (Math.abs(lowLine.slope) * lowSpan) / meanLow;
  const highFlat = highDrift <= params.slopeTolerance;
  const lowFlat = lowDrift <= params.slopeTolerance;
  const highFalling = highLine.slope < 0 && highDrift > params.slopeTolerance;
  const lowRising = lowLine.slope > 0 && lowDrift > params.slopeTolerance;
  const touchCount = highs.length + lows.length;
  const lastPrice = params.lastPrice ?? recent[recent.length - 1].price;

  // ---- box ----
  if (highFlat && lowFlat) {
    // Range gate: a box edge must stay in a narrow band, not merely regress to
    // ~0 slope. A slow drift plus one deep spike nets a zero regression slope
    // yet visibly is not a horizontal channel, so each edge's max-min spread
    // (relative to its mean price) is also bounded.
    const boxRangeTolerance = params.boxRangeTolerance ?? DEFAULT_BOX_RANGE_TOLERANCE;
    const highRange = (maxValue(highPrices) - minValue(highPrices)) / meanHigh;
    const lowRange = (maxValue(lowPrices) - minValue(lowPrices)) / meanLow;
    if (highRange > boxRangeTolerance || lowRange > boxRangeTolerance) return null;
    const boxHigh = meanHigh;
    const boxLow = meanLow;
    const boxHeight = boxHigh - boxLow;
    if (boxHeight > 0) {
      const midPrice = (boxHigh + boxLow) / 2;
      const boxRelativeHeight = boxHeight / midPrice;
      // priorAmplitude is optional data: probeStructure always supplies it, but
      // a direct unit-test call without candle context must not be spuriously
      // rejected — absent prior data, the low-volatility gate is skipped.
      const prior = params.priorAmplitude;
      const lowVolatility =
        prior === undefined ||
        !Number.isFinite(prior) ||
        prior <= 0 ||
        boxRelativeHeight / prior < params.maxBoxRelativeHeight;
      if (lowVolatility) {
        // 价格在结构内: a lastPrice beyond a small tolerance outside the box edges
        // has already broken out / collapsed — no longer 蓄力待突破.
        const boxTolerance = 0.1 * boxHeight;
        if (lastPrice < boxLow - boxTolerance || lastPrice > boxHigh + boxTolerance) return null;
        // 收缩比: how much the box has compressed against the coin's own past.
        // ratio -> 0 (much tighter than its own amplitude) = strongest tension.
        const compressionRatio =
          prior !== undefined && Number.isFinite(prior) && prior > 0 ? boxRelativeHeight / prior : 1;
        const compressionContribution = clamp01(1 - compressionRatio);
        // 水平度: closer to perfectly flat (drift -> 0) = higher.
        const flatnessContribution = clamp01(1 - Math.max(highDrift, lowDrift) / params.slopeTolerance);
        // 触碰: more edge touches = more mature box.
        const touchContribution = clamp01(touchCount / TOUCH_SCALE);
        const score = (compressionContribution + flatnessContribution + touchContribution) / 3;
        const position = clamp01((lastPrice - boxLow) / boxHeight);
        return { structure: 'box', position, score, touchCount, qualified: true };
      }
    }
  }

  // ---- triangle ----
  const symmetric = highFalling && lowRising;
  const rising = highFlat && lowRising; // 上升三角: flat highs, rising lows
  const falling = highFalling && lowFlat; // 下降三角: falling highs, flat lows
  if (symmetric || rising || falling) {
    // Range gate for a triangle's flat edge: a side that is supposed to be flat
    // must actually stay in a narrow band, not merely regress to ~0 slope. A deep
    // spike inside the edge (HEI's 0.1969 → 0.1816 深跌毛刺) can pull the OLS slope
    // flat while the edge visibly spans far more than a flat line would, so the
    // flat side gets the same (max − min) / mean spread bound as a box edge. The
    // symmetric branch has no flat side (both edges trend) and keeps only its
    // monotonicity gate — a wide-amplitude symmetric wedge is legitimate.
    const boxRangeTolerance = params.boxRangeTolerance ?? DEFAULT_BOX_RANGE_TOLERANCE;
    if (rising && (maxValue(highPrices) - minValue(highPrices)) / meanHigh > boxRangeTolerance) return null;
    if (falling && (maxValue(lowPrices) - minValue(lowPrices)) / meanLow > boxRangeTolerance) return null;
    // Monotonicity gate: a triangle's trending edges must move point-by-point
    // in the required direction within `monotonicTolerance`. An outlier swing
    // (HEI's 0.1969 → 0.1816 deep-low dip, HFT's post-crash rebound) can pull
    // the OLS slope into the right sign while the edge is not actually
    // monotonic, so the regression test is paired with a per-swing check. A
    // flat edge may wiggle inside its flat tolerance and is not checked: for a
    // rising triangle only the rising lows are verified, for a falling triangle
    // only the falling highs, for a symmetric triangle both.
    const monotonicTolerance = params.monotonicTolerance ?? DEFAULT_MONOTONIC_TOLERANCE;
    const highDirection = symmetric || falling ? 'down' : 'flat';
    const lowDirection = symmetric || rising ? 'up' : 'flat';
    if (
      !isDirectionalMonotonic(highPrices, highDirection, monotonicTolerance) ||
      !isDirectionalMonotonic(lowPrices, lowDirection, monotonicTolerance)
    ) {
      return null;
    }
    const firstIndex = recent[0].index;
    // Channel width between the two trend lines at bar x.
    const widthAt = (x: number) =>
      (highLine.slope - lowLine.slope) * x + (highLine.intercept - lowLine.intercept);
    const widthStart = widthAt(firstIndex);
    const widthCurrent = widthAt(currentIndex);
    // 收敛度: fraction of the starting width already collapsed by the CURRENT bar.
    // Anchoring at currentIndex (not the last swing) is what rejects the SPCX
    // "降弹平带" false positive: a rebound low line (slope ≈ 0.15/bar) extrapolated
    // to the current bar crosses the flat high line → widthCurrent <= 0 → already
    // resolved, not 蓄力. widthStart > 0 + widthCurrent < widthStart reject a
    // degenerate/parallel pair; widthCurrent > 0 rejects a crossed/resolved pair
    // (whose position would also divide by a non-positive width).
    if (widthStart > 0 && widthCurrent > 0 && widthCurrent < widthStart) {
      const upper = highLine.slope * currentIndex + highLine.intercept;
      const lower = lowLine.slope * currentIndex + lowLine.intercept;
      const width = upper - lower;
      // 价格在结构内: the extrapolated lines bound the current price. A lastPrice
      // far outside (beyond 10% of the structure width) has broken out or
      // collapsed — not 蓄力待突破. This uses the extrapolated lines, so a
      // price that has already punched through one side is rejected.
      const priceTolerance = 0.1 * width;
      if (lastPrice < lower - priceTolerance || lastPrice > upper + priceTolerance) return null;
      const convergenceContribution = clamp01((widthStart - widthCurrent) / widthStart);
      const touchContribution = clamp01(touchCount / TOUCH_SCALE);
      const score = (convergenceContribution + touchContribution) / 2;
      const position = width > 0 ? clamp01((lastPrice - lower) / width) : 0.5;
      return { structure: 'triangle', position, score, touchCount, qualified: true };
    }
  }

  return null;
}

/**
 * Combination entry point: probes every candidate fractal N and returns the most
 * regular structure found (or null when no N produces one).
 *
 * Selection priority (design): 有结构 > 触碰次数多 > swing 对数多 > score 强, with
 * a final tie-break toward the smaller N (防大 N 过度平滑). Each coin/timeframe
 * discovers its own structure scale — a small consolidation resolves at a small
 * N, a large one at a large N — without a pre-fixed window.
 *
 * `priorAmplitude`, `lastPrice` and `currentIndex` are measured here from the
 * completed candles and injected into `classifyStructure`, which stays a pure
 * function of swings + params. `currentIndex` is the last candle's index, so the
 * classifier anchors trend lines at the current bar (see `classifyStructure`).
 */
export function probeStructure(candles: readonly Candlestick[], params: StructureParams): StructureResult | null {
  const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
  if (sorted.length < 4) return null;
  if (sorted.some((candle) => candle.low <= 0)) return null;

  const lastPrice = sorted[sorted.length - 1].close;
  const currentIndex = sorted.length - 1;
  // "该币自身前期波动": mean per-bar amplitude across the scanned window. A box is
  // 低波动 only relative to this own-amplitude baseline — an always-quiet coin
  // (amplitude ≈ box width) has no "从大波动收敛到小" process and is rejected.
  const priorAmplitude = meanAmplitude(sorted);

  let best: { result: StructureResult; pairs: number; n: number } | null = null;
  for (const n of STRUCTURE_SWING_N) {
    const swings = detectSwings(sorted, n);
    if (swings.length < 4) continue;
    const result = classifyStructure(swings, { ...params, lastPrice, priorAmplitude, currentIndex });
    if (!result) continue;
    const pairs = Math.min(
      swings.filter((swing) => swing.kind === 'high').length,
      swings.filter((swing) => swing.kind === 'low').length,
    );
    if (best === null || isBetterStructure(result, pairs, n, best.result, best.pairs, best.n)) {
      best = { result, pairs, n };
    }
  }
  return best === null ? null : best.result;
}

/**
 * Structure-regularity comparison for `probeStructure`. Priority: 触碰次数多 >
 * swing 对数多 > score 强 > N 小 (防大 N 过度平滑). All candidates here already have
 * a structure, so the "有结构" level of the priority is implicit.
 */
function isBetterStructure(
  a: StructureResult,
  aPairs: number,
  aN: number,
  b: StructureResult,
  bPairs: number,
  bN: number,
): boolean {
  if (a.touchCount !== b.touchCount) return a.touchCount > b.touchCount;
  if (aPairs !== bPairs) return aPairs > bPairs;
  if (a.score !== b.score) return a.score > b.score;
  return aN < bN;
}

/**
 * Builds a `StructureParams` from the file-top default constants, so callers (the
 * service in a later phase, tests now) don't repeat the calibration values. The
 * data fields `lastPrice`/`priorAmplitude` are left for `probeStructure` to fill.
 */
export function defaultStructureParams(overrides?: Partial<StructureParams>): StructureParams {
  return {
    slopeTolerance: DEFAULT_SLOPE_TOLERANCE,
    touchMin: DEFAULT_TOUCH_MIN,
    maxBoxRelativeHeight: DEFAULT_MAX_BOX_RELATIVE_HEIGHT,
    monotonicTolerance: DEFAULT_MONOTONIC_TOLERANCE,
    boxRangeTolerance: DEFAULT_BOX_RANGE_TOLERANCE,
    ...overrides,
  };
}
