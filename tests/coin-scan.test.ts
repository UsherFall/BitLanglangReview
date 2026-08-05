import { describe, expect, it } from 'vitest';
import type { Candlestick } from '../src/domain/candlestick';
import {
  computeQuietMetrics,
  DEFAULT_BOX_WINDOW,
  DEFAULT_MAX_BOX_RATIO,
  DEFAULT_MAX_COMPRESSION,
  DEFAULT_MAX_LATEST_TREND,
  DEFAULT_TREND_WINDOW,
} from '../src/domain/coin-scan';

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
// candles still satisfy the box-window history guard; trendWindow is lowered to
// 2 so the latest-trend windows also fit in 4 candles.
const params = { ratioThreshold: 0.7, consecutive: 2, window: 2, boxWindow: 2, maxBoxRatio: 0.9, trendWindow: 2 };
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

  it('returns null with fewer than 2 * boxWindow candlesticks even when volume ratios exist', () => {
    // count = 6 >= window + consecutive (4) but < 2 * boxWindow (24).
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
  // A 36-bar suite: 24 pre-box bars (volume 100, `preAmplitude`) followed by 12
  // box bars. The 24 pre-box bars cover the prior compression window (the
  // boxWindow bars right before the trailing box), and their default amplitude
  // (2%) is higher than the box span (0.5%), so the suite's compression < 1 and
  // a tight box qualifies under DEFAULT_MAX_COMPRESSION. The box bars alternate
  // lean-low / lean-high so their union spans [100 - band/2, 100 + band/2] and
  // each bar spans `span`. The trailing 3 box bars (the `consecutive` streak)
  // drop volume to 30 unless shrink is false.
  function boxSuite(options: {
    band?: number;
    scale?: number;
    lastSpan?: number;
    shrink?: boolean;
    preAmplitude?: number;
  } = {}): Candlestick[] {
    const { band = 1.5, scale = 1, lastSpan, shrink = true, preAmplitude = 0.02 } = options;
    const span = 0.5 * scale;
    const preCount = 2 * 12; // 2 * boxWindow, so the prior window is fully covered
    const bars: Candlestick[] = [];
    for (let i = 0; i < preCount; i += 1) {
      bars.push(makeCandle(iso(i), 100, preAmplitude * scale));
    }
    for (let i = 0; i < 12; i += 1) {
      const barSpan = i === 11 && lastSpan !== undefined ? lastSpan * scale : span;
      const volume = i >= 9 && shrink ? 30 : 100;
      const low = i % 2 === 0 ? 100 - (band * scale) / 2 : 100 + (band * scale) / 2 - barSpan;
      const high = low + barSpan;
      bars.push(makeOhlc(iso(preCount + i), volume, low, high, low, high));
    }
    return bars;
  }

  // maxLatestTrend is set permissively (1.1) so the uniform box's latestTrend ≈ 1.0
  // does not interfere: this block isolates the boxTightness gate. The default 0.9
  // rejects a uniform box, which is the intended latestTrend behavior.
  const boxParams = { ratioThreshold: 0.7, consecutive: 3, window: 3, boxWindow: 12, maxBoxRatio: 0.9, maxLatestTrend: 1.1 };

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

  it('falls back to DEFAULT_BOX_WINDOW, DEFAULT_MAX_BOX_RATIO, and DEFAULT_MAX_COMPRESSION when omitted', () => {
    const result = computeQuietMetrics(boxSuite({}), {
      ratioThreshold: 0.7,
      consecutive: 3,
      window: 3,
      // The uniform box has latestTrend ≈ 1.0; a permissive threshold keeps this
      // test focused on the three box defaults (the latestTrend default is covered
      // in the v4 block).
      maxLatestTrend: 1.1,
    });
    expect(result).not.toBeNull();
    expect(DEFAULT_BOX_WINDOW).toBe(12);
    expect(DEFAULT_MAX_BOX_RATIO).toBe(0.9);
    expect(DEFAULT_MAX_COMPRESSION).toBe(0.8);
    expect(result!.boxTightness).toBeLessThan(DEFAULT_MAX_BOX_RATIO);
    expect(result!.compression).toBeLessThan(DEFAULT_MAX_COMPRESSION);
    expect(result!.qualified).toBe(true);
  });
});

