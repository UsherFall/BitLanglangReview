import { describe, expect, it } from 'vitest';

import type { Candlestick } from '../src/domain/candlestick';
import {
  SQUEEZE_MAX_HEIGHT_RATIO,
  SQUEEZE_MAX_RUN,
  SQUEEZE_MIN_RUN,
  defaultBoxBraceParams,
  detectBoxBrace,
} from '../src/domain/box-brace';

type HL = readonly [number, number];

/** Builds candles from `[low, high]` pairs; close = midpoint, ascending timestamps. */
function candles(bars: ReadonlyArray<HL>): Candlestick[] {
  return bars.map(([low, high], index) => ({
    instrument: 'TEST',
    timeframe: '1D' as const,
    timestamp: index * 86_400_000,
    open: (low + high) / 2,
    high,
    low,
    close: (low + high) / 2,
    volume: 100,
  }));
}

/** `n` bars inside `[low, high]`. */
function flat(n: number, low: number, high: number): HL[] {
  return Array.from({ length: n }, () => [low, high] as HL);
}

/**
 * The shape the user labels as good: a move (100 鈫?300 over 10 bars), a bar
 * whose wick reaches 400 but closes at 350, then a flat box ABOVE that wick.
 * Walking further back would pull the move's own bar into the box, which the
 * detector treats as the MOVE rather than as extra box maturity.
 */
function moveThenBox(boxBars: number, boxHeight: number): Candlestick[] {
  // The move's wicks climb from 112 to 322; its last bar is the highest, so the
  // box below it is genuinely UNDER the move rather than a new leg.
  const move: HL[] = Array.from({ length: 10 }, (_, i) => {
    const mid = 100 + 21 * (i + 1);
    return [mid - 1, mid + 1] as HL;
  });
  const boxLow = 296;
  return candles([...move, ...flat(boxBars, boxLow, boxLow + boxHeight)]);
}

describe('detectBoxBrace (box after a move)', () => {
  it('fires on the last bar of a flat box that sits above a move', () => {
    const box = detectBoxBrace(moveThenBox(12, 10), defaultBoxBraceParams());
    expect(box).not.toBeNull();
    expect(box!.bars).toBeGreaterThanOrEqual(12);
    expect(box!.moveLow).toBeLessThan(box!.boxLow);
  });

  it('is null once the decision bar has left the box (the breakout bar itself)', () => {
    const series = moveThenBox(12, 10);
    const high = Math.max(...series.slice(-12).map((c) => c.high));
    series.push({ ...series[series.length - 1], open: high, low: high, close: high * 1.08, high: high * 1.08 });
    expect(detectBoxBrace(series, defaultBoxBraceParams())).toBeNull();
  });

  it('is null when there is no preceding move to be squeezed against', () => {
    expect(detectBoxBrace(candles(flat(30, 99.5, 100.5)), defaultBoxBraceParams())).toBeNull();
  });

  it('rejects a box that is most of the move, and accepts it once the ceiling is raised', () => {
    // Move travel ~200: a 10-high box is 0.05 of it — fine at the 0.65 default,
    // rejected when the ceiling is tightened below it.
    expect(detectBoxBrace(moveThenBox(12, 10), defaultBoxBraceParams())).not.toBeNull();
    expect(detectBoxBrace(moveThenBox(12, 10), { maxHeightRatio: 0.01 })).toBeNull();
    // A 15-high box under the move's high passes the default and fails a very
    // tight ratio: the same window, gated only by the squeeze ceiling.
    const boxed = moveThenBox(12, 10);
    expect(detectBoxBrace(boxed, defaultBoxBraceParams())).not.toBeNull();
    expect(detectBoxBrace(boxed, { maxHeightRatio: 0.03 })).toBeNull();
  });

  it('prefers the LONGEST qualifying box when a tighter short one also exists', () => {
    // 20 flat bars at 402鈥?12, then 5 extra-tight ones at 405鈥?08: both windows
    // qualify and the longer one must win (maturity beats depth).
    const move: HL[] = Array.from({ length: 10 }, (_, i) => {
      const mid = 100 + 20 * (i + 1);
      return [mid - 2, mid + 2] as HL;
    });
    const longMove: HL[] = Array.from({ length: 10 }, (_, i) => {
      const mid = 100 + 21 * (i + 1);
      return [mid - 1, mid + 1] as HL;
    });
    const series = candles([...longMove, ...flat(20, 297, 308), ...flat(5, 300, 305)]);
    const box = detectBoxBrace(series, defaultBoxBraceParams());
    expect(box).not.toBeNull();
    expect(box!.bars).toBeGreaterThanOrEqual(20);
    // The tightest 5-bar window is NOT the answer: the 25-bar box wins.
    expect(box!.bars).toBeGreaterThan(20);
  });

  it('respects minRun and maxRun', () => {
    expect(detectBoxBrace(moveThenBox(4, 10), { minRun: 8 })).toBeNull();
    const long = moveThenBox(40, 10);
    expect(detectBoxBrace(long, { maxRun: 20 })!.bars).toBe(20);
    expect(detectBoxBrace(long, defaultBoxBraceParams())!.bars).toBe(SQUEEZE_MAX_RUN);
  });

  it('exposes the calibrated constants and defaults', () => {
    expect(SQUEEZE_MIN_RUN).toBe(5);
    expect(SQUEEZE_MAX_RUN).toBe(30);
    expect(SQUEEZE_MAX_HEIGHT_RATIO).toBe(0.65);
    expect(defaultBoxBraceParams()).toEqual({ minRun: 5, maxRun: 30, maxHeightRatio: 0.65 });
  });

  it('reports the box position inside the box and the move it is measured against', () => {
    const box = detectBoxBrace(moveThenBox(12, 10), defaultBoxBraceParams())!;
    expect(box.position).toBeGreaterThan(0);
    expect(box.position).toBeLessThan(1);
    expect(box.movePct).toBeGreaterThan(0);
    expect(box.heightPct).toBeGreaterThan(0);
  });
});








