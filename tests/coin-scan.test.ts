import { describe, expect, it } from 'vitest';
import type { Candlestick } from '../src/domain/candlestick';
import {
  backscanWindow,
  classifyStructure,
  DEFAULT_BOX_RANGE_TOLERANCE,
  DEFAULT_CONVERGENCE_FLAT_RATIO,
  DEFAULT_CONVERGENCE_LENGTH_SCALE,
  DEFAULT_CONVERGENCE_MIN_RUN,
  DEFAULT_CONVERGENCE_RATIO,
  DEFAULT_MAX_FLAT_DRIFT_RATIO,
  DEFAULT_MAX_RECENT_BARS,
  DEFAULT_MAX_STRUCTURE_SWINGS,
  DEFAULT_MIN_SPAN_TRIANGLE,
  DEFAULT_PRICE_TOLERANCE_FLOOR_RATIO,
  DEFAULT_SLOPE_TOLERANCE,
  DEFAULT_STRUCTURE_TOLERANCE,
  DEFAULT_TOUCH_MIN,
  defaultStructureParams,
  detectConvergence,
  detectSwings,
  probeStructure,
  scanTimeframes,
  STRUCTURE_SWING_N,
  type StructureParams,
  type SwingPoint,
} from '../src/domain/coin-scan';

// ---------------------------------------------------------------------------
// Synthetic candle builders
//
// A real structure must survive the full detectSwings -> classifyStructure
// pipeline inside probeStructure, so the builders lay out fractal swing points
// with enough spacing that equal-level tops/bottoms never collide in a strict
// N=2 window, and separate "filler" bars that create no swings at all.
// ---------------------------------------------------------------------------

function makeBar(index: number, low: number, high: number): Candlestick {
  return {
    instrument: 'TEST',
    timeframe: '1H',
    timestamp: index * 3600_000,
    open: (low + high) / 2,
    high,
    low,
    close: (low + high) / 2,
    volume: 100,
  };
}

/** Bars given as [low, high] pairs, timestamped by index in ascending order. */
function candles(bars: ReadonlyArray<readonly [number, number]>): Candlestick[] {
  return bars.map(([low, high], index) => makeBar(index, low, high));
}

/**
 * A horizontal box: 6 identical wide bars up front (they create no swings — all
 * highs/lows are equal, so strict fractal comparisons fail — but lift the mean
 * per-bar amplitude so the low-volatility gate passes), then 4 box tops at 113
 * and 4 box bottoms at 97 with filler bars between. Every top/bottom sits in an
 * N=2 window with no same-level neighbor, so each becomes a fractal swing point.
 */
function boxCandles(): Candlestick[] {
  const leading: Array<readonly [number, number]> = [
    [100, 200], [100, 200], [100, 200], [100, 200], [100, 200], [100, 200],
  ];
  const box: Array<readonly [number, number]> = [
    [97, 110], [102, 108], [102, 108], [102, 108],
    [102, 113], [97, 110], [102, 108], [102, 108], [102, 108],
    [102, 113], [97, 110], [102, 108], [102, 108], [102, 108],
    [102, 113], [97, 110], [102, 108], [102, 108], [102, 108],
    [102, 113], [102, 108], [102, 108], [102, 108],
  ];
  return candles([...leading, ...box]);
}

/**
 * A volatility convergence: 20 volatile wide bars (the move) followed by 8 calm,
 * flat bars (the convergence band). The volatile move dominates the window, so
 * the band is genuinely calmer than the coin's typical bar — a real 收敛.
 */
function convergenceCandles(): Candlestick[] {
  const leading: Array<readonly [number, number]> = Array.from({ length: 20 }, () => [50, 150]);
  const band: Array<readonly [number, number]> = Array.from({ length: 8 }, () => [95, 105]);
  return candles([...leading, ...band]);
}

/**
 * A symmetric triangle that is STILL converging at the last candle: swing highs
 * descend (122 -> 118 -> 114) and swing lows ascend (88 -> 92 -> 96 -> 100), each
 * on its own N=2 window. The convergence is slow enough that the apex (≈ index
 * 29) is beyond the last candle (index 24), so anchoring the trend lines at the
 * current bar (the index probeStructure injects) keeps widthCurrent > 0 — the
 * triangle is 现役, not already-resolved. Filler bars (108/110) create no swings.
 */
function triangleCandles(): Candlestick[] {
  return candles([
    [108, 110], [108, 110], [108, 110], [108, 110], [108, 110], [108, 110],
    [88, 109], [108, 110], [108, 110], [108, 110],
    [108, 122], [92, 109], [108, 110], [108, 110], [108, 110],
    [108, 118], [96, 109], [108, 110], [108, 110], [108, 110],
    [108, 114], [100, 109], [108, 110], [108, 110], [108, 110],
  ]);
}

/**
 * A parallel uptrend: both swing highs (114 -> 120 -> 126) and swing lows
 * (90 -> 96 -> 102) rise together. Neither a box (no flat edge) nor a triangle
 * (needs a falling high edge or a rising-low-with-flat-high combination), so the
 * structure classifier must reject it — a trending channel is not 蓄力.
 */
