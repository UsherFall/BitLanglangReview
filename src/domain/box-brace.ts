/**
 * Box-braces (箱体蓄力) detection — an independent scan method, kept alongside
 * the 距线 scan.
 *
 * 10/20: the volatility-shrink detector this module used to contrast itself
 * against (`detectConvergence`) was REMOVED from the product — nine attempts at
 * it had all failed and the user ruled that "收敛算法实现不了"
 * (10-19-fakeout-retest-quality/research/HANDOFF.md §3.1). The 选品 scan now
 * measures the distance to the user's OWN drawn lines instead. This module stays
 * because the user did NOT reject it: it finds a box whose HEIGHT is a small
 * fraction of the preceding move's own travel, still holding the upper half of
 * that move and not yet broken — on the 26 hand-picked "good stretches" that
 * pattern was found on the bar before the breakout 22/25 times.
 *
 * Everything here is look-ahead free (`candles[last]` is the decision bar) and
 * relative — no absolute percentage thresholds — so one calibration works on a
 * quiet blue chip and on a 5%-per-bar alt alike. Deriving the coarse screen is
 * NOT part of this module.
 */
import type { Candlestick } from './candlestick';

/** Minimum box length (bars): shorter than this is a pause, not a 閽冨嫬濮?phase. */
export const SQUEEZE_MIN_RUN = 5;
/** Longest box searched. Longer structures are judged by their last window. */
export const SQUEEZE_MAX_RUN = 30;
/**
 * Box height over the preceding move's travel. 0.65 admits every one of the
 * user's hand-picked stretches (measured 0.34閳?.64) while rejecting a box as
 * tall as the move itself.
 */
export const SQUEEZE_MAX_HEIGHT_RATIO = 0.65;
/** Lookbacks (bars) whose travel is compared against the box; the widest wins. */
export const SQUEEZE_LOOKBACKS = [10, 20, 40] as const;

export type BoxBraceParams = {
  /** Minimum box length in bars. Absent 閳?`SQUEEZE_MIN_RUN`. */
  minRun?: number;
  /** Maximum box length in bars. Absent 閳?`SQUEEZE_MAX_RUN`. */
  maxRun?: number;
  /** Box height / move travel ceiling. Absent 閳?`SQUEEZE_MAX_HEIGHT_RATIO`. */
  maxHeightRatio?: number;
};

/** One detected box, all measures relative to the box and its own preceding move. */
export type BoxBrace = {
  /** Index of the box's first bar (inclusive) inside the sorted input. */
  startIndex: number;
  /** Index of the decision bar (always the last bar of the input). */
  endIndex: number;
  /** Box length in bars, `endIndex - startIndex + 1`. */
  bars: number;
  /** Lowest low / highest high of the box. */
  boxLow: number;
  boxHigh: number;
  /** `(boxHigh - boxLow) / lastClose`, in percent. Display measure. */
  heightPct: number;
  /** Box height / preceding move travel 閳?smaller = tighter. The ranking key. */
  squeeze: number;
  /** Close's position inside the box, 0 (low) 閳?1 (high). */
  position: number;
  /**
   * Where the box bottom sits inside the move, 0 = at the move's low, 1 = at its
   * high. Negative when the box undercuts the move's low (a retracement that
   * went past the origin).
   */
  bottomInMove: number;
  /** The preceding move the box is measured against. */
  moveLow: number;
  moveHigh: number;
  /** Move travel as a fraction of the last close. */
  movePct: number;
};

/**
 * Locate the move consolidated by a box starting at `boxStart`: the widest
 * high-low travel over `SQUEEZE_LOOKBACKS` bars immediately before it. Looking
 * at several lookbacks (instead of one fixed length) keeps the measure stable
 * whether the move was a 10-day sprint or a 40-day grind.
 */
function precedingMove(candles: readonly Candlestick[], boxStart: number): { low: number; high: number } | null {
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  let found = false;
  for (const look of SQUEEZE_LOOKBACKS) {
    const from = Math.max(0, boxStart - look);
    if (boxStart - from < 3) continue;
    let hi = Number.NEGATIVE_INFINITY;
    let lo = Number.POSITIVE_INFINITY;
    for (let i = from; i < boxStart; i += 1) {
      if (candles[i].high > hi) hi = candles[i].high;
      if (candles[i].low < lo) lo = candles[i].low;
    }
    if (hi - lo > high - low || !found) {
      low = lo;
      high = hi;
      found = true;
    }
  }
  return found ? { low, high } : null;
}

/**
 * How far a box may grow, in bars, before the window above it must start
 * EXACTLY where the box is: catches a boundary bar (its wick straddles the box
 * edge) that a taller window would otherwise swallow. Disabled (no gate) at or
 * below `SQUEEZE_GRACE_BARS` bars, where one bar of noise is unavoidable.
 */
export const SQUEEZE_GRACE_BARS = 3;
/**
 * How much a window's squeeze may worsen (relative) while extending the same
 * box. A boundary bar under the box (its wick straddling the edge) widens the
 * measure by ~8x on synthetic data but only ~2x on the user's 26 real stretches;
 * a window that starts eating the MOVE widens it by more than this, and its
 * extra bars are not counted as box maturity.
 */
