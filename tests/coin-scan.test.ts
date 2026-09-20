import { describe, expect, it } from 'vitest';
import type { Candlestick } from '../src/domain/candlestick';
import {
  CONVERGENCE_CONFIRMED_TAIL,
  DEFAULT_CONVERGENCE_FLAT_RATIO,
  DEFAULT_CONVERGENCE_MIN_RUN,
  DEFAULT_CONVERGENCE_RATIO,
  defaultStructureParams,
  detectConvergence,
  probeStructure,
  scanTimeframes,
  type StructureParams,
} from '../src/domain/coin-scan';

/** Builds candles from `[low, high]` bars, close = midpoint, ascending timestamps. */
function candles(bars: ReadonlyArray<readonly [number, number]>): Candlestick[] {
  return bars.map(([low, high], index) => ({
    instrument: 'TEST',
    timeframe: '5m' as const,
    timestamp: index * 60_000,
    open: (low + high) / 2,
    high,
    low,
    close: (low + high) / 2,
    volume: 100,
  }));
}

// ---------------------------------------------------------------------------
// Volatility convergence (波动率越来越小): band vs same-length preceding stretch
// ---------------------------------------------------------------------------

describe('detectConvergence (band vs preceding volatility)', () => {
  const params = defaultStructureParams();

  it('detects a band quieter than the preceding stretch as a convergence', () => {
    // 16 volatile bars (~6.4% per bar) then 16 flat calm bars (~1%): the recent
    // band is far quieter than the stretch before it → a real 波动率越来越小.
    const result = detectConvergence(
      candles([
        ...Array.from({ length: 16 }, () => [94, 100] as const),
        ...Array.from({ length: 16 }, () => [99.5, 100.5] as const),
      ]),
      params,
    );
    expect(result).not.toBeNull();
    expect(result!.structure).toBe('convergence');
    expect(result!.qualified).toBe(true);
    expect(result!.score).toBeGreaterThanOrEqual(0.7);
  });

  it('scores the shrink depth alone, independent of how long the band is', () => {
    // Same amplitude ratio, very different band length: the fixtures carry 5 quiet
    // bars (A) vs 16 (B) after the identical 16-bar volatile lead (~6.38% bars,
    // quiet bars ~1.005%). Every lead bar has the SAME volatility, so `preMed` is
    // 6/94 for both. A's only usable band is 5 bars long — n = 21 caps runLen at
    // 10, and every longer band drags the volatile lead into itself and is
    // rejected (flatness at 6-9 bars, the shrink gate at 10). B's chosen band is
    // 11 bars (the shortest band already at the maximal depth, and the first one
    // the strict `>` scan meets). So the two results differ ONLY in duration and
    // the score must be identical. (The removed length bonus made A ~0.68 and B
    // ~0.89, so this test fails if a duration term ever comes back.)
    const lead = Array.from({ length: 16 }, () => [94, 100] as const);
    const quiet = [99.5, 100.5] as const;
    const shortBand = detectConvergence(candles([...lead, ...Array.from({ length: 5 }, () => quiet)]), params);
    const longBand = detectConvergence(candles([...lead, ...Array.from({ length: 16 }, () => quiet)]), params);
    expect(shortBand).not.toBeNull();
    expect(longBand).not.toBeNull();
    expect(shortBand!.score).toBeCloseTo(longBand!.score, 10);
    // The score IS the shrink depth: band median vol (1 / 99.5) over lead median
    // vol (6 / 94).
    expect(longBand!.score).toBeCloseTo(1 - 1 / 99.5 / (6 / 94), 10);
  });

  it('rejects a band whose volatility matches the preceding stretch (no shrink)', () => {
    // Uniformly calm bars: every band's volatility equals its preceding stretch →
    // ratio ≈ 1 ≥ convergenceRatio → no convergence.
    const calm = Array.from({ length: 24 }, () => [49, 51] as const);
    expect(detectConvergence(candles(calm), params)).toBeNull();
  });

  it('scores a short band that is only mildly quieter below minScore', () => {
    // 16 volatile bars (~6.4%) then an 8-bar band only ~1.6× quieter (~4%): the
    // shrink depth alone is ~0.36 → below 0.7.
    const result = detectConvergence(
      candles([
        ...Array.from({ length: 16 }, () => [94, 100] as const), // ~6.4% bars
        ...Array.from({ length: 8 }, () => [98, 102] as const), // ~4% bars
      ]),
      params,
    );
    expect(result).not.toBeNull();
    expect(result!.structure).toBe('convergence');
    expect(result!.score).toBeLessThan(0.7);
  });

  it('rejects a band only when its newest bar has broken out of the confirmed range', () => {
    // 16 volatile bars, then 15 quiet bars, then ONE more bar. The band always
    // ends at the newest bar, so the confirmed range must be built from the bars
    // BEFORE it — with the newest bar included the range would contain the price
    // being tested and the check would be vacuously true.
    const lead = [
      ...Array.from({ length: 16 }, () => [94, 100] as const),
      ...Array.from({ length: 15 }, () => [99.5, 100.5] as const),
    ];
    // Control: the newest bar is quiet like the rest → the band survives.
    expect(detectConvergence(candles([...lead, [99.5, 100.5] as const]), params)).not.toBeNull();
    // Breakout: the newest bar closes above the 15 quiet bars' high (100.5) by
    // more than the 10% range tolerance (0.1) — still a legal candle, because
    // its close (100.75) sits inside its own [100, 101.5]. Flatness is NOT the
    // gate that rejects this: for the longest band (runLen 16) drift(low) 0.0017
    // and drift(high) 0.0033 both stay under flatTol = 2 × runMed 0.0201, and the
    // shrink gate passes as well (runMed 0.0101 < 0.9 × preMed, with preMed 0.0638
    // → threshold 0.0574), so containment is the only gate that can fire on it.
    expect(detectConvergence(candles([...lead, [100, 101.5] as const]), params)).toBeNull();
  });

  it('reads position off the confirmed range, not the whole band', () => {
    // The newest bar dips just below the 15 quiet bars' low (99.5) but stays
    // within the 10% tolerance, so the band survives. Its close (100.1) sits at
    // 0.6 of the CONFIRMED range [99.5, 100.5]; measuring against the whole band
    // instead would give (100.1 - 99.3) / (100.9 - 99.3) = 0.5.
    const bars = candles([
      ...Array.from({ length: 16 }, () => [94, 100] as const),
      ...Array.from({ length: 15 }, () => [99.5, 100.5] as const),
      [99.3, 100.9] as const,
    ]);
    const result = detectConvergence(bars, params);
    expect(result).not.toBeNull();
    expect(result!.position).toBeCloseTo(0.6, 5);
  });

  it('returns null with fewer than 2×minRun bars (no preceding stretch)', () => {
    expect(detectConvergence(candles([...Array.from({ length: 8 }, () => [49, 51] as const)]), params)).toBeNull();
  });

  it('returns null with a non-positive price', () => {
    const bars = candles([
      ...Array.from({ length: 16 }, () => [94, 100] as const),
      ...Array.from({ length: 16 }, () => [99.5, 100.5] as const),
    ]);
    // An all-zero bar: a non-positive price, and still a consistent OHLC shape
    // (low <= open/close <= high), so the guard is the only thing under test here.
    bars[2] = { ...bars[2], open: 0, low: 0, high: 0, close: 0 };
    expect(detectConvergence(bars, params)).toBeNull();
  });

  it('detects a crash-then-pause as a strong convergence (known consequence, decision open)', () => {
    // A big dump (~8% bars) followed by a quiet band (~2% bars): band/preceding ≈
    // 0.25, so by the pure band-vs-preceding rule this IS a strong "shrinking".
    // This is the CBRS 大跌后喘息 pattern — currently detected and scored high.
    // The task notes flag this for the user to decide whether to exclude.
    const result = detectConvergence(
      candles([
        ...Array.from({ length: 16 }, () => [90, 98] as const), // ~8.5% bars
        ...Array.from({ length: 16 }, () => [95, 97] as const), // ~2% bars
      ]),
      params,
    );
    expect(result).not.toBeNull();
    expect(result!.structure).toBe('convergence');
    expect(result!.score).toBeGreaterThanOrEqual(0.7);
  });

  it('honestly scores a mild shrink (band ≈ 60% of preceding) below minScore', () => {
    // EWY 型: only ~1.7× quieter than the preceding stretch → detected but scores
    // honestly under 0.7 (a mild shrink isn't boosted).
    const result = detectConvergence(
      candles([
        ...Array.from({ length: 16 }, () => [94, 100] as const), // ~6.4%
        ...Array.from({ length: 16 }, () => [97.6, 100.8] as const), // ~3.2%
      ]),
      params,
    );
    expect(result).not.toBeNull();
    expect(result!.structure).toBe('convergence');
    expect(result!.score).toBeLessThan(0.7);
  });

  it('responds to a stricter convergenceRatio (fewer shrinks qualify)', () => {
    const strict = defaultStructureParams({ convergenceRatio: 0.6 });
    // 16 volatile + 16 band at ratio 0.16 → still passes even a strict gate.
    const strong = candles([
      ...Array.from({ length: 16 }, () => [94, 100] as const),
      ...Array.from({ length: 16 }, () => [99.5, 100.5] as const),
    ]);
    expect(detectConvergence(strong, strict)).not.toBeNull();
    // 16 volatile + 16 band at ratio ~0.5 → passes the default (0.9) gate but
    // fails a strict (0.6) gate.
    const mild = candles([
      ...Array.from({ length: 16 }, () => [94, 100] as const), // ~6.4%
      ...Array.from({ length: 16 }, () => [96, 100] as const), // ~4%
    ]);
    expect(detectConvergence(mild, defaultStructureParams())).not.toBeNull();
    expect(detectConvergence(mild, strict)).toBeNull();
  });
});

