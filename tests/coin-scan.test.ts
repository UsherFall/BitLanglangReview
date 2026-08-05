import { describe, expect, it } from 'vitest';
import type { Candlestick } from '../src/domain/candlestick';
import { computeQuietMetrics, DEFAULT_BOX_WINDOW, DEFAULT_MAX_BOX_RATIO } from '../src/domain/coin-scan';

// amplitude = (high - low) / low, controlled by the `amplitude` argument.
function makeCandle(iso: string, volume: number, amplitude: number): Candlestick {
  const low = 100;
  return {
    instrument: 'BTC-USDT-SWAP',
    timeframe: '5m',
    timestamp: Date.parse(iso),
    open: low,
    high: low * (1 + amplitude),
    low,
    close: low,
    volume,
  };
}

function makeOhlc(iso: string, volume: number, open: number, high: number, low: number, close: number): Candlestick {
  return {
    instrument: 'BTC-USDT-SWAP',
    timeframe: '5m',
    timestamp: Date.parse(iso),
    open,
    high,
    low,
    close,
    volume,
  };
}

function candles(entries: Array<[string, number, number]>): Candlestick[] {
  return entries.map(([iso, volume, amplitude]) => makeCandle(iso, volume, amplitude));
}

const baseTime = Date.parse('2024-05-21T00:00:00+08:00');
function iso(offset: number): string {
  return new Date(baseTime + offset * 5 * 60_000).toISOString();
}

// Params for the small (4-candle) ratio tests: boxWindow is lowered so the few
// candles still satisfy the box-window history guard.
const params = { ratioThreshold: 0.7, consecutive: 2, window: 2, boxWindow: 2, maxBoxRatio: 0.9 };
const t = [
  '2024-05-21T00:00:00+08:00',
  '2024-05-21T00:05:00+08:00',
  '2024-05-21T00:10:00+08:00',
  '2024-05-21T00:15:00+08:00',
];

describe('Coin Scan quiet-consolidation metrics', () => {
  it('computes volume and amplitude ratios against their own sliding windows', () => {
    const result = computeQuietMetrics(candles([
      [t[0], 100, 0.02],
      [t[1], 100, 0.02],
      [t[2], 50, 0.01], // volRatio 0.5, ampRatio 0.5
      [t[3], 40, 0.008], // volRatio 40/75, ampRatio 0.008/0.015
    ]), params);
    expect(result).not.toBeNull();
    expect(result!.ratio).toBeCloseTo(40 / 75);
    expect(result!.amplitudeRatio).toBeCloseTo(0.008 / 0.015);
    expect(result!.consecutiveQuiet).toBe(2);
    expect(result!.intensity).toBeCloseTo((0.5 + (40 / 75 + 0.008 / 0.015) / 2) / 2);
    // Both trailing bars anchor at the same low (100), so the 2-bar box
    // overlaps and stays tight.
    expect(result!.boxTightness).toBeCloseTo(0.79, 1);
    expect(result!.qualified).toBe(true);
  });

  it('is independent of input candle order', () => {
    const ordered = candles([
      [t[0], 100, 0.02],
      [t[1], 100, 0.02],
      [t[2], 50, 0.01],
      [t[3], 40, 0.008],
    ]);
    const reversed = [...ordered].reverse();
    const forward = computeQuietMetrics(ordered, params);
    const backward = computeQuietMetrics(reversed, params);
    expect(forward).not.toBeNull();
    expect(backward).not.toBeNull();
    expect(forward).toEqual(backward);
  });

  it('returns null with fewer than window + consecutive candlesticks', () => {
    expect(computeQuietMetrics(candles([
      [t[0], 100, 0.02],
      [t[1], 100, 0.02],
      [t[2], 50, 0.01],
    ]), params)).toBeNull();
  });

  it('returns null with fewer than boxWindow candlesticks even when volume ratios exist', () => {
    // count = 6 >= window + consecutive (4) but < boxWindow (12).
    const many = Array.from({ length: 6 }, (_, i) => [iso(i), 100, 0.005] as [string, number, number]);
    expect(computeQuietMetrics(candles(many), { ...params, boxWindow: 12 })).toBeNull();
  });

  it('returns null when a volume window average is zero', () => {
    expect(computeQuietMetrics(candles([
      [t[0], 0, 0.02],
      [t[1], 0, 0.02],
      [t[2], 10, 0.01],
      [t[3], 10, 0.01],
    ]), params)).toBeNull();
  });

  it('treats a zero-amplitude baseline with a flat current bar as calm and a perfect box', () => {
    const result = computeQuietMetrics(candles([
      [t[0], 100, 0],
      [t[1], 100, 0],
      [t[2], 50, 0],
      [t[3], 40, 0],
    ]), params);
    expect(result).not.toBeNull();
    expect(result!.amplitudeRatio).toBe(0);
    expect(result!.consecutiveQuiet).toBe(2);
    expect(result!.boxTightness).toBe(0);
    expect(result!.qualified).toBe(true);
  });

  it('does not let a wide-amplitude bar break the calm streak (volume-only gate)', () => {
    // t[3] has amplitude ratio 0.05 / 0.015 = 3.33, far above any amplitude
    // gate, but its volume ratio 40/75 is still < ratioThreshold, so the calm
    // streak is volume-only in v2. The wide bar still breaks the box shape.
    const result = computeQuietMetrics(candles([
      [t[0], 100, 0.02],
      [t[1], 100, 0.02],
      [t[2], 50, 0.01],
      [t[3], 40, 0.05],
    ]), params);
    expect(result).not.toBeNull();
    expect(result!.amplitudeRatio).toBeGreaterThan(1);
    expect(result!.consecutiveQuiet).toBe(2);
    expect(result!.boxTightness).toBeGreaterThan(1);
    expect(result!.qualified).toBe(false);
  });
});