function uptrendCandles(): Candlestick[] {
  return candles([
    [108, 110], [108, 110], [108, 110], [108, 110], [108, 110], [108, 110],
    [90, 109], [108, 110], [108, 110], [108, 110],
    [108, 114], [96, 109], [108, 110], [108, 110], [108, 110],
    [108, 120], [102, 109], [108, 110], [108, 110], [108, 110],
    [108, 126], [108, 110], [108, 110], [108, 110],
  ]);
}

/**
 * Builds a SwingPoint directly, for the stateless classifier tests. `close`
 * defaults to the swing's own `price` (a bar that closes at its extreme), so
 * existing fixtures keep working; tests that exercise the unified close gate
 * pass an explicit `close` (wick bars close back inside the channel, break bars
 * close beyond their edge).
 */
function swing(index: number, price: number, kind: 'high' | 'low', close = price): SwingPoint {
  return { index, timestamp: index * 3600_000, price, kind, close };
}

const triangleSwings: SwingPoint[] = [
  swing(6, 88, 'low'),
  swing(10, 124, 'high'),
  swing(11, 94, 'low'),
  swing(15, 118, 'high'),
  swing(16, 100, 'low'),
  swing(20, 112, 'high'),
  swing(21, 106, 'low'),
];

/**
 * The synthetic triangle's swing geometry (from `triangleCandles`), kept as an
 * explicit list for the stateless classifier tests. Its apex (≈ index 29) is
 * beyond the current bar, so anchoring at currentIndex 24 keeps widthCurrent > 0.
 */
const convergingTriangleSwings: SwingPoint[] = [
  swing(6, 88, 'low'),
  swing(10, 122, 'high'),
  swing(11, 92, 'low'),
  swing(15, 118, 'high'),
  swing(16, 96, 'low'),
  swing(20, 114, 'high'),
  swing(21, 100, 'low'),
];

/**
 * Encodes the real SPCX 15m "降弹平带" pattern into synthetic candles: price
 * drops to ~108.6 (low@53), rebounds to a flat ~115 band (high@80/115), and sits
 * in that band through the current bar (index 99, price ~114.5). The swing highs
 * are flat (115.9/112/115.2/115) while the swing lows rebound from 108.6 up to
 * 113.8 with slope ≈ 0.15/bar — exactly the geometry that old logic misread as an
 * "上升三角". Extrapolated to the current bar, the rising low line crosses the
 * flat high line, so the structure is resolved and must be rejected.
 *
 * Every segment between anchors is monotonic and the band bars (88..99) are
 * equal, so detectSwings at every candidate N produces exactly these 8 anchors.
 */
function spcxCandles(): Candlestick[] {
  const bars: Array<readonly [number, number]> = [];
  // Lead-in monotonic decline (creates no swings): bars 0..44, center 117 -> 114.5.
  for (let i = 0; i <= 44; i += 1) {
    const center = 117 - (i * 2.5) / 44;
    bars.push([center - 0.8, center + 0.8]);
  }
  bars.push([114.2, 115.9]); // 45: swing high 115.9
  // 46..52 decline center 114.2 -> 109.6 (low@53 needs bar 52 low > 108.6).
  for (let i = 46; i <= 52; i += 1) {
    const t = (i - 46) / 6;
    const center = 114.2 - t * (114.2 - 109.6);
    bars.push([center - 0.8, center + 0.8]);
  }
  bars.push([108.6, 109.6]); // 53: swing low 108.6
  bars.push([109.0, 110.6]); // 54
  bars.push([110.0, 111.6]); // 55
  bars.push([110.2, 111.8]); // 56 (high < 112 keeps high@57 strict)
  bars.push([110.6, 112.0]); // 57: swing high 112
  bars.push([110.0, 111.6]); // 58
  bars.push([109.8, 111.4]); // 59 (low > 109.6 keeps low@60 strict)
  bars.push([109.6, 110.6]); // 60: swing low 109.6
  bars.push([110.2, 111.8]); // 61 (high < 112 keeps high@57 strict)
  bars.push([110.8, 112.4]); // 62
  bars.push([111.4, 113.0]); // 63
  bars.push([112.0, 113.6]); // 64
  bars.push([112.6, 114.2]); // 65
  bars.push([113.0, 114.6]); // 66
  bars.push([113.4, 115.0]); // 67
  bars.push([114.0, 115.2]); // 68: swing high 115.2
  bars.push([113.7, 115.0]); // 69 (low > 113.6 keeps low@73 strict)
  bars.push([113.65, 114.8]); // 70
  bars.push([113.62, 114.6]); // 71
  bars.push([113.62, 114.5]); // 72
  bars.push([113.6, 114.2]); // 73: swing low 113.6
  bars.push([113.7, 114.4]); // 74
  bars.push([113.85, 114.5]); // 75
  bars.push([114.0, 114.6]); // 76
  bars.push([114.0, 114.6]); // 77
  bars.push([114.1, 114.65]); // 78
  bars.push([114.2, 114.7]); // 79
  bars.push([114.4, 115.0]); // 80: swing high 115.0
  bars.push([113.9, 114.8]); // 81 (low > 113.8 keeps low@87 strict)
  bars.push([113.85, 114.7]); // 82
  bars.push([113.82, 114.6]); // 83
  bars.push([113.82, 114.6]); // 84
  bars.push([113.82, 114.6]); // 85
  bars.push([113.82, 114.6]); // 86
  bars.push([113.8, 114.3]); // 87: swing low 113.8
  // 88..99: flat 114.4..114.6 band (equal bars create no swings), lastPrice ≈ 114.5.
  for (let i = 88; i <= 99; i += 1) bars.push([114.4, 114.6]);
  return candles(bars);
}