export const SQUEEZE_BOUNDARY_GROWTH = 10;
/**
 * A window that qualifies ONE BAR LONGER than the current best but more than
 * `SQUEEZE_BOUNDARY_GROWTH` times wider still counts: it absorbed the boundary
 * bar under the box. Only growth BEYOND one bar that keeps widening is rejected,
 * because that is the window eating the MOVE rather than the box maturing.
 */
export const SQUEEZE_BOUNDARY_SPAN = 1;

/**
 * Detect the best box on the series ending at its last bar.
 *
 * A candidate box is every window `[last - len + 1 .. last]` for
 * `minRun <= len <= maxRun` that passes:
 * - **Contained**: the decision bar's close is still inside the box 閳?a broken
 *   box is not 閽冨嫬濮?any more, and the scan is meant to fire BEFORE the breakout.
 * - **Squeezed**: `boxHeight <= maxHeightRatio * moveTravel`, i.e. the box is
 *   small relative to the move that preceded it.
 *
 * Among the qualifying windows the LONGEST wins (the maturity of the phase),
 * ties broken by the tightest squeeze. Growth is honest, though: a window one
 * bar longer than the current best may absorb that single boundary bar even when
 * it widens the measure, but a jump beyond `SQUEEZE_BOUNDARY_GROWTH` means the
 * window has started eating the MOVE 閳?it counts as the same length, not as a
 * longer box, so the tighter box keeps its start.
 */
export function detectBoxBrace(candles: readonly Candlestick[], params: BoxBraceParams = {}): BoxBrace | null {
  const minRun = params.minRun ?? SQUEEZE_MIN_RUN;
  const maxRun = params.maxRun ?? SQUEEZE_MAX_RUN;
  const maxHeightRatio = params.maxHeightRatio ?? SQUEEZE_MAX_HEIGHT_RATIO;
  if (candles.length < minRun + 3) return null;
  const lastIndex = candles.length - 1;
  const lastClose = candles[lastIndex].close;
  if (!(lastClose > 0)) return null;

  const windows: BoxBrace[] = [];
  for (let len = minRun; len <= maxRun && len <= candles.length; len += 1) {
    const startIndex = lastIndex - len + 1;
    let boxLow = Number.POSITIVE_INFINITY;
    let boxHigh = Number.NEGATIVE_INFINITY;
    for (let i = startIndex; i <= lastIndex; i += 1) {
      if (candles[i].low < boxLow) boxLow = candles[i].low;
      if (candles[i].high > boxHigh) boxHigh = candles[i].high;
    }
    const height = boxHigh - boxLow;
    if (!(height > 0)) continue;
    if (lastClose < boxLow || lastClose > boxHigh) continue;
    const move = precedingMove(candles, startIndex);
    if (move === null) continue;
    // The move is what came BEFORE: a box that reaches above it has not been
    // consolidated from a move yet (measured: otherwise any rising box is
    // squeezed against its own right edge).
    if (boxHigh >= move.high) continue;
    const travel = move.high - move.low;
    if (!(travel > 0)) continue;
    const squeeze = height / travel;
    if (squeeze > maxHeightRatio) continue;
    windows.push({
      startIndex,
      endIndex: lastIndex,
      bars: len,
      boxLow,
      boxHigh,
      heightPct: (height / lastClose) * 100,
      squeeze,
      position: (lastClose - boxLow) / height,
      bottomInMove: (boxLow - move.low) / travel,
      moveLow: move.low,
      moveHigh: move.high,
      movePct: (travel / lastClose) * 100,
    });
  }
  return selectWindow(windows);
}

/** Builds a `BoxBraceParams` from the file-top constants, so callers don't repeat them. */
export function defaultBoxBraceParams(overrides?: Partial<BoxBraceParams>): Required<BoxBraceParams> {
  return {
    minRun: SQUEEZE_MIN_RUN,
    maxRun: SQUEEZE_MAX_RUN,
    maxHeightRatio: SQUEEZE_MAX_HEIGHT_RATIO,
    ...overrides,
  };
}


/**
 * Pick the reported window: the longest one, but a window that is more than
 * `SQUEEZE_BOUNDARY_SPAN` bars longer than the tightest qualifying one AND more
 * than `SQUEEZE_BOUNDARY_GROWTH` times wider is rejected as "the move, not the
 * box". Ties on length go to the tightest squeeze.
 */
function selectWindow(windows: readonly BoxBrace[]): BoxBrace | null {
  if (windows.length === 0) return null;
  // The 'seed' is the SHORTEST qualifying window: it is the tightest read of the
  // box, and every longer window is compared against it — a boundary bar widens
  // the measure ~1.2-2x, so only a jump past SQUEEZE_BOUNDARY_GROWTH is the move.
  const byLengthForSeed = [...windows].sort((a, b) => a.bars - b.bars || a.squeeze - b.squeeze);
  const seed = byLengthForSeed[0]!;
  const byLength = [...windows].sort((a, b) => a.bars - b.bars || a.squeeze - b.squeeze);
  let best = seed;
  for (const window of byLength) {
    if (window.bars <= best.bars) {
      if (window.bars === best.bars && window.squeeze < best.squeeze) best = window;
      continue;
    }
    const tooWide = window.squeeze > seed.squeeze * SQUEEZE_BOUNDARY_GROWTH;
    if (tooWide && window.bars > seed.bars + SQUEEZE_BOUNDARY_SPAN) continue;
    best = window;
  }
  return best;
}


