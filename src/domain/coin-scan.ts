import type { Candlestick } from './candlestick';
import type { ReviewTimeframe } from './trade';

export const scanTimeframes: ReviewTimeframe[] = ['5m', '15m', '1H', '4H', '1D'];

/**
 * Kind of convergence structure. A coin is 蓄力待突破 when its price has collapsed
 * into one of these two shapes:
 * - `triangle`: converging trend lines (lower highs + higher lows, or one side
 *   flat). Direction is not locked — both bullish and bearish wedges qualify.
 * - `convergence`: a flat, calm band — the price has settled into a narrow
 *   horizontal range (bar-to-bar volatility meaningfully below both the coin's
 *   own typical level and the move before it). Volatility-based (bar-driven),
 *   not fractal-based.
 */
export type ConvergenceStructure = 'triangle' | 'convergence';

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
 * Classification thresholds for `classifyStructure` / `backscanWindow` /
 * `probeStructure` / `detectConvergence`.
 *
 * `slopeTolerance`, `touchMin`, `boxRangeTolerance`, `maxFlatDriftRatio`,
 * `minSpanTriangle`, `structureTolerance`, `priceToleranceFloorRatio` and the
 * convergence knobs (`minRun`, `flatRatio`, `convergenceRatio`, `lengthScale`)
 * are the calibration knobs the design keeps internal (not exposed in the UI);
 * `lastPrice`, `priorAmplitude` and `currentIndex` are data that `probeStructure`
 * measures from the candles and injects so the pure classifier can stay
 * stateless.
 */
export type StructureParams = {
  /**
   * Horizontal-drift tolerance for an edge: an edge counts as flat when the
   * regression line's TOTAL drift across the edge's swing span, normalized by
   * the edge's mean price, is <= slopeTolerance. Total-drift (not per-bar slope)
   * is used so a long, slowly-tilting structure is not mistaken for a flat
   * channel. The drift is scale-free (relative to the edge's own price), so one
   * value works for any timeframe and volatility level.
   */
  slopeTolerance: number;
  /**
   * Minimum touch points per edge for a structure to be mature (宁少勿滥). Both
   * edges need at least touchMin swing points. Must be >= 2 — a 1-point edge
   * cannot feed a linear regression, so lower values are clamped to 2.
   */
  touchMin: number;
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
   * Flat-edge drift ratio gate: an edge's net drift (relative to mean price) must
   * be <= this × priorAmplitude for the edge to count as flat. Absent → falls
   * back to DEFAULT_MAX_FLAT_DRIFT_RATIO. Skipped when priorAmplitude is absent
   * (falls back to slopeTolerance only).
   */
  maxFlatDriftRatio?: number;
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
   * Box/triangle-flat-edge range gate: an edge's (max - min) / mean swing-price
   * spread must be <= this for the edge to count as horizontal. Absent →
   * `DEFAULT_BOX_RANGE_TOLERANCE`.
   */
  boxRangeTolerance?: number;
  /**
   * Minimum formation span (in K bars) for a triangle: the backscanned segment's
   * span (last swing index - first swing index) must be >= this. A triangle needs
   * enough bars to be a real 蓄力 structure, not a 3-swing blip. Absent →
   * `DEFAULT_MIN_SPAN_TRIANGLE`.
   */
  minSpanTriangle?: number;
  /**
   * Slope-break / edge-validity tolerance, unified with the backscan's
   * noise-spike judgement. A swing's bar CLOSE may poke through its edge trend
   * line by up to this fraction of the structure width at that bar (the distance
   * between the two trend lines) before it counts as a genuine break; a closer
   * that recovers inside the tolerance is a wick 毛刺. Absent →
   * `DEFAULT_STRUCTURE_TOLERANCE`.
   */
  structureTolerance?: number;
  /**
   * Price-inside gate floor for a triangle: the current-price poke tolerance is
   * `max(0.1 * widthAt(currentBar), floorRatio * priorAmplitude * lastPrice)`.
   * Near the apex the two trend lines converge and `0.1 * width` collapses to
   * ~0, so a still-forming triangle is rejected on any 1-2 bar wiggle. The floor
   * anchors the tolerance to the coin's own per-bar noise (one average bar's
   * worth of 毛刺 room) so a nearly-converged triangle keeps its 蓄力 verdict
   * while a genuine breakout (price moves several bars past the apex) is still
   * rejected. Absent → `DEFAULT_PRICE_TOLERANCE_FLOOR_RATIO`. Skipped when
   * `priorAmplitude` is absent (direct unit-test calls fall back to `0.1*width`).
   */
  priceToleranceFloorRatio?: number;
  /**
   * Minimum length (in K bars) of the calm band for a volatility convergence.
   * Absent → `DEFAULT_CONVERGENCE_MIN_RUN`.
   */
  minRun?: number;
  /**
   * Adaptive flatness for a convergence band: an edge (the band's low regression
   * drift, or high regression drift) counts as flat when its total drift is <=
   * `flatRatio × coinVol`, where `coinVol` is the coin's own typical per-bar
   * volatility (median over the scanned window). Scaling the tolerance by the
   * coin's own volatility keeps the flatness meaningful across coins and
   * timeframes. Absent → `DEFAULT_CONVERGENCE_FLAT_RATIO`.
   */
  flatRatio?: number;
  /**
   * Convergence gate: a calm band qualifies as a convergence only when its own
   * median per-bar volatility is < `convergenceRatio ×` the median volatility of
   * the SAME-LENGTH segment immediately before it — i.e. the price is meaningfully
   * calmer than the move that preceded it. Absent → `DEFAULT_CONVERGENCE_RATIO`.
   */
  convergenceRatio?: number;
  /**
   * Score length scale for a convergence band: the length contribution
   * `clamp01(runLen / lengthScale)` reaches full marks at this many bars. Absent →
   * `DEFAULT_CONVERGENCE_LENGTH_SCALE`.
   */
  lengthScale?: number;
};