describe('detectSwings (single-N fractal)', () => {
  it('detects the exact swing points of a known box layout at N=2', () => {
    const swings = detectSwings(boxCandles(), 2);
    expect(swings.map((point) => [point.index, point.price, point.kind])).toEqual([
      [6, 97, 'low'],
      [10, 113, 'high'],
      [11, 97, 'low'],
      [15, 113, 'high'],
      [16, 97, 'low'],
      [20, 113, 'high'],
      [21, 97, 'low'],
      [25, 113, 'high'],
    ]);
  });

  it('returns an empty array with fewer than 2n + 1 bars', () => {
    expect(detectSwings(boxCandles().slice(0, 4), 2)).toEqual([]);
    expect(detectSwings(boxCandles().slice(0, 9), 3)).toEqual([]); // 9 < 2*3+1
  });

  it('does not mutate the input and sorts internally', () => {
    const original = boxCandles();
    const snapshot = original.map((candle) => candle.timestamp);
    const reversed = [...original].reverse();
    // Unordered input still resolves to the same fractal points (pure + deterministic).
    const fromReversed = detectSwings(reversed, 2);
    const fromOriginal = detectSwings(original, 2);
    expect(fromReversed).toEqual(fromOriginal);
    expect(original.map((candle) => candle.timestamp)).toEqual(snapshot);
    expect(reversed.map((candle) => candle.timestamp)).toEqual([...snapshot].reverse());
  });

  it('collapses consecutive same-direction swings to the more extreme point', () => {
    // Bar 2 is both a swing high (120) and a swing low (92); bar 5 is a lower
    // swing low (90). The raw scan produces low@2 then low@5 consecutively, and
    // the dedup keeps only the more extreme low — so the low reports at index 5.
    const bars = candles([
      [100, 110], [100, 110], [92, 120], [96, 111], [94, 114], [90, 113],
      [100, 110], [100, 110], [100, 110],
    ]);
    expect(detectSwings(bars, 2)).toEqual([
      { index: 2, timestamp: 2 * 3600_000, price: 120, kind: 'high', close: 106 },
      { index: 5, timestamp: 5 * 3600_000, price: 90, kind: 'low', close: 101.5 },
    ]);
  });

  it('returns an empty array when a price is non-positive', () => {
    const bars = boxCandles();
    bars[3] = { ...bars[3], low: 0, high: 0 };
    expect(detectSwings(bars, 2)).toEqual([]);
  });
});