describe('Coin Scan volatility compression (v3)', () => {
  // boxWindow 2 → 4 bars satisfy the 2 * boxWindow history guard. prior = bars
  // [0, 1], recent = bars [2, 3]. The trailing two bars shrink volume so the
  // volume gate stays green and the compression gate decides the verdict.
  const compressionParams = { ratioThreshold: 0.7, consecutive: 2, window: 2, boxWindow: 2, maxBoxRatio: 0.9, maxCompression: 0.8, trendWindow: 2 };

  it('qualifies when the recent mean amplitude is clearly below the prior window', () => {
    const result = computeQuietMetrics(candles([
      [t[0], 100, 0.02],
      [t[1], 100, 0.02],
      [t[2], 30, 0.006], // amp ratio 0.006 / 0.02 = 0.3
      [t[3], 20, 0.006],
    ]), compressionParams);
    expect(result).not.toBeNull();
    expect(result!.compression).toBeCloseTo(0.3);
    expect(result!.consecutiveQuiet).toBe(2);
    expect(result!.boxTightness).toBeLessThan(compressionParams.maxBoxRatio);
    expect(result!.qualified).toBe(true);
  });

  it('rejects when the recent amplitude is about the same as the prior window', () => {
    const result = computeQuietMetrics(candles([
      [t[0], 100, 0.02],
      [t[1], 100, 0.02],
      [t[2], 30, 0.018], // amp ratio 0.018 / 0.02 = 0.9 > 0.8
      [t[3], 20, 0.018],
    ]), compressionParams);
    expect(result).not.toBeNull();
    expect(result!.compression).toBeCloseTo(0.9);
    expect(result!.boxTightness).toBeLessThan(compressionParams.maxBoxRatio);
    expect(result!.qualified).toBe(false);
  });

  it('rejects a prior-window-is-flat coin that woke up (compression LARGE_RATIO)', () => {
    const result = computeQuietMetrics(candles([
      [t[0], 100, 0],
      [t[1], 100, 0],
      [t[2], 30, 0.006],
      [t[3], 20, 0.006],
    ]), compressionParams);
    expect(result).not.toBeNull();
    expect(result!.compression).toBeGreaterThan(compressionParams.maxCompression);
    expect(result!.qualified).toBe(false);
  });

  it('passes when both windows are flat (compression 0, volume gate carries the verdict)', () => {
    const result = computeQuietMetrics(candles([
      [t[0], 100, 0],
      [t[1], 100, 0],
      [t[2], 30, 0],
      [t[3], 20, 0],
    ]), compressionParams);
    expect(result).not.toBeNull();
    expect(result!.compression).toBe(0);
    expect(result!.consecutiveQuiet).toBe(2);
    expect(result!.qualified).toBe(true);
  });

  it('is scale-free: 0.5%/bar and 2%/bar compress with the same ratio', () => {
    const small = computeQuietMetrics(candles([
      [t[0], 100, 0.02],
      [t[1], 100, 0.02],
      [t[2], 30, 0.006],
      [t[3], 20, 0.006],
    ]), compressionParams);
    const large = computeQuietMetrics(candles([
      [t[0], 100, 0.08],
      [t[1], 100, 0.08],
      [t[2], 30, 0.024],
      [t[3], 20, 0.024],
    ]), compressionParams);
    expect(small).not.toBeNull();
    expect(large).not.toBeNull();
    expect(small!.compression).toBeCloseTo(large!.compression);
    expect(small!.compression).toBeCloseTo(0.3);
    expect(large!.compression).toBeCloseTo(0.3);
    expect(small!.qualified).toBe(true);
    expect(large!.qualified).toBe(true);
  });

  it('rejects a box whose recent window is flat but prior window has volume (guard uses 2 * boxWindow)', () => {
    // 3 candles only: enough for the old boxWindow-only guard but short of
    // 2 * boxWindow, so metrics are null rather than half-computed.
    expect(computeQuietMetrics(candles([
      [t[0], 100, 0.02],
      [t[1], 100, 0.02],
      [t[2], 30, 0.006],
    ]), compressionParams)).toBeNull();
  });
});