describe('probeStructure', () => {
  it('forwards to the volatility convergence detector', () => {
    const result = probeStructure(
      candles([
        ...Array.from({ length: 16 }, () => [94, 100] as const),
        ...Array.from({ length: 16 }, () => [99.5, 100.5] as const),
      ]),
      defaultStructureParams(),
    );
    expect(result?.structure).toBe('convergence');
  });

  it('returns null on a trending channel (no volatility shrink)', () => {
    // A steady up-trend: every band's volatility equals its preceding stretch.
    const trend = Array.from({ length: 40 }, (_, i) => [100 + i * 2, 106 + i * 2] as const);
    expect(probeStructure(candles(trend), defaultStructureParams())).toBeNull();
  });
});

describe('Coin Scan structure defaults and types', () => {
  it('exposes the scan timeframes and the single structure kind', () => {
    expect(scanTimeframes).toEqual(['5m', '15m', '1H', '4H', '1D']);
  });

  it('exposes the calibrated convergence constants', () => {
    expect(DEFAULT_CONVERGENCE_MIN_RUN).toBe(5);
    expect(DEFAULT_CONVERGENCE_RATIO).toBe(0.9);
    expect(DEFAULT_CONVERGENCE_FLAT_RATIO).toBe(2.0);
    expect(CONVERGENCE_CONFIRMED_TAIL).toBe(1);
  });

  it('defaultStructureParams fills every threshold from the file-top defaults', () => {
    const params: StructureParams = defaultStructureParams();
    expect(params).toEqual({
      minRun: DEFAULT_CONVERGENCE_MIN_RUN,
      convergenceRatio: DEFAULT_CONVERGENCE_RATIO,
      flatRatio: DEFAULT_CONVERGENCE_FLAT_RATIO,
    });
    expect(defaultStructureParams({ minRun: 7 }).minRun).toBe(7);
  });
});