describe('classifyStructure (swing geometry)', () => {
  const params = defaultStructureParams({ lastPrice: 105 });

  it('detects a flat calm band as a convergence (AC2)', () => {
    // convergenceCandles: 20 volatile bars then 8 flat calm bars. The recent band
    // is both flatter and calmer than the move before it (and calmer than the
    // coin's typical bar) → a convergence.
    const result = detectConvergence(convergenceCandles(), params);
    expect(result).not.toBeNull();
    expect(result!.structure).toBe('convergence');
    expect(result!.score).toBeGreaterThanOrEqual(0.7);
    expect(result!.qualified).toBe(true);
  });

  it('rejects a band whose volatility is unchanged from the preceding move', () => {
    // A flat band preceded by an EQUALLY calm band (no volatility drop) is not a
    // convergence — a quiet coin being quiet has no 蓄力 tension. Build candles:
    // 10 calm bars, then 10 equally calm bars → the recent band is not calmer.
    const calm: Array<readonly [number, number]> = Array.from({ length: 20 }, () => [49, 51]);
    expect(detectConvergence(candles(calm), params)).toBeNull();
  });

  it('rejects a rising-low band (a triangle, not a convergence)', () => {
    // 5 flat pre-bars, then 5 bars whose lows step up 100 → 108 while highs stay
    // flat: a rising triangle, not a flat convergence band. The adaptive flatness
    // gate must reject the recent rising band.
    const rising: Array<readonly [number, number]> = [
      [100, 110], [100, 110], [100, 110], [100, 110], [100, 110],
      [100, 113], [102, 113], [104, 113], [106, 113], [108, 113],
    ];
    expect(detectConvergence(candles(rising), params)).toBeNull();
  });

  it('classifies a symmetric triangle (falling highs + rising lows) (AC1)', () => {
    const result = classifyStructure(triangleSwings, { ...params, lastPrice: 109 });
    expect(result).not.toBeNull();
    expect(result!.structure).toBe('triangle');
    expect(result!.position).toBeGreaterThan(0);
    expect(result!.position).toBeLessThan(1);
    expect(result!.touchCount).toBe(7);
    expect(result!.qualified).toBe(true);
  });

  it('classifies a rising triangle (flat highs + rising lows) (AC1)', () => {
    const rising = [
      swing(6, 88, 'low'),
      swing(10, 113, 'high'),
      swing(11, 94, 'low'),
      swing(15, 113, 'high'),
      swing(16, 100, 'low'),
      swing(20, 113, 'high'),
      swing(21, 106, 'low'),
    ];
    const result = classifyStructure(rising, { ...params, lastPrice: 109 });
    expect(result).not.toBeNull();
    expect(result!.structure).toBe('triangle');
    expect(result!.qualified).toBe(true);
  });

  it('still classifies a genuine MRVL-style rising triangle with a flat-high edge when priorAmplitude is supplied (regression)', () => {
    // MRVL 15m 真三角(实盘验证过 score 0.93):highs 平 ~215(211.15/214.38/215/219.73
    // spread 很小),lows 抬升。flat-high 边的 net drift 相对 priorAmplitude(0.03)
    // 必须远小于 maxFlatDriftRatio 1.0 —— 真三角不能被新的相对振幅门误杀。
    // close 落在通道内(真三角的 swing bar close 应落在楔形内,不触发 close 门):
    // 219.73 尖峰 bar 的收盘收回通道内(212),是毛刺而非破位。
    const mrvlRising = [
      swing(23, 210.02, 'high', 211),
      swing(31, 202.13, 'low', 205),
      swing(35, 219.73, 'high', 212), // 尖峰 bar 收盘收回通道内
      swing(58, 208.55, 'low', 209.5),
      swing(73, 215.0, 'high', 213.5),
      swing(79, 211.15, 'low', 211.5),
      swing(85, 214.38, 'high', 214),
      swing(92, 211.88, 'low', 212.5),
    ];
    const result = classifyStructure(mrvlRising, { ...params, lastPrice: 215.62, priorAmplitude: 0.03, currentIndex: 98 });
    expect(result).not.toBeNull();
    expect(result!.structure).toBe('triangle');
    expect(result!.qualified).toBe(true);
  });

  it('classifies a falling triangle (falling highs + flat lows) (AC1)', () => {
    const falling = [
      swing(6, 97, 'low'),
      swing(10, 124, 'high'),
      swing(11, 97, 'low'),
      swing(15, 118, 'high'),
      swing(16, 97, 'low'),
      swing(20, 112, 'high'),
      swing(21, 97, 'low'),
    ];
    const result = classifyStructure(falling, { ...params, lastPrice: 109 });
    expect(result).not.toBeNull();
    expect(result!.structure).toBe('triangle');
    expect(result!.qualified).toBe(true);
  });

  it('rejects the XRP 1H slow-decline pattern — a flat edge must not drift more than one own-amplitude (regression)', () => {
    // XRP 1H 实盘误判:lows 持续缓降 [1.0388, 1.0410, 1.0317, 1.0292],highs 缓降
    // [1.0582, 1.0540, 1.0371, 1.0389]。lows 的 net drift 0.9% < slopeTolerance 2%
    // (相对 mean price 判定为平),但相对其自身振幅(priorAmplitude 0.0056)是
    // 0.9%/0.56% = 1.6× —— 明显趋势,不是平边。此前误判成 falling 三角 score 0.90。
    // 新 gate:flat 边 drift 相对 priorAmplitude 不得超 maxFlatDriftRatio(1.0)。
    const xrp = [
      swing(30, 1.0388, 'low'),
      swing(32, 1.0582, 'high'),
      swing(33, 1.0410, 'low'),
      swing(35, 1.0540, 'high'),
      swing(37, 1.0317, 'low'),
      swing(38, 1.0371, 'high'),
      swing(39, 1.0292, 'low'),
      swing(40, 1.0389, 'high'),
    ];
    expect(classifyStructure(xrp, { ...params, lastPrice: 1.0256, priorAmplitude: 0.0056, currentIndex: 45 })).toBeNull();
  });

  it('rejects a downtrend continuation (both edges falling) — no convergence structure', () => {
    const downtrend = [
      swing(6, 106, 'low'),
      swing(10, 124, 'high'),
      swing(11, 100, 'low'),
      swing(15, 118, 'high'),
      swing(16, 94, 'low'),
      swing(20, 112, 'high'),
      swing(21, 88, 'low'),
    ];
    expect(classifyStructure(downtrend, params)).toBeNull();
  });

  it('rejects a triangle whose trend lines have already crossed (widthEnd <= 0)', () => {
    // Falling highs + rising lows that keep going past the apex: at the current
    // bar the high line is BELOW the low line (width <= 0). That is an
    // already-resolved/已突破 pattern, not 蓄力待突破, so it must not classify.
    const crossed = [
      swing(0, 80, 'low'),
      swing(1, 120, 'high'),
      swing(2, 90, 'low'),
      swing(3, 110, 'high'),
      swing(4, 100, 'low'),
      swing(5, 100, 'high'),
      swing(6, 110, 'low'),
      swing(7, 90, 'high'),
    ];
    expect(classifyStructure(crossed, { ...params, lastPrice: 100 })).toBeNull();
  });

  it('rejects the SPCX 降弹平带 pattern once anchored to the current bar (regression)', () => {
    // Flat highs ~115 with lows rebounding from 108.6 up to 113.8 (slope ≈
    // 0.15/bar). Extrapolated to the current bar (index 99), the rising low line
    // crosses the flat high line → widthCurrent < 0 → already resolved, not 蓄力.
    const spcx = [
      swing(45, 115.9, 'high'),
      swing(53, 108.6, 'low'),
      swing(57, 112, 'high'),
      swing(60, 109.6, 'low'),
      swing(68, 115.2, 'high'),
      swing(73, 113.6, 'low'),
      swing(80, 115, 'high'),
      swing(87, 113.8, 'low'),
    ];
    const result = classifyStructure(spcx, { ...params, lastPrice: 114.5, currentIndex: 99 });
    expect(result).toBeNull();
  });

  it('rejects the HEI 5m deep-low-dip pattern (regression)', () => {
    // Real HEI 5m swings (N=2): highs ~0.21 are roughly flat/descending, but the
    // lows have a deep-fall spike — 0.1969 → 0.1816 (-7.8%) — whose bar CLOSES at
    // its low (0.1818). The close pokes below the low edge by more than
    // structureTolerance × channel width, so the unified close gate (replacing the
    // old percentage monotonicity gate) rejects this noisy 乱震 as 蓄力.
    const hei = [
      swing(0, 0.2136, 'high', 0.2120),
      swing(2, 0.1950, 'low', 0.1955),
      swing(4, 0.2108, 'high', 0.2095),
      swing(6, 0.1969, 'low', 0.1975),
      swing(8, 0.2125, 'high', 0.2095),
      swing(10, 0.1816, 'low', 0.1818), // deep-fall bar closes at its low → close gate fires
      swing(12, 0.2038, 'high', 0.2025),
      swing(14, 0.1957, 'low', 0.1965),
    ];
    expect(classifyStructure(hei, { ...params, lastPrice: 0.199 })).toBeNull();
  });

  it('rejects the HEI 5m flat-low-edge spread via the triangle range gate (regression)', () => {
    // The exact real HEI 5m swing layout (N=2) that slipped past the regression
    // slope: lows [0.1950, 0.1969, 0.1816, 0.1957] regress to ~0 drift (lowDrift
    // 0.013 <= slopeTolerance → lowFlat), so the falling-triangle branch is
    // entered. The deep spike's bar closes back inside the channel (0.1910), so
    // the unified close gate does NOT fire — the flat-edge RANGE gate is what
    // rejects: the 0.1816 深跌毛刺 gives the edge a max-min spread of 8%, and a
    // regression line "averaged flat" by an outlier is not a flat edge.
    const hei = [
      swing(79, 0.1950, 'low', 0.1955),
      swing(80, 0.2108, 'high', 0.2090),
      swing(82, 0.1969, 'low', 0.1975),
      swing(84, 0.2125, 'high', 0.2110),
      swing(88, 0.1816, 'low', 0.1910), // deep spike closes back inside → range gate decides
      swing(95, 0.2038, 'high', 0.2020),
      swing(96, 0.1957, 'low', 0.1965),
      swing(97, 0.2064, 'high', 0.2050),
    ];
    expect(classifyStructure(hei, { ...params, lastPrice: 0.199, currentIndex: 97 })).toBeNull();
  });

  it('still classifies a genuine falling triangle (truly flat lows within range)', () => {
    // lows [0.100, 0.101, 0.099, 0.100] regress flat AND their max-min spread is
    // 2% — a real flat low edge. Falling highs (0.130 -> 0.124 -> 0.118) with a
    // still-converging apex (widthCurrent > 0 at currentIndex 24) must classify.
    const falling = [
      swing(6, 0.100, 'low'),
      swing(10, 0.130, 'high'),
      swing(11, 0.101, 'low'),
      swing(15, 0.124, 'high'),
      swing(16, 0.099, 'low'),
      swing(20, 0.118, 'high'),
      swing(21, 0.100, 'low'),
    ];
    const result = classifyStructure(falling, { ...params, lastPrice: 0.106, currentIndex: 24 });
    expect(result).not.toBeNull();
    expect(result!.structure).toBe('triangle');
    expect(result!.qualified).toBe(true);
  });

  it('still classifies a genuine rising triangle (truly flat highs within range)', () => {
    // highs [0.113, 0.112, 0.113] regress flat AND their max-min spread is ~1% —
    // a real flat high edge. Rising lows (0.080 -> 0.084 -> 0.090 -> 0.096) with
    // a still-converging apex must classify.
    const rising = [
      swing(6, 0.080, 'low'),
      swing(10, 0.113, 'high'),
      swing(11, 0.084, 'low'),
      swing(15, 0.112, 'high'),
      swing(16, 0.090, 'low'),
      swing(20, 0.113, 'high'),
      swing(21, 0.096, 'low'),
    ];
    const result = classifyStructure(rising, { ...params, lastPrice: 0.106, currentIndex: 24 });
    expect(result).not.toBeNull();
    expect(result!.structure).toBe('triangle');
    expect(result!.qualified).toBe(true);
  });

  it('passes a near-apex triangle whose price sits within one bar of the lower edge (floor regression)', () => {
    // convergingTriangleSwings (apex ≈ index 29) anchored at currentIndex 28 keeps
    // widthCurrent ≈ 2.0 > 0. The current price sits BELOW the lower edge by 2.2 —
    // far beyond the old tolerance 0.1 × width (0.2), so the old price-inside gate
    // rejected this still-forming triangle as "already-resolved". The tolerance
    // floor (1.0 × priorAmplitude × lastPrice) keeps the 蓄力 verdict: a genuine
    // MU-style near-apex triangle must not die on a sub-bar wiggle.
    const p = { ...params, lastPrice: 103.4, priorAmplitude: 0.05, currentIndex: 28 };
    const result = classifyStructure(convergingTriangleSwings, p);
    expect(result).not.toBeNull();
    expect(result!.structure).toBe('triangle');
  });

  it('still rejects a near-apex triangle when the price is beyond the tolerance floor (real break)', () => {
    // Same geometry, but the price is 7.6 below the lower edge — more than one
    // average bar (floor = 0.05 × 98 = 4.9). A genuine breakdown stays rejected.
    const p = { ...params, lastPrice: 98, priorAmplitude: 0.05, currentIndex: 28 };
    expect(classifyStructure(convergingTriangleSwings, p)).toBeNull();
  });

  it('keeps the old width-only tolerance when priorAmplitude is absent', () => {
    // No candle context (priorAmplitude absent) → the floor is skipped → the same
    // price the floored tolerance would accept is rejected by 0.1 × width. Backward
    // compatible with direct unit-test calls that carry no candle data.
    const p = { ...params, lastPrice: 103.4, currentIndex: 28 };
    expect(classifyStructure(convergingTriangleSwings, p)).toBeNull();
  });

  it('boundary: a flat edge spread of exactly 5% passes, just above 5% is rejected', () => {
    // Identical falling triangles except the flat low edge's spread: the first has
    // lows [97.5, 102.5, 102.5, 97.5] (symmetric around 100 → regression slope 0,
    // spread exactly 5%) and must pass; the second uses 97.4/102.6 (spread 5.2% >
    // DEFAULT_BOX_RANGE_TOLERANCE 5%) and the range gate alone must reject it —
    // every other swing is identical.
    const atLimit = [
      swing(6, 97.5, 'low'),
      swing(10, 130, 'high'),
      swing(11, 102.5, 'low'),
      swing(15, 124, 'high'),
      swing(16, 102.5, 'low'),
      swing(20, 118, 'high'),
      swing(21, 97.5, 'low'),
    ];
    const overLimit = [
      swing(6, 97.4, 'low'),
      swing(10, 130, 'high'),
      swing(11, 102.6, 'low'),
      swing(15, 124, 'high'),
      swing(16, 102.6, 'low'),
      swing(20, 118, 'high'),
      swing(21, 97.4, 'low'),
    ];
    const boundaryParams = { ...params, lastPrice: 108, currentIndex: 24 };
    const atResult = classifyStructure(atLimit, boundaryParams);
    expect(atResult).not.toBeNull();
    expect(atResult!.structure).toBe('triangle');
    expect(classifyStructure(overLimit, boundaryParams)).toBeNull();
  });

  it('rejects the HFT 15m crash-rebound-narrow pattern via the close gate (regression)', () => {
    // Real HFT 15m: a violent 崩拉 (high@100 → crash low@40 → rebound high@95)
    // then a suddenly narrow 收窄 band (highs 90/93, lows 78/80). The crash low's
    // bar closes at its low (40) — a swing whose CLOSE pokes below the (outlier-
    // pulled) low edge by more than structureTolerance × width. 崩后平静 is not
    // 蓄力, so the unified close gate rejects it (the old monotonicity gate no
    // longer exists — a single candle is enough when its close breaks the edge).
    const hft = [
      swing(0, 100, 'high', 98),
      swing(4, 40, 'low', 40), // crash bar closes at its low → close gate
      swing(8, 95, 'high', 93),
      swing(12, 75, 'low', 76),
      swing(16, 90, 'high', 91),
      swing(20, 80, 'low', 79),
      swing(24, 93, 'high', 92),
      swing(28, 78, 'low', 79),
    ];
    expect(classifyStructure(hft, { ...params, lastPrice: 88, currentIndex: 28 })).toBeNull();
  });

  it('lets a rising low pull back inside the channel and still be a triangle (wick)', () => {
    // convergingTriangleSwings lows (88 → 92 → 96 → 100) with a 1% pullback on
    // the third low (92 → 91). The pullback bar's CLOSE (91) stays inside the
    // channel — it does not poke below the low edge by more than tolerance ×
    // width — so the unified close gate treats it as a wick 毛刺, not a break.
    // The structure must still classify.
    const microPullback = [
      swing(6, 88, 'low'),
      swing(10, 122, 'high'),
      swing(11, 92, 'low'),
      swing(15, 118, 'high'),
      swing(16, 91, 'low'), // -1.1% pullback; close stays inside the wedge
      swing(20, 114, 'high'),
      swing(21, 100, 'low'),
    ];
    const result = classifyStructure(microPullback, { ...params, lastPrice: 109, currentIndex: 24 });
    expect(result).not.toBeNull();
    expect(result!.structure).toBe('triangle');
  });

  it('rejects a rising low whose bar close breaks through the low edge (close gate)', () => {
    // Same shape but the third low collapses to 84.5 (92 → 84.5 = -8.2%). Its
    // bar closes at its low (85), poking below the low edge by more than
    // structureTolerance × width — a genuine 破位, not a wick. The regression
    // could still fit a positive slope, but the unified close gate rejects it.
    const obviousBreak = [
      swing(6, 88, 'low', 89),
      swing(10, 122, 'high', 121),
      swing(11, 92, 'low', 93),
      swing(15, 118, 'high', 117),
      swing(16, 84.5, 'low', 85), // -8.2% deep-fall bar closes at its low → close gate
      swing(20, 114, 'high', 115),
      swing(21, 100, 'low', 101),
    ];
    expect(classifyStructure(obviousBreak, { ...params, lastPrice: 109, currentIndex: 24 })).toBeNull();
  });

  it('rejects a triangle whose trend lines cross at the current bar (anchored)', () => {
    // A genuine converging triangle geometry (triangleSwings, apex ≈ 23) pushed
    // past its apex: at currentIndex 30 the high line is below the low line →
    // widthCurrent <= 0 → already-resolved. The fallback-to-last-swing behavior
    // still passes, but the probe always injects the current bar.
    expect(classifyStructure(triangleSwings, { ...params, lastPrice: 109, currentIndex: 30 })).toBeNull();
  });

  it('rejects a triangle whose last swing is stale (> maxRecentBars from current bar)', () => {
    // triangleSwings' last swing is at index 21; currentIndex 40 puts it 19 bars
    // behind — an old, already-resolved shape. The trend lines might still widen
    // (fallback geometry) but the structure is not 现役.
    expect(classifyStructure(triangleSwings, { ...params, lastPrice: 109, currentIndex: 40 })).toBeNull();
  });

  it('does not saturate the score for a genuinely converging triangle anchored at the current bar', () => {
    // convergingTriangleSwings is still converging at currentIndex 24 (apex ≈
    // 29), so the convergence contribution uses the CURRENT width (8.4) rather
    // than the near-zero width at the last swing — score stays well below 1.0.
    const result = classifyStructure(convergingTriangleSwings, { ...params, lastPrice: 109, currentIndex: 24 });
    expect(result).not.toBeNull();
    expect(result!.structure).toBe('triangle');
    expect(result!.score).toBeLessThan(0.95);
    expect(result!.score).toBeGreaterThan(0.5);
  });

  it('returns null when an edge has fewer than touchMin touches', () => {
    const singleHigh = [
      swing(6, 97, 'low'),
      swing(10, 113, 'high'),
      swing(11, 97, 'low'),
      swing(16, 97, 'low'),
    ];
    expect(classifyStructure(singleHigh, params)).toBeNull(); // 1 high < touchMin 2

    // A rising triangle with 2 flat highs + 4 rising lows: a raised touchMin
    // rejects it (2 highs < 3) while the default 2 accepts it.
    const twoHighs = [
      swing(6, 90, 'low'),
      swing(10, 113, 'high'),
      swing(11, 94, 'low'),
      swing(16, 98, 'low'),
      swing(20, 113, 'high'),
      swing(21, 102, 'low'),
    ];
    expect(classifyStructure(twoHighs, { ...params, lastPrice: 109, currentIndex: 24, touchMin: 3 })).toBeNull();
    expect(classifyStructure(twoHighs, { ...params, lastPrice: 109, currentIndex: 24, touchMin: 2 })).not.toBeNull();
  });

  it('returns null with fewer than 4 swings', () => {
    expect(classifyStructure([swing(6, 97, 'low'), swing(10, 113, 'high'), swing(16, 97, 'low')], params)).toBeNull();
  });
});