describe('Coin Scan latest trend (v4)', () => {
  // boxWindow 4 → 8 bars satisfy the 2 * boxWindow history guard. prior = bars
  // 0..3 (compression), middle = bars 4..5, latest = bars 6..7. The trailing two
  // bars shrink volume so the volume gate stays green; middle/latest amplitudes
  // decide the latestTrend verdict while recent/prior amplitudes keep compression
  // green.
  const trendParams = { ratioThreshold: 0.7, consecutive: 2, window: 2, boxWindow: 4, maxBoxRatio: 0.9, maxCompression: 0.8, maxLatestTrend: 0.9, trendWindow: 2 };

  it('qualifies when the latest window keeps narrowing against the middle window', () => {
    const result = computeQuietMetrics(candles([
      [iso(0), 100, 0.02],
      [iso(1), 100, 0.02],
      [iso(2), 100, 0.02],
      [iso(3), 100, 0.02],
      [iso(4), 100, 0.008], // middle
      [iso(5), 100, 0.008],
      [iso(6), 30, 0.0056], // latest = 0.7 × middle
      [iso(7), 20, 0.0056],
    ]), trendParams);
    expect(result).not.toBeNull();
    expect(result!.latestTrend).toBeCloseTo(0.0056 / 0.008); // 0.7
    expect(result!.compression).toBeLessThan(trendParams.maxCompression);
    expect(result!.boxTightness).toBeLessThan(trendParams.maxBoxRatio);
    expect(result!.qualified).toBe(true);
  });

  it('rejects when the latest window has flattened out (latest ≈ middle)', () => {
    const result = computeQuietMetrics(candles([
      [iso(0), 100, 0.02],
      [iso(1), 100, 0.02],
      [iso(2), 100, 0.02],
      [iso(3), 100, 0.02],
      [iso(4), 100, 0.006], // middle
      [iso(5), 100, 0.006],
      [iso(6), 30, 0.00558], // latest = 0.93 × middle
      [iso(7), 20, 0.00558],
    ]), trendParams);
    expect(result).not.toBeNull();
    expect(result!.latestTrend).toBeCloseTo(0.00558 / 0.006); // 0.93
    expect(result!.compression).toBeLessThan(trendParams.maxCompression);
    expect(result!.boxTightness).toBeLessThan(trendParams.maxBoxRatio);
    expect(result!.latestTrend).toBeGreaterThan(trendParams.maxLatestTrend);
    expect(result!.qualified).toBe(false);
  });

  it('rejects when the latest window is widening (latest > middle)', () => {
    const result = computeQuietMetrics(candles([
      [iso(0), 100, 0.02],
      [iso(1), 100, 0.02],
      [iso(2), 100, 0.02],
      [iso(3), 100, 0.02],
      [iso(4), 100, 0.006], // middle
      [iso(5), 100, 0.006],
      [iso(6), 30, 0.0084], // latest = 1.4 × middle
      [iso(7), 20, 0.0084],
    ]), trendParams);
    expect(result).not.toBeNull();
    expect(result!.latestTrend).toBeCloseTo(0.0084 / 0.006); // 1.4
    expect(result!.latestTrend).toBeGreaterThan(trendParams.maxLatestTrend);
    expect(result!.qualified).toBe(false);
  });

  it('rejects a middle-window-is-flat coin that woke up (latestTrend LARGE_RATIO)', () => {
    const result = computeQuietMetrics(candles([
      [iso(0), 100, 0.02],
      [iso(1), 100, 0.02],
      [iso(2), 100, 0.02],
      [iso(3), 100, 0.02],
      [iso(4), 100, 0], // middle flat
      [iso(5), 100, 0],
      [iso(6), 30, 0.006], // latest active
      [iso(7), 20, 0.006],
    ]), trendParams);
    expect(result).not.toBeNull();
    expect(result!.latestTrend).toBeGreaterThanOrEqual(1e9);
    expect(result!.qualified).toBe(false);
  });

  it('passes when both trend windows are flat (latestTrend 0, other gates carry the verdict)', () => {
    const result = computeQuietMetrics(candles([
      [iso(0), 100, 0],
      [iso(1), 100, 0],
      [iso(2), 100, 0],
      [iso(3), 100, 0],
      [iso(4), 100, 0],
      [iso(5), 100, 0],
      [iso(6), 30, 0],
      [iso(7), 20, 0],
    ]), trendParams);
    expect(result).not.toBeNull();
    expect(result!.latestTrend).toBe(0);
    expect(result!.consecutiveQuiet).toBe(2);
    expect(result!.qualified).toBe(true);
  });

  it('is scale-free: 0.5%/bar and 2%/bar narrow with the same latestTrend ratio', () => {
    const small = computeQuietMetrics(candles([
      [iso(0), 100, 0.02],
      [iso(1), 100, 0.02],
      [iso(2), 100, 0.02],
      [iso(3), 100, 0.02],
      [iso(4), 100, 0.008],
      [iso(5), 100, 0.008],
      [iso(6), 30, 0.0056],
      [iso(7), 20, 0.0056],
    ]), trendParams);
    const large = computeQuietMetrics(candles([
      [iso(0), 100, 0.08],
      [iso(1), 100, 0.08],
      [iso(2), 100, 0.08],
      [iso(3), 100, 0.08],
      [iso(4), 100, 0.032],
      [iso(5), 100, 0.032],
      [iso(6), 30, 0.0224],
      [iso(7), 20, 0.0224],
    ]), trendParams);
    expect(small).not.toBeNull();
    expect(large).not.toBeNull();
    expect(small!.latestTrend).toBeCloseTo(large!.latestTrend);
    expect(small!.latestTrend).toBeCloseTo(0.7);
    expect(small!.qualified).toBe(true);
    expect(large!.qualified).toBe(true);
  });

  it('falls back to DEFAULT_TREND_WINDOW and DEFAULT_MAX_LATEST_TREND when omitted', () => {
    // boxWindow 4 and the default trendWindow 4 align the windows: latest = bars
    // 4..7, middle = bars 0..3, so a recent-vs-prior amplitude 0.3 also narrows.
    const result = computeQuietMetrics(candles([
      [iso(0), 100, 0.02],
      [iso(1), 100, 0.02],
      [iso(2), 100, 0.02],
      [iso(3), 100, 0.02],
      [iso(4), 100, 0.006],
      [iso(5), 100, 0.006],
      [iso(6), 30, 0.006],
      [iso(7), 20, 0.006],
    ]), { ratioThreshold: 0.7, consecutive: 2, window: 2, boxWindow: 4, maxBoxRatio: 0.9, maxCompression: 0.8 });
    expect(result).not.toBeNull();
    expect(DEFAULT_TREND_WINDOW).toBe(4);
    expect(DEFAULT_MAX_LATEST_TREND).toBe(0.9);
    expect(result!.latestTrend).toBeCloseTo(0.006 / 0.02); // 0.3
    expect(result!.latestTrend).toBeLessThan(DEFAULT_MAX_LATEST_TREND);
    expect(result!.qualified).toBe(true);
  });
});