/**
 * A fractal swing point. `index` is the bar index into the ascending-sorted
 * candle array, kept as the regression x-coordinate so trend lines can be
 * extrapolated to the current bar for `position`. `price` is high[i] for a swing
 * high and low[i] for a swing low. `close` is the close of the SAME bar — the
 * backscan's slope-break judgement compares each swing's close against its edge
 * trend line to separate wick 毛刺 (close recovers inside the tolerance) from a
 * genuine break (close pokes through the edge).
 */
export type SwingPoint = {
  /** Bar index (into the sorted candle array) where the fractal was found. */
  index: number;
  /** Bar open time (ms). */
  timestamp: number;
  /** Fractal price: high[i] for a swing high, low[i] for a swing low. */
  price: number;
  kind: 'high' | 'low';
  /** Close of the bar where the fractal was found (slope-break judgement). */
  close: number;
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
 * and can form a triangle side. 0.02 = an edge may drift at most 2% of its own
 * price from first to last swing and still count as a horizontal box edge.
 */
export const DEFAULT_SLOPE_TOLERANCE = 0.02;
/** Minimum touch points per edge for a mature structure (both edges). */
export const DEFAULT_TOUCH_MIN = 2;
/**
 * Score-normalization scale for the touch contribution (this many touches = full
 * marks). Kept at 8 for backward compatibility with the old fixed-window constant
 * name; the backscan no longer windows to this many swings.
 */
export const DEFAULT_MAX_STRUCTURE_SWINGS = 8;
/**
 * Recency gate default: a structure's last swing must be within this many bars
 * of the current bar (currentIndex) to count as "现役". A swing sequence whose
 * most recent touch is older than this has already resolved.
 */
export const DEFAULT_MAX_RECENT_BARS = 12;
/**
 * Box/triangle-flat-edge range gate: an edge's (max − min) / mean swing-price
 * spread must be <= this for a horizontal channel. 0.05 = the edge may spread at
 * most 5% of its mean price.
 */
export const DEFAULT_BOX_RANGE_TOLERANCE = 0.05;
/**
 * Flat-edge drift ratio gate: an edge's net drift (relative to its mean price)
 * must be <= this × the coin's own past amplitude (priorAmplitude) for the edge
 * to count as flat. 1.0 = an edge may drift at most one full own-amplitude and
 * still count as flat. Skipped when priorAmplitude is absent.
 */
export const DEFAULT_MAX_FLAT_DRIFT_RATIO = 1.0;
/**
 * Minimum formation span (in K bars) for a triangle. The backscanned segment must
 * span at least this many bars from its first swing to the current swing — a
 * triangle needs enough bars to be a genuine 蓄力 structure, not a 3-swing blip.
 * Calibrated on real data (MRVL/SNDK/SOXX genuine triangles span far more than
 * this; short dip-rebound noise spans less).
 */
export const DEFAULT_MIN_SPAN_TRIANGLE = 13;
/**
 * Slope-break tolerance: a swing's bar CLOSE may poke through its edge trend line
 * by up to this fraction of the structure width at that bar before it counts as a
 * genuine break (单根反向 + 容忍度). 0.2 = 20% of the local channel width. A closer
 * that recovers inside the tolerance is a wick 毛刺 (影线穿透不算); a closer beyond
 * it is a true break and terminates the backscan. Calibrated on real data.
 */
export const DEFAULT_STRUCTURE_TOLERANCE = 0.2;
/**
 * Price-inside gate floor for a triangle: `priceTolerance = max(0.1 * width,
 * floorRatio * priorAmplitude * lastPrice)`. 1.0 = the current price may sit up
 * to one average bar (the coin's own per-bar amplitude) outside a nearly-
 * converged apex before the structure counts as broken. A genuine breakout moves
 * price several bars past the apex, so the floor keeps 蓄力 verdicts while still
 * rejecting real breaks. Calibrated on real data (MU 15m near-apex triangle).
 */
export const DEFAULT_PRICE_TOLERANCE_FLOOR_RATIO = 1.0;
/**
 * Minimum length (in K bars) of the calm band for a volatility convergence. A
 * band needs enough bars to be a real 蓄力 phase, not a 2-bar blip. Calibrated
 * on real data (8/12 MU 15m box spans 13+ bars).
 */
export const DEFAULT_CONVERGENCE_MIN_RUN = 5;
/**
 * Adaptive flatness for a convergence band: an edge (low/high regression drift)
 * counts as flat when its total drift is <= this × the coin's own typical
 * per-bar volatility (median over the scanned window). 1.2 = an edge may drift at
 * most 1.2 typical bars before it reads as a trend rather than a flat band.
 * Scaling by the coin's own volatility keeps flatness meaningful across coins and
 * timeframes. Calibrated on real data: 8/12's flat box (drift 0.34% vs coinVol
 * 0.39%) passes, 8/13's rising-low triangle (drift 0.7% vs coinVol 0.40%) fails.
 */
export const DEFAULT_CONVERGENCE_FLAT_RATIO = 1.2;
/**
 * Convergence gate: a calm band qualifies as a convergence only when its own
 * median per-bar volatility is < this × the median volatility of the SAME-LENGTH
 * segment immediately before it. 0.8 = the band must be at least 20% calmer than
 * the move that preceded it; a sub-range with unchanged volatility (a flat stretch
 * inside a larger rise) is not a convergence.
 */
export const DEFAULT_CONVERGENCE_RATIO = 0.8;
/**
 * Score length scale for a convergence band: the length contribution
 * `clamp01(runLen / lengthScale)` reaches full marks at this many bars. 16 = a
 * ~4-hour 15m band scores full length marks.
 */
export const DEFAULT_CONVERGENCE_LENGTH_SCALE = 16;
/**
 * Absolute calm gate: a band qualifies as a convergence only when its own median
 * per-bar volatility is < this × the coin's typical per-bar volatility (window
 * median). A band must be genuinely QUIET — below the coin's normal bar size —
 * not merely calmer than an immediate spike. This rejects flat tails that ride
 * on the coin's usual volatility (e.g. a triangle fixture's flat filler bars, or
 * 8/13's tail whose bars are larger than the coin's own typical bar).
 */
export const DEFAULT_CONVERGENCE_ABSOLUTE_RATIO = 0.8;
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

/** Median of an array; 0 for an empty array. Robust to spikes. */
function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Mean per-bar relative amplitude ((high - low) / low) across the candles. */
function meanAmplitude(candles: readonly Candlestick[]): number {
  if (candles.length === 0) return 0;
  let sum = 0;
  for (const candle of candles) sum += (candle.high - candle.low) / candle.low;
  return sum / candles.length;
}

/**
 * Total drift of a price series across a segment: the absolute slope of the
 * OLS regression (x = bar index) times the segment span, normalized by the mean
 * price. Used by `detectConvergence`'s adaptive flatness gate.
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
 * price). Each swing carries the close of its bar for the slope-break judgement.
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
    if (isHigh) raw.push({ index: i, timestamp: bar.timestamp, price: bar.high, kind: 'high', close: bar.close });
    if (isLow) raw.push({ index: i, timestamp: bar.timestamp, price: bar.low, kind: 'low', close: bar.close });
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

/** Reference edge lines of a swing segment, for the backscan's slope-break check. */
function referenceLines(
  swings: readonly SwingPoint[],
): { highLine: RegLine | null; lowLine: RegLine | null } {
  const highs = swings.filter((swing) => swing.kind === 'high');
  const lows = swings.filter((swing) => swing.kind === 'low');
  return {
    highLine: linearRegression(highs.map((swing) => ({ x: swing.index, y: swing.price }))),
    lowLine: linearRegression(lows.map((swing) => ({ x: swing.index, y: swing.price }))),
  };
}

/**
 * Backward-scan window determination: from the most recent swing (current), scan
 * backward over the complete swing sequence to find the continuous segment where
 * the convergence form holds. This replaces the old "fixed most-recent-8 swings"
 * window with a structure-driven boundary.
 *
 * Two phases:
 *
 * 1. **Base structure** — walk i from the end backward and take the FIRST suffix
 *    `swings[i..end]` that `classifyStructure` accepts. This is the current
 *    structure (its last swing is the current bar, so the recency gate holds).
 *    If no suffix forms a structure → null (no form at the current position).
 *
 * 2. **Extend backward** — keep including the next-earlier swing while it belongs
 *    to the same form. Each candidate swing is judged against the CURRENT
 *    segment's edge trend lines (the established structure, NOT recomputed with
 *    the candidate — otherwise an INTC-style 103 spike would pull the regression
 *    toward itself and sneak in):
 *      - a high swing breaks when its bar CLOSE pokes above the high edge by
 *        more than `structureTolerance × width` at that bar;
 *      - a low swing breaks when its close pokes below the low edge by more than
 *        that tolerance.
 *    A close that recovers inside the tolerance is a wick 毛刺 and the swing is
 *    kept. After a candidate passes the close check it is included and the
 *    extended segment is re-classified (must still form the SAME structure kind);
 *    if either check fails the extension stops and the structure starts after the
 *    breaking swing.
 *
 * The result is the swing subsequence of the continuous form segment (the
 * structure's swing points, ending at the current swing), or null.
 */
export function backscanWindow(
  swings: readonly SwingPoint[],
  candles: readonly Candlestick[],
  params: StructureParams,
): SwingPoint[] | null {
  if (swings.length < 4) return null;
  const currentIndex = params.currentIndex ?? candles.length - 1;

  // Phase 1: base structure — the most recent suffix that classifies.
  let baseStart = -1;
  let baseKind: ConvergenceStructure | null = null;
  for (let i = swings.length - 1; i >= 0; i -= 1) {
    const segment = swings.slice(i);
    const result = classifyStructure(segment, { ...params, currentIndex });
    if (result) {
      baseStart = i;
      baseKind = result.structure;
      break;
    }
  }
  if (baseStart < 0 || baseKind === null) return null;

  // Phase 2: extend backward while the candidate swing keeps the same form.
  let start = baseStart;
  const tolerance = params.structureTolerance ?? DEFAULT_STRUCTURE_TOLERANCE;
  for (let i = baseStart - 1; i >= 0; i -= 1) {
    const candidate = swings[i];
    const current = swings.slice(start);
    const { highLine, lowLine } = referenceLines(current);
    if (!highLine || !lowLine) break; // degenerate segment (can't evaluate the break)

    const width = highLine.slope * candidate.index + highLine.intercept -
      (lowLine.slope * candidate.index + lowLine.intercept);
    if (width <= 0) break; // crossed at the candidate's bar — not a valid extension

    const lineValue =
      candidate.kind === 'high'
        ? highLine.slope * candidate.index + highLine.intercept
        : lowLine.slope * candidate.index + lowLine.intercept;
    const breaks =
      candidate.kind === 'high'
        ? candidate.close > lineValue + tolerance * width
        : candidate.close < lineValue - tolerance * width;
    if (breaks) break; // 真破 — the structure starts after this swing

    // Include the swing; it must still form the SAME structure kind.
    const extended = swings.slice(i);
    const extendedResult = classifyStructure(extended, { ...params, currentIndex });
    if (!extendedResult || extendedResult.structure !== baseKind) break;
    start = i;
  }

  return swings.slice(start);
}

/**
 * Classifies a swing sequence into a box or a triangle, returning a fully
 * scored `StructureResult` when a structure is present, or null when the swing
 * geometry does not form either shape.
 *
 * The sequence passed in is expected to be the backscanned continuous segment
 * (see `backscanWindow`) — this function no longer windows to the most recent
 * swings, so callers that pass a full sequence including an old regime must
 * backscan it first.
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
 * Unified slope-break / edge-validity gate (replaces the old percentage
 * `monotonicTolerance`): every edge swing's bar CLOSE must stay inside the
 * structure channel. A swing whose close pokes through its edge trend line by
 * more than `structureTolerance × width` (the distance between the two trend
 * lines at that bar) is a genuine break — 单根反向 + 容忍度, the same judgement the
 * backscan uses for a noise spike. This catches the HEI deep-low spike, the HFT
 * narrow-band rebound, and an INTC-style pre-trend spike far above a flat edge,
 * while letting genuine triangles (bars close inside the wedge) and boxes (bars
 * close on/near their edges) pass.
 *
 * B gate: the segment's span (last swing index - first swing index, in K bars)
 * must be >= the structure kind's minimum formation span — `minSpanTriangle`
 * (13) or `minSpanBox` (5).
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
 * at the current bar) is rejected as resolved.
 *
 * The `priorAmplitude` low-volatility gate is applied only when a finite value is
 * supplied (probeStructure always supplies it). Absent, the gate is skipped so a
 * direct unit-test call without candle context is not spuriously rejected.
 */
export function classifyStructure(swings: readonly SwingPoint[], params: StructureParams): StructureResult | null {
  // A box/triangle needs at least one swing high and one swing low per edge; with
  // fewer than 4 swings the geometry cannot be verified (2 high + 2 low minimum).
  if (swings.length < 4) return null;

  const highs = swings.filter((swing) => swing.kind === 'high');
  const lows = swings.filter((swing) => swing.kind === 'low');
  const touchMin = Math.max(params.touchMin, 2);
  if (highs.length < touchMin || lows.length < touchMin) return null;

  // Anchor everything to the current bar. probeStructure injects the last candle
  // index; a direct call without it falls back to the last swing index.
  const currentIndex = params.currentIndex ?? swings[swings.length - 1].index;
  // Recency gate (both structure kinds): the structure's last swing must be close
  // enough to the current bar to be 现役.
  const maxRecentBars = params.maxRecentBars ?? DEFAULT_MAX_RECENT_BARS;
  if (currentIndex - swings[swings.length - 1].index > maxRecentBars) return null;

  const highLine = linearRegression(highs.map((swing) => ({ x: swing.index, y: swing.price })));
  const lowLine = linearRegression(lows.map((swing) => ({ x: swing.index, y: swing.price })));
  if (!highLine || !lowLine) return null;

  const highPrices = highs.map((swing) => swing.price);
  const lowPrices = lows.map((swing) => swing.price);
  const meanHigh = mean(highPrices);
  const meanLow = mean(lowPrices);
  // Total edge drift across its swing span, as a fraction of the edge's mean
  // price.
  const highSpan = highs[highs.length - 1].index - highs[0].index;
  const lowSpan = lows[lows.length - 1].index - lows[0].index;
  const highDrift = (Math.abs(highLine.slope) * highSpan) / meanHigh;
  const lowDrift = (Math.abs(lowLine.slope) * lowSpan) / meanLow;
  // An edge is flat only when its net drift is small BOTH as a fraction of its
  // own mean price (slopeTolerance) AND relative to the coin's own past
  // amplitude (maxFlatDriftRatio). priorAmplitude absent (direct classifier call
  // without candle context) skips the relative gate.
  const prior = params.priorAmplitude;
  const driftRatioAvailable = prior !== undefined && Number.isFinite(prior) && prior > 0;
  const maxFlatDriftRatio = params.maxFlatDriftRatio ?? DEFAULT_MAX_FLAT_DRIFT_RATIO;
  const highDriftRatio = driftRatioAvailable ? highDrift / prior : 0;
  const lowDriftRatio = driftRatioAvailable ? lowDrift / prior : 0;
  const highFlat =
    highDrift <= params.slopeTolerance &&
    (!driftRatioAvailable || highDriftRatio <= maxFlatDriftRatio);
  const lowFlat =
    lowDrift <= params.slopeTolerance &&
    (!driftRatioAvailable || lowDriftRatio <= maxFlatDriftRatio);
  const highFalling = highLine.slope < 0 && highDrift > params.slopeTolerance;
  const lowRising = lowLine.slope > 0 && lowDrift > params.slopeTolerance;
  const touchCount = highs.length + lows.length;
  const lastPrice = params.lastPrice ?? swings[swings.length - 1].price;

  // ---- unified slope-break / edge-validity gate (replaces monotonicTolerance) ----
  // Channel width between the two trend lines at bar x.
  const widthAt = (x: number) =>
    (highLine.slope - lowLine.slope) * x + (highLine.intercept - lowLine.intercept);
  const structureTolerance = params.structureTolerance ?? DEFAULT_STRUCTURE_TOLERANCE;
  // Upper edge (flat or falling): a high swing whose bar CLOSE is above the edge
  // by more than tolerance×width has broken out — 真破, not 蓄力.
  for (const swing of highs) {
    const width = widthAt(swing.index);
    if (width <= 0) continue; // crossed/degenerate region; the narrowing gate handles it
    const lineValue = highLine.slope * swing.index + highLine.intercept;
    if (swing.close > lineValue + structureTolerance * width) return null;
  }
  // Lower edge (flat or rising): a low swing whose bar CLOSE is below the edge by
  // more than tolerance×width has broken down.
  for (const swing of lows) {
    const width = widthAt(swing.index);
    if (width <= 0) continue;
    const lineValue = lowLine.slope * swing.index + lowLine.intercept;
    if (swing.close < lineValue - structureTolerance * width) return null;
  }

  // B gate: minimum formation span (in K bars) for the triangle.
  const structureSpan = swings[swings.length - 1].index - swings[0].index;

  // ---- triangle ----
  const symmetric = highFalling && lowRising;
  const rising = highFlat && lowRising; // 上升三角: flat highs, rising lows
  const falling = highFalling && lowFlat; // 下降三角: falling highs, flat lows
  if (symmetric || rising || falling) {
    if (structureSpan < (params.minSpanTriangle ?? DEFAULT_MIN_SPAN_TRIANGLE)) return null;
    // Range gate for a triangle's flat edge: a side that is supposed to be flat
    // must actually stay in a narrow band, not merely regress to ~0 slope. The
    // symmetric branch has no flat side (both edges trend) and keeps only its
    // edge-validity gate.
    const boxRangeTolerance = params.boxRangeTolerance ?? DEFAULT_BOX_RANGE_TOLERANCE;
    if (rising && (maxValue(highPrices) - minValue(highPrices)) / meanHigh > boxRangeTolerance) return null;
    if (falling && (maxValue(lowPrices) - minValue(lowPrices)) / meanLow > boxRangeTolerance) return null;
    const firstIndex = swings[0].index;
    // Channel width between the two trend lines at bar x.
    const widthStart = widthAt(firstIndex);
    const widthCurrent = widthAt(currentIndex);
    // 收敛度: fraction of the starting width already collapsed by the CURRENT bar.
    if (widthStart > 0 && widthCurrent > 0 && widthCurrent < widthStart) {
      const upper = highLine.slope * currentIndex + highLine.intercept;
      const lower = lowLine.slope * currentIndex + lowLine.intercept;
      const width = upper - lower;
      // 价格在结构内: the extrapolated lines bound the current price. Near the
      // apex the two lines converge and 0.1*width collapses to ~0, so the
      // tolerance is floored at the coin's own per-bar amplitude — one average
      // bar's worth of 毛刺 room so a nearly-converged triangle keeps its 蓄力
      // verdict (a genuine breakout moves price several bars past the apex and is
      // still rejected). Absent prior data (direct unit-test call), the old
      // width-only tolerance applies.
      const priceTolerance = Math.max(
        0.1 * width,
        driftRatioAvailable ? (params.priceToleranceFloorRatio ?? DEFAULT_PRICE_TOLERANCE_FLOOR_RATIO) * prior * lastPrice : 0,
      );
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
 * Volatility-based convergence (收敛) detection. Unlike the fractal triangle scan,
 * this walks the RAW BARS and looks for a calm, flat band: the price has settled
 * into a narrow horizontal range whose bar-to-bar volatility is meaningfully below
 * both the coin's own typical level AND the move that preceded the band.
 *
 * Sliding scan over every possible band start; a band must pass:
 * - **Flatness**: the band's low-edge and high-edge regression drifts are both
 *   <= `flatRatio × coinVol`, where `coinVol` is the coin's own typical per-bar
 *   volatility (median over the scanned window). A rising-low or falling-high band
 *   is a triangle/trend, not a convergence. Scaling by the coin's own volatility
 *   keeps the tolerance meaningful across coins and timeframes.
 * - **Convergence**: the band's median per-bar volatility is < `convergenceRatio ×`
 *   the median volatility of the SAME-LENGTH segment immediately before it — the
 *   price is meaningfully calmer than the move before. Internal spikes are absorbed
 *   by the median, so an isolated volatile bar inside the band does not disqualify.
 * - **Containment**: the current price is inside the band's [min low, max high]
 *   range (with a small tolerance) — a price that has broken out is no longer 蓄力.
 *
 * The best band (longest + calmest) is scored: relative calm (vs the preceding
 * segment) + absolute calm (vs the coin's own typical volatility) + length.
 * `probeStructure` compares this against the fractal triangle and reports the
 * higher-scoring structure, so a genuine triangle outranks a weak calm tail while
 * a strong flat convergence outranks a triangle that merely swallowed an old move.
 */
export function detectConvergence(candles: readonly Candlestick[], params: StructureParams): StructureResult | null {
  const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
  const minRun = params.minRun ?? DEFAULT_CONVERGENCE_MIN_RUN;
  if (sorted.length < minRun) return null;
  if (sorted.some((candle) => candle.low <= 0)) return null;

  const vol = sorted.map((candle) => (candle.high - candle.low) / candle.low);
  const coinVol = median(vol);
  const flatTol = (params.flatRatio ?? DEFAULT_CONVERGENCE_FLAT_RATIO) * coinVol;
  const convergenceRatio = params.convergenceRatio ?? DEFAULT_CONVERGENCE_RATIO;
  const lengthScale = params.lengthScale ?? DEFAULT_CONVERGENCE_LENGTH_SCALE;
  const last = sorted.length - 1;
  const lastPrice = sorted[last].close;

  let best: { score: number; runLen: number; rangeLow: number; rangeHigh: number } | null = null;
  for (let start = last - minRun + 1; start >= 0; start -= 1) {
    const runLen = last - start + 1;
    const band = sorted.slice(start, last + 1);
    // ---- flatness: low/high edge regression drift within tolerance ----
    if (Math.max(edgeDrift(band.map((c) => c.low), start), edgeDrift(band.map((c) => c.high), start)) > flatTol) continue;
    // ---- convergence: calmer than the SAME-LENGTH preceding segment ----
    const runMed = median(vol.slice(start, last + 1));
    const preStart = start - runLen;
    if (preStart < 0) continue;
    const preMed = median(vol.slice(preStart, start));
    if (runMed >= convergenceRatio * preMed) continue;
    // ---- absolute calm: the band must be genuinely quieter than the coin's
    // typical bar (window median), not merely calmer than an immediate spike ----
    if (runMed >= DEFAULT_CONVERGENCE_ABSOLUTE_RATIO * coinVol) continue;
    // ---- containment: current price inside the band's [min low, max high] ----
    const rangeLow = Math.min(...band.map((c) => c.low));
    const rangeHigh = Math.max(...band.map((c) => c.high));
    const tolerance = 0.1 * (rangeHigh - rangeLow);
    if (lastPrice < rangeLow - tolerance || lastPrice > rangeHigh + tolerance) continue;
    // ---- score: length-weighted maturity + calm. Length dominates — a long
    // quiet band is a strong 蓄力 while a 5-8 bar pause is not, so short bands
    // stay below the default minScore (0.7) while 8/12-style long convergences
    // score high. The weights sum to 1 (length 0.85 + calm 0.15), so the score
    // does not saturate to 1.0 for every convergence (previous formula summed
    // weights > 1 and clamped most convergences to 1.0).
    const relativeCalm = clamp01(1 - runMed / preMed);
    const absoluteCalm = clamp01(1 - runMed / coinVol);
    const lengthContribution = clamp01(runLen / lengthScale);
    const calm = (relativeCalm + absoluteCalm) / 2;
    const score = clamp01(0.85 * lengthContribution + 0.15 * calm);
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
 * Combination entry point: probes the fractal triangle scan AND the volatility
 * convergence detector, returning the higher-scoring structure.
 *
 * Triangle scan: for each candidate fractal N, `detectSwings` → `backscanWindow`
 * → `classifyStructure`. `detectConvergence` then scans the raw bars for a calm,
 * flat band. The higher-scoring structure wins, so a genuine triangle outranks a
 * weak calm tail while a strong flat convergence outranks a triangle that merely
 * swallowed an old move.
 *
 * `lastPrice`, `priorAmplitude` and `currentIndex` are measured here from the
 * completed candles and injected into `backscanWindow`/`classifyStructure`.
 */
export function probeStructure(candles: readonly Candlestick[], params: StructureParams): StructureResult | null {
  const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
  if (sorted.length < 4) return null;
  if (sorted.some((candle) => candle.low <= 0)) return null;

  const lastPrice = sorted[sorted.length - 1].close;
  const currentIndex = sorted.length - 1;
  // "该币自身前期波动": mean per-bar amplitude across the scanned window.
  const priorAmplitude = meanAmplitude(sorted);

  let best: { result: StructureResult; span: number; n: number } | null = null;
  for (const n of STRUCTURE_SWING_N) {
    const swings = detectSwings(sorted, n);
    if (swings.length < 4) continue;
    const segment = backscanWindow(swings, sorted, { ...params, lastPrice, priorAmplitude, currentIndex });
    if (!segment) continue;
    const span = segment[segment.length - 1].index - segment[0].index;
    const result = classifyStructure(segment, {
      ...params,
      lastPrice,
      priorAmplitude,
      currentIndex,
    });
    if (!result) continue;
    if (best === null || isBetterStructure(result, span, n, best.result, best.span, best.n)) {
      best = { result, span, n };
    }
  }
  const bestTriangle = best === null ? null : best.result;
  // Volatility convergence (bar-based): the higher-scoring structure wins.
  const convergence = detectConvergence(sorted, params);
  if (convergence !== null && (bestTriangle === null || convergence.score > bestTriangle.score)) {
    return convergence;
  }
  return bestTriangle;
}

/**
 * Structure-regularity comparison for `probeStructure`. Priority: 箱体 > 三角
 * (classifyStructure is triangle-only). All candidates here already have a
 * structure, so the "有结构" level of the priority is implicit. The volatility
 * convergence is compared separately in `probeStructure` by score.
 */
function isBetterStructure(
  a: StructureResult,
  aSpan: number,
  aN: number,
  b: StructureResult,
  bSpan: number,
  bN: number,
): boolean {
  if (a.touchCount !== b.touchCount) return a.touchCount > b.touchCount;
  if (aSpan !== bSpan) return aSpan > bSpan;
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
    boxRangeTolerance: DEFAULT_BOX_RANGE_TOLERANCE,
    maxFlatDriftRatio: DEFAULT_MAX_FLAT_DRIFT_RATIO,
    minSpanTriangle: DEFAULT_MIN_SPAN_TRIANGLE,
    structureTolerance: DEFAULT_STRUCTURE_TOLERANCE,
    priceToleranceFloorRatio: DEFAULT_PRICE_TOLERANCE_FLOOR_RATIO,
    minRun: DEFAULT_CONVERGENCE_MIN_RUN,
    flatRatio: DEFAULT_CONVERGENCE_FLAT_RATIO,
    convergenceRatio: DEFAULT_CONVERGENCE_RATIO,
    lengthScale: DEFAULT_CONVERGENCE_LENGTH_SCALE,
    ...overrides,
  };
}