describe('backscanWindow (backward structure boundary)', () => {
  const params = defaultStructureParams({ lastPrice: 105 });

  it('finds the continuous triangle segment starting after a breaking swing', () => {
    // The newest 7 swings are a genuine converging triangle (lows 88 → 100
    // rising, highs 122 → 114 falling, apex beyond currentIndex 30). An earlier
    // low@6 crashes to 80 and closes at 70 — well below the extrapolated low edge
    // by more than tolerance × width. backscanWindow must terminate there and
    // return the triangle, not the crash.
    const sequence = [
      swing(6, 80, 'low', 70), // breaking swing: close pokes through the low edge
      swing(10, 88, 'low'),
      swing(14, 122, 'high'),
      swing(15, 92, 'low'),
      swing(19, 118, 'high'),
      swing(20, 96, 'low'),
      swing(24, 114, 'high'),
      swing(25, 100, 'low'),
    ];
    const segment = backscanWindow(sequence, [], { ...params, currentIndex: 30 });
    expect(segment).not.toBeNull();
    expect(segment![0].index).toBe(10);
    expect(segment!.some((sw) => sw.index === 6)).toBe(false);
    const result = classifyStructure(segment!, { ...params, lastPrice: 109, currentIndex: 30 });
    expect(result).not.toBeNull();
    expect(result!.structure).toBe('triangle');
  });

  it('rejects a structure whose formation span is below the B gate', () => {
    // A tight 4-bar triangle: lows 100 → 102 → 104, highs 112 → 110 across span 4
    // — far below minSpanTriangle 13. The geometry is triangular but the formation
    // is too short to be a genuine 蓄力 structure.
    const shortTriangle = [
      swing(10, 100, 'low'),
      swing(11, 112, 'high'),
      swing(12, 102, 'low'),
      swing(13, 110, 'high'),
      swing(14, 104, 'low'),
    ];
    expect(classifyStructure(shortTriangle, { ...params, lastPrice: 107, currentIndex: 20 })).toBeNull();
  });
});