describe('Coin Scan boxTightness (v2)', () => {
  // A 16-bar suite: 4 pre-box bars (volume 100, `preAmplitude`) followed by 12
  // box bars. The box bars alternate lean-low / lean-high so their union spans
  // [100 - band/2, 100 + band/2] and each bar spans `span`. The trailing 3 box
  // bars (the `consecutive` streak) drop volume to 30 unless shrink is false.
  function boxSuite(options: {
    band?: number;
    scale?: number;
    lastSpan?: number;
    shrink?: boolean;
    preAmplitude?: number;
  } = {}): Candlestick[] {
    const { band = 1.5, scale = 1, lastSpan, shrink = true, preAmplitude = 0.005 } = options;
    const span = 0.5 * scale;
    const bars: Candlestick[] = [];
    for (let i = 0; i < 4; i += 1) {
      bars.push(makeCandle(iso(i), 100, preAmplitude * scale));
    }
    for (let i = 0; i < 12; i += 1) {
      const barSpan = i === 11 && lastSpan !== undefined ? lastSpan * scale : span;
      const volume = i >= 9 && shrink ? 30 : 100;
      const low = i % 2 === 0 ? 100 - (band * scale) / 2 : 100 + (band * scale) / 2 - barSpan;
      const high = low + barSpan;
      bars.push(makeOhlc(iso(4 + i), volume, low, high, low, high));
    }
    return bars;
  }

  const boxParams = { ratioThreshold: 0.7, consecutive: 3, window: 3, boxWindow: 12, maxBoxRatio: 0.9 };

  it('qualifies a real box: boxTightness under maxBoxRatio', () => {
    const result = computeQuietMetrics(boxSuite({}), boxParams);
    expect(result).not.toBeNull();
    expect(result!.consecutiveQuiet).toBe(3);
    // band 1.5 / (span 0.5 * sqrt(12)) ≈ 0.87 < 0.9
    expect(result!.boxTightness).toBeCloseTo(0.87, 1);
    expect(result!.boxTightness).toBeLessThan(boxParams.maxBoxRatio);
    expect(result!.qualified).toBe(true);
  });

  it('rejects a coin whose box is stretched by a large candle inside the window', () => {
    const result = computeQuietMetrics(boxSuite({ lastSpan: 8 }), boxParams);
    expect(result).not.toBeNull();
    expect(result!.consecutiveQuiet).toBe(3);
    expect(result!.boxTightness).toBeGreaterThan(boxParams.maxBoxRatio);
    expect(result!.qualified).toBe(false);
  });

  it('rejects a wide oscillation around 1.0 and passes a nested tight box', () => {
    const wide = computeQuietMetrics(boxSuite({ band: 1.73 }), boxParams);
    const nested = computeQuietMetrics(boxSuite({ band: 1.4 }), boxParams);
    expect(wide).not.toBeNull();
    expect(nested).not.toBeNull();
    expect(wide!.boxTightness).toBeCloseTo(1, 1);
    expect(wide!.boxTightness).toBeGreaterThan(boxParams.maxBoxRatio);
    expect(wide!.qualified).toBe(false);
    expect(nested!.boxTightness).toBeLessThan(wide!.boxTightness);
    expect(nested!.boxTightness).toBeLessThan(boxParams.maxBoxRatio);
    expect(nested!.qualified).toBe(true);
  });

  it('is scale-free: 0.5%/bar and 2%/bar boxes pass with the same threshold', () => {
    const small = computeQuietMetrics(boxSuite({}), boxParams); // ~0.5% per bar
    const large = computeQuietMetrics(boxSuite({ scale: 4 }), boxParams); // ~2% per bar
    expect(small).not.toBeNull();
    expect(large).not.toBeNull();
    expect(small!.boxTightness).toBeCloseTo(large!.boxTightness, 1);
    expect(small!.boxTightness).toBeLessThan(boxParams.maxBoxRatio);
    expect(large!.boxTightness).toBeLessThan(boxParams.maxBoxRatio);
    expect(small!.qualified).toBe(true);
    expect(large!.qualified).toBe(true);
  });

  it('does not reject a long-quiet coin whose amplitude ratio is near 1', () => {
    // Every bar has the same ~0.5% amplitude, so the trailing amplitude ratio
    // is ≈ 1. In v1 that tripped the amplitude gate; in v2 calm is volume-only
    // and the tight box qualifies.
    const result = computeQuietMetrics(boxSuite({}), boxParams);
    expect(result).not.toBeNull();
    expect(result!.amplitudeRatio).toBeCloseTo(1, 1);
    expect(result!.consecutiveQuiet).toBe(3);
    expect(result!.qualified).toBe(true);
  });

  it('rejects a dead coin that never shrinks volume', () => {
    const result = computeQuietMetrics(boxSuite({ shrink: false }), boxParams);
    expect(result).not.toBeNull();
    // The box is tight but every volume ratio ≈ 1, so no bar is calm.
    expect(result!.boxTightness).toBeLessThan(boxParams.maxBoxRatio);
    expect(result!.consecutiveQuiet).toBe(0);
    expect(result!.qualified).toBe(false);
  });

  it('ignores large candles outside the box window', () => {
    // The 4 pre-box bars are 10% candles; the 12 box bars are tight. Shape only
    // depends on the box window, and volume ratios use box bars too.
    const result = computeQuietMetrics(boxSuite({ preAmplitude: 0.1 }), boxParams);
    expect(result).not.toBeNull();
    expect(result!.consecutiveQuiet).toBe(3);
    expect(result!.boxTightness).toBeLessThan(boxParams.maxBoxRatio);
    expect(result!.qualified).toBe(true);
  });

  it('falls back to DEFAULT_BOX_WINDOW and DEFAULT_MAX_BOX_RATIO when omitted', () => {
    const result = computeQuietMetrics(boxSuite({}), {
      ratioThreshold: 0.7,
      consecutive: 3,
      window: 3,
    });
    expect(result).not.toBeNull();
    expect(DEFAULT_BOX_WINDOW).toBe(12);
    expect(DEFAULT_MAX_BOX_RATIO).toBe(0.9);
    expect(result!.boxTightness).toBeLessThan(DEFAULT_MAX_BOX_RATIO);
    expect(result!.qualified).toBe(true);
  });
});
