import { describe, expect, it } from 'vitest';
import type { Candlestick } from '../src/domain/candlestick';
import {
  CONVERGENCE_SCORE_CALM_WEIGHT,
  CONVERGENCE_SCORE_LENGTH_WEIGHT,
  DEFAULT_CONVERGENCE_FLAT_RATIO,
  DEFAULT_CONVERGENCE_LENGTH_SCALE,
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

  it('rejects a band whose volatility matches the preceding stretch (no shrink)', () => {
    // Uniformly calm bars: every band's volatility equals its preceding stretch →
    // ratio ≈ 1 ≥ convergenceRatio → no convergence.
    const calm = Array.from({ length: 24 }, () => [49, 51] as const);
    expect(detectConvergence(candles(calm), params)).toBeNull();
  });

  it('scores a short band that is only mildly quieter below minScore', () => {
    // 16 volatile bars then an 8-bar band that is only ~1.6× quieter: the calm
    // term is modest and the short length contributes little → below 0.7.
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

  it('rejects a band whose price has broken out (containment gate)', () => {
    // The band is quiet vs its preceding stretch, but the current close is a gap
    // far above the band's range → the price broke out, no longer 蓄力.
    const bars = candles([
      ...Array.from({ length: 16 }, () => [94, 100] as const),
      ...Array.from({ length: 16 }, () => [99.5, 100.5] as const),
    ]);
    bars[bars.length - 1] = { ...bars[bars.length - 1], close: 130 };
    expect(detectConvergence(bars, params)).toBeNull();
  });

  it('returns null with fewer than 2×minRun bars (no preceding stretch)', () => {
    expect(detectConvergence(candles([...Array.from({ length: 8 }, () => [49, 51] as const)]), params)).toBeNull();
  });

  it('returns null with a non-positive price', () => {
    const bars = candles([
      ...Array.from({ length: 16 }, () => [94, 100] as const),
      ...Array.from({ length: 16 }, () => [99.5, 100.5] as const),
    ]);
    bars[2] = { ...bars[2], low: 0, high: 0 };
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
    // below the default minScore 0.7.
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
    expect(DEFAULT_CONVERGENCE_LENGTH_SCALE).toBe(16);
    expect(CONVERGENCE_SCORE_CALM_WEIGHT).toBe(0.7);
    expect(CONVERGENCE_SCORE_LENGTH_WEIGHT).toBe(0.3);
  });

  it('defaultStructureParams fills every threshold from the file-top defaults', () => {
    const params: StructureParams = defaultStructureParams();
    expect(params).toEqual({
      minRun: DEFAULT_CONVERGENCE_MIN_RUN,
      convergenceRatio: DEFAULT_CONVERGENCE_RATIO,
      flatRatio: DEFAULT_CONVERGENCE_FLAT_RATIO,
      lengthScale: DEFAULT_CONVERGENCE_LENGTH_SCALE,
    });
    expect(defaultStructureParams({ minRun: 7 }).minRun).toBe(7);
  });
});