describe('probeStructure (probe-type N scan over real candles)', () => {
  it('detects a flat calm band as a convergence through the full pipeline (AC2)', () => {
    // convergenceCandles: 20 volatile bars then 8 flat calm bars → the volatility
    // convergence surfaces through the full probe.
    const result = probeStructure(convergenceCandles(), defaultStructureParams());
    expect(result).not.toBeNull();
    expect(result!.structure).toBe('convergence');
    expect(result!.score).toBeGreaterThanOrEqual(0.7);
    expect(result!.qualified).toBe(true);
  });

  it('detects a symmetric triangle through the full pipeline (AC1)', () => {
    const result = probeStructure(triangleCandles(), defaultStructureParams());
    expect(result).not.toBeNull();
    expect(result!.structure).toBe('triangle');
    // Anchored at the current bar (index 24), the convergence score reflects the
    // width that REMAINS at the current bar — not the near-zero width at the last
    // swing — so it does not saturate at ~1.0.
    expect(result!.score).toBeCloseTo(0.825, 2);
    expect(result!.score).toBeLessThan(0.95);
    expect(result!.touchCount).toBe(7);
    expect(result!.qualified).toBe(true);
  });

  it('returns null when no candidate N yields a structure (trending channel)', () => {
    expect(probeStructure(uptrendCandles(), defaultStructureParams())).toBeNull();
  });

  it('reads the SPCX 降弹平带 rebound band as a convergence (regression)', () => {
    // Real-data case: a drop to ~108 then a rebound into a flat ~115 band. The
    // swing geometry (flat highs + rebounding lows) is NOT a valid 上升三角 — the
    // rising low line crosses the flat high line at the current bar, so the
    // triangle reading is rejected. The flat ~115 band is however a genuine
    // convergence: calmer than the preceding rebound, so the band surfaces.
    const result = probeStructure(spcxCandles(), defaultStructureParams());
    expect(result).not.toBeNull();
    expect(result!.structure).toBe('convergence');
    expect(result!.score).toBeGreaterThanOrEqual(0.7);
  });

  it('returns null with fewer than 4 candles or a non-positive price', () => {
    expect(probeStructure(boxCandles().slice(0, 3), defaultStructureParams())).toBeNull();
    const bars = boxCandles();
    bars[2] = { ...bars[2], low: 0, high: 0 };
    expect(probeStructure(bars, defaultStructureParams())).toBeNull();
  });
});

