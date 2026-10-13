import { describe, expect, it } from 'vitest';
import type { Candlestick } from '../src/domain/candlestick';
import {
  COARSE_TIMEFRAME,
  DEFAULT_COARSE_PARAMS,
  coarseScreen,
  coarseStructure,
  defaultStructureParams,
  detectConvergence,
  scanTimeframes,
} from '../src/domain/coin-scan';
import { COARSE_SCREEN_PCT_NET, COARSE_SCREEN_PCT_RANGE, COARSE_SCREEN_WINDOW_DAYS } from '../src/domain/scan-scope';

/** Builds 1D candles from `[low, high]` bars, close = midpoint, ascending timestamps. */
function dailyBars(bars: ReadonlyArray<readonly [number, number]>): Candlestick[] {
  const step = 86_400_000;
  return bars.map(([low, high], index) => ({
    instrument: 'TEST',
    timeframe: '1D' as const,
    timestamp: index * step,
    open: (low + high) / 2,
    high,
    low,
    close: (low + high) / 2,
    volume: 100,
  }));
}

const flatBar = [99, 101] as const;
const wildBar = [50, 100] as const;

describe('coarseStructure (1D 粗筛的度量)', () => {
  it('measures range and net drift over exactly the newest `windowDays` bars', () => {
    // 7 wild bars, then 23 calm ones. At T = 23 the wild lead is outside the
    // window, so the measured range is the calm band's 2/100 = 0.02 — proof the
    // window is a fixed lookback and not "the whole series".
    const candles = dailyBars([...Array.from({ length: 7 }, () => wildBar), ...Array.from({ length: 23 }, () => flatBar)]);

    const windowed = coarseStructure(candles, { windowDays: 23 });
    expect(windowed).not.toBeNull();
    expect(windowed!.rangePct).toBeCloseTo(0.02, 10);
    expect(windowed!.netPct).toBeCloseTo(0, 10);

    // Widening the window to 30 pulls the wild lead in — the measures must move.
    const widened = coarseStructure(candles, { windowDays: 30 });
    expect(widened!.rangePct).toBeCloseTo(0.51, 10);
  });

  it('defaults to the calibrated T and is insensitive to candle order', () => {
    const candles = dailyBars([
      ...Array.from({ length: 30 }, () => wildBar),
      ...Array.from({ length: 23 }, () => flatBar),
    ]);
    const ordered = coarseStructure(candles);
    const shuffled = coarseStructure([...candles].reverse());

    expect(DEFAULT_COARSE_PARAMS.windowDays).toBe(COARSE_SCREEN_WINDOW_DAYS);
    expect(ordered).toEqual(shuffled);
    expect(ordered!.rangePct).toBeCloseTo(0.02, 10);
  });

  it('treats the drift as direction-free (same |Δ| rising and falling)', () => {
    const rising = coarseStructure(dailyBars(Array.from({ length: 23 }, (_, i) => [100 + i, 102 + i] as const)));
    const falling = coarseStructure(dailyBars(Array.from({ length: 23 }, (_, i) => [100 - i, 102 - i] as const)));

    // netPct is normalized by the window's FIRST close, which the two fixtures
    // share, so the direction cancels out entirely.
    expect(rising!.netPct).toBeCloseTo(22 / 101, 10);
    expect(falling!.netPct).toBeCloseTo(rising!.netPct, 10);
    // rangePct is normalized by the LAST close, so the falling window reads wider.
    // Deliberate: the band is measured against the CURRENT price.
    expect(falling!.rangePct).toBeGreaterThan(rising!.rangePct);
  });

  it('returns null for a window it cannot measure at all (次新币 / bad prices)', () => {
    // A coin listed for 10 days: fewer bars than T. It has no place in the
    // percentile base and can never pass the screen.
    expect(coarseStructure(dailyBars(Array.from({ length: 10 }, () => flatBar)))).toBeNull();
    expect(coarseStructure([])).toBeNull();
    expect(coarseStructure(dailyBars(Array.from({ length: 23 }, () => [0, 100] as const)))).toBeNull();
    expect(coarseStructure(dailyBars([...Array.from({ length: 22 }, () => flatBar), [99, NaN] as const]))).toBeNull();
  });

  it('does not touch the convergence detector (separate pure measure, separate contract)', () => {
    // Same uniformly calm series: the coarse measure is happy (narrow range, no
    // drift) while `detectConvergence` finds nothing — no shrinkage anywhere.
    // The 1D screen is deliberately WIDE, so it must not inherit the detector's
    // "越来越小" requirement.
    const calm = dailyBars(Array.from({ length: 40 }, () => flatBar));
    expect(coarseStructure(calm)).not.toBeNull();
    expect(detectConvergence(calm, defaultStructureParams())).toBeNull();
  });
});

/** `n` measures built from one `range`/`net` pair, so the pool shape is explicit. */
function measures(pairs: ReadonlyArray<readonly [number, number]>) {
  return pairs.map(([rangePct, netPct]) => ({ rangePct, netPct }));
}