describe('Coin Scan structure defaults and types', () => {
  it('exposes the probe swing candidate set', () => {
    expect(STRUCTURE_SWING_N).toEqual([2, 3, 4, 5, 6, 8, 10, 12]);
    expect(scanTimeframes).toEqual(['5m', '15m', '1H', '4H', '1D']);
  });

  it('exposes the calibrated classification constants', () => {
    expect(DEFAULT_SLOPE_TOLERANCE).toBe(0.02);
    expect(DEFAULT_TOUCH_MIN).toBe(2);
    expect(DEFAULT_MAX_STRUCTURE_SWINGS).toBe(8);
    expect(DEFAULT_MAX_RECENT_BARS).toBe(12);
    expect(DEFAULT_BOX_RANGE_TOLERANCE).toBe(0.05);
    expect(DEFAULT_MAX_FLAT_DRIFT_RATIO).toBe(1);
    expect(DEFAULT_MIN_SPAN_TRIANGLE).toBe(13);
    expect(DEFAULT_STRUCTURE_TOLERANCE).toBe(0.2);
    expect(DEFAULT_PRICE_TOLERANCE_FLOOR_RATIO).toBe(1);
    expect(DEFAULT_CONVERGENCE_MIN_RUN).toBe(5);
    expect(DEFAULT_CONVERGENCE_FLAT_RATIO).toBe(1.2);
    expect(DEFAULT_CONVERGENCE_RATIO).toBe(0.8);
    expect(DEFAULT_CONVERGENCE_LENGTH_SCALE).toBe(16);
  });

  it('defaultStructureParams fills every threshold from the file-top defaults', () => {
    const params = defaultStructureParams();
    const expected: StructureParams = {
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
    };
    expect(params).toEqual(expected);
    expect(defaultStructureParams({ touchMin: 3 }).touchMin).toBe(3);
  });
});