describe('coarseScreen (池内相对分位)', () => {
  it('keeps only the pool fraction below BOTH cuts, recomputed from that pool', () => {
    // 20 names: 2 tight ones, 18 progressively wider (ranks 1..20 on BOTH axes).
    // The rank cuts are floor(0.7371·20) = 14 (range) and floor(0.4849·20) = 9
    // (net), so the pass set is `range ≤ 14 AND net ≤ 9` — the two tight ones plus
    // the seven narrowest of the rest. A deliberately WIDE screen: the precision
    // is the small-timeframe stage's job, not this one's.
    const pool = measures([
      [0.02, 0.0],
      [0.05, 0.01],
      ...Array.from({ length: 18 }, (_, i) => [0.5 + i * 0.01, 0.4 + i * 0.01] as const),
    ]);
    const { screen, passes } = coarseScreen(pool);

    expect(pool).toHaveLength(20);
    expect(screen.poolSize).toBe(20);
    expect(screen.rangePctRank).toBe(14);
    expect(screen.netPctRank).toBe(9);
    expect(passes.filter(Boolean)).toHaveLength(9);
    expect(passes.slice(0, 9)).toEqual(Array.from({ length: 9 }, () => true));
    expect(passes.slice(9)).toEqual(Array.from({ length: 11 }, () => false));
    // The cuts are the POOL's own values (rank 14 / rank 9), not the caps.
    expect(screen.rangePctThreshold).toBeCloseTo(0.61, 10);
    expect(screen.netPctThreshold).toBeCloseTo(0.46, 10);
    expect(screen.rangePctThreshold).not.toBe(DEFAULT_COARSE_PARAMS.pctRange);
  });

  it('recomputes the cuts per pool: the same ranking passes under any common scale', () => {
    // Two pools whose members sit in the SAME order but on different price scales
    // (a market that got 10× wider). A frozen absolute W/D would flip one of them;
    // the pool-relative cut must not care.
    const narrow = measures(Array.from({ length: 20 }, (_, i) => [0.01 * (i + 1), 0.005 * (i + 1)] as const));
    const wide = measures(Array.from({ length: 20 }, (_, i) => [0.1 * (i + 1), 0.05 * (i + 1)] as const));

    const a = coarseScreen(narrow);
    const b = coarseScreen(wide);

    expect(a.passes).toEqual(b.passes);
    expect(a.screen.rangePctThreshold * 10).toBeCloseTo(b.screen.rangePctThreshold, 10);
    expect(a.passes.filter(Boolean)).toHaveLength(9);
  });

  it('takes the most conservative rank for a tie group (a tie can straddle and lose)', () => {
    // 1 low outlier + 19 identical members: the tie group occupies ranks 2..20, so
    // its shared rank is 20 — above both cuts — and only the outlier passes.
    const pool = measures([[0.01, 0.001], ...Array.from({ length: 19 }, () => [0.02, 0.002] as const)]);
    const { passes } = coarseScreen(pool);

    expect(passes[0]).toBe(true);
    expect(passes.slice(1).some(Boolean)).toBe(false);
  });

  it('passes at the rank cut and rejects one rank beyond it (`≤`, never `<`)', () => {
    const pool = measures(Array.from({ length: 10 }, (_, i) => [i + 1, 0] as const));
    const { screen, passes } = coarseScreen(pool, { pctRange: 0.5, pctNet: 1 });

    expect(screen.rangePctRank).toBe(5);
    expect(screen.netPctRank).toBe(10);
    // rank 5 (the fifth smallest) is in, rank 6 is out.
    expect(passes.slice(0, 5)).toEqual([true, true, true, true, true]);
    expect(passes.slice(5)).toEqual([false, false, false, false, false]);
  });

  it('excludes an unmeasurable instrument from the base and never lets it pass', () => {
    // The 次新币 has no window: it is neither in `poolSize` nor a candidate.
    const pool = [null, ...measures(Array.from({ length: 10 }, (_, i) => [0.1 * (i + 1), 0.1 * (i + 1)] as const))];
    const { screen, passes } = coarseScreen(pool, { pctRange: 0.5, pctNet: 0.5 });

    expect(screen.poolSize).toBe(10);
    expect(screen.rangePctRank).toBe(5);
    expect(passes[0]).toBe(false);
    // The remaining ranks are computed over the 10 measurable members only.
    expect(passes.slice(1, 6)).toEqual([true, true, true, true, true]);
  });

  it('degenerates safely on a pool too small for the cut (cut 0 = nobody passes)', () => {
    const { screen, passes } = coarseScreen(measures([[0.01, 0.001], [0.02, 0.002]]));

    expect(screen.poolSize).toBe(2);
    expect(screen.rangePctRank).toBe(1);
    expect(screen.netPctRank).toBe(0);
    expect(passes).toEqual([false, false]);
    expect(screen.netPctThreshold).toBe(-Infinity);

    expect(coarseScreen([]).passes).toEqual([]);
    expect(coarseScreen([]).screen.poolSize).toBe(0);
  });

  it('defaults to the calibrated caps and window', () => {
    expect(DEFAULT_COARSE_PARAMS.pctRange).toBe(COARSE_SCREEN_PCT_RANGE);
    expect(DEFAULT_COARSE_PARAMS.pctNet).toBe(COARSE_SCREEN_PCT_NET);
    expect(COARSE_SCREEN_PCT_RANGE).toBeCloseTo(0.7371, 4);
    expect(COARSE_SCREEN_PCT_NET).toBeCloseTo(0.4849, 4);
    expect(COARSE_SCREEN_PCT_RANGE).toBeGreaterThan(COARSE_SCREEN_PCT_NET);
    // The screen runs on the daily series only.
    expect(COARSE_TIMEFRAME).toBe('1D');
    expect(scanTimeframes).toContain(COARSE_TIMEFRAME);
  });
});
