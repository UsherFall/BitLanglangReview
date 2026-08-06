import { describe, expect, it } from 'vitest';
import type { Candlestick } from '../src/domain/candlestick';
import {
  computePlateau,
  computeQuietMetrics,
  DEFAULT_MAX_COMPRESSION,
  DEFAULT_MAX_LATEST_TREND,
  DEFAULT_PLATEAU_MIN,
  DEFAULT_TREND_WINDOW,
  PLATEAU_BOX_WINDOWS,
} from '../src/domain/coin-scan';

// amplitude = (high - low) / low, controlled by the `amplitude` argument.
// Volume is part of the Candlestick shape but plays no role in the pure-price
// metrics (v5 removed the volume dimension entirely).
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

function candles(entries: Array<[string, number, number]>): Candlestick[] {
  return entries.map(([iso, volume, amplitude]) => makeCandle(iso, volume, amplitude));
}

const baseTime = Date.parse('2024-05-21T00:00:00+08:00');
function iso(offset: number): string {
  return new Date(baseTime + offset * 5 * 60_000).toISOString();
}

// Pure-price params for the small (4-candle) tests: boxWindow 2 → 4 bars satisfy
// the 2 * boxWindow guard; trendWindow 2 → 4 bars also satisfy 2 * trendWindow.
const params = { boxWindow: 2, trendWindow: 2 };
const t = [
  '2024-05-21T00:00:00+08:00',
  '2024-05-21T00:05:00+08:00',
  '2024-05-21T00:10:00+08:00',
  '2024-05-21T00:15:00+08:00',
];

describe('Coin Scan pure-price convergence metrics (v5)', () => {
  it('is independent of input candle order', () => {
    const ordered = candles([
      [t[0], 100, 0.02],
      [t[1], 100, 0.02],
      [t[2], 50, 0.006],
      [t[3], 40, 0.006],
    ]);
    const reversed = [...ordered].reverse();
    const forward = computeQuietMetrics(ordered, params);
    const backward = computeQuietMetrics(reversed, params);
    expect(forward).not.toBeNull();
    expect(backward).not.toBeNull();
    expect(forward).toEqual(backward);
  });

  it('returns null with fewer than 2 * boxWindow candlesticks', () => {
    expect(computeQuietMetrics(candles([
      [t[0], 100, 0.02],
      [t[1], 100, 0.02],
      [t[2], 100, 0.006],
    ]), params)).toBeNull();
  });

  it('returns null with fewer than 2 * trendWindow candlesticks even when boxWindow fits', () => {
    // count = 6 satisfies 2 * boxWindow (4) but boxWindow 6 needs 12 for the
    // compression windows and trendWindow 4 needs 8.
    const many = Array.from({ length: 6 }, (_, i) => [iso(i), 100, 0.005] as [string, number, number]);
    expect(computeQuietMetrics(candles(many), { boxWindow: 6, trendWindow: 4 })).toBeNull();
  });

  it('returns null when a price is non-positive', () => {
    const bars = candles([
      [t[0], 100, 0.02],
      [t[1], 100, 0.02],
      [t[2], 100, 0.006],
      [t[3], 100, 0.006],
    ]);
    bars[3] = { ...bars[3], low: 0, high: 0 };
    expect(computeQuietMetrics(bars, params)).toBeNull();
  });
});

describe('Coin Scan compression gate (pure price)', () => {
  // boxWindow 2 → prior = bars [0, 1], recent = bars [2, 3]. trendWindow 2 keeps
  // the latest-trend windows aligned. Volume is irrelevant to every verdict.
  const compressionParams = { boxWindow: 2, maxCompression: 0.8, trendWindow: 2 };

  it('qualifies when the recent mean amplitude is clearly below the prior window', () => {
    const result = computeQuietMetrics(candles([
      [t[0], 100, 0.02],
      [t[1], 100, 0.02],
      [t[2], 100, 0.006], // compression 0.006 / 0.02 = 0.3
      [t[3], 100, 0.006],
    ]), compressionParams);
    expect(result).not.toBeNull();
    expect(result!.compression).toBeCloseTo(0.3);
    expect(result!.qualified).toBe(true);
  });

  it('rejects when the recent amplitude is about the same as the prior window', () => {
    const result = computeQuietMetrics(candles([
      [t[0], 100, 0.02],
      [t[1], 100, 0.02],
      [t[2], 100, 0.018], // compression 0.018 / 0.02 = 0.9 > 0.8
      [t[3], 100, 0.018],
    ]), compressionParams);
    expect(result).not.toBeNull();
    expect(result!.compression).toBeCloseTo(0.9);
    expect(result!.qualified).toBe(false);
  });

  it('rejects a prior-window-is-flat coin that woke up (compression LARGE_RATIO)', () => {
    const result = computeQuietMetrics(candles([
      [t[0], 100, 0],
      [t[1], 100, 0],
      [t[2], 100, 0.006],
      [t[3], 100, 0.006],
    ]), compressionParams);
    expect(result).not.toBeNull();
    expect(result!.compression).toBeGreaterThanOrEqual(1e9);
    expect(result!.qualified).toBe(false);
  });

  it('passes when both windows are flat (compression 0, latestTrend carries the verdict)', () => {
    const result = computeQuietMetrics(candles([
      [t[0], 100, 0],
      [t[1], 100, 0],
      [t[2], 100, 0],
      [t[3], 100, 0],
    ]), compressionParams);
    expect(result).not.toBeNull();
    expect(result!.compression).toBe(0);
    expect(result!.latestTrend).toBe(0);
    expect(result!.qualified).toBe(true);
  });

  it('is scale-free: 0.5%/bar and 2%/bar compress with the same ratio', () => {
    const small = computeQuietMetrics(candles([
      [t[0], 100, 0.02],
      [t[1], 100, 0.02],
      [t[2], 100, 0.006],
      [t[3], 100, 0.006],
    ]), compressionParams);
    const large = computeQuietMetrics(candles([
      [t[0], 100, 0.08],
      [t[1], 100, 0.08],
      [t[2], 100, 0.024],
      [t[3], 100, 0.024],
    ]), compressionParams);
    expect(small).not.toBeNull();
    expect(large).not.toBeNull();
    expect(small!.compression).toBeCloseTo(large!.compression);
    expect(small!.compression).toBeCloseTo(0.3);
    expect(small!.qualified).toBe(true);
    expect(large!.qualified).toBe(true);
  });
});

describe('Coin Scan latest-trend gate (pure price)', () => {
  // boxWindow 4 → prior = bars 0..3 (compression), middle = bars 4..5,
  // latest = bars 6..7. Volume plays no role.
  const trendParams = { boxWindow: 4, maxCompression: 0.8, maxLatestTrend: 0.9, trendWindow: 2 };

  it('qualifies when the latest window keeps narrowing against the middle window', () => {
    const result = computeQuietMetrics(candles([
      [iso(0), 100, 0.02],
      [iso(1), 100, 0.02],
      [iso(2), 100, 0.02],
      [iso(3), 100, 0.02],
      [iso(4), 100, 0.008], // middle
      [iso(5), 100, 0.008],
      [iso(6), 100, 0.0056], // latest = 0.7 × middle
      [iso(7), 100, 0.0056],
    ]), trendParams);
    expect(result).not.toBeNull();
    expect(result!.latestTrend).toBeCloseTo(0.0056 / 0.008); // 0.7
    expect(result!.compression).toBeLessThan(trendParams.maxCompression);
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
      [iso(6), 100, 0.00558], // latest = 0.93 × middle
      [iso(7), 100, 0.00558],
    ]), trendParams);
    expect(result).not.toBeNull();
    expect(result!.latestTrend).toBeCloseTo(0.00558 / 0.006); // 0.93
    expect(result!.compression).toBeLessThan(trendParams.maxCompression);
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
      [iso(6), 100, 0.0084], // latest = 1.4 × middle
      [iso(7), 100, 0.0084],
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
      [iso(6), 100, 0.006], // latest active
      [iso(7), 100, 0.006],
    ]), trendParams);
    expect(result).not.toBeNull();
    expect(result!.latestTrend).toBeGreaterThanOrEqual(1e9);
    expect(result!.qualified).toBe(false);
  });

  it('passes when both trend windows are flat (latestTrend 0, compression carries the verdict)', () => {
    const result = computeQuietMetrics(candles([
      [iso(0), 100, 0],
      [iso(1), 100, 0],
      [iso(2), 100, 0],
      [iso(3), 100, 0],
      [iso(4), 100, 0],
      [iso(5), 100, 0],
      [iso(6), 100, 0],
      [iso(7), 100, 0],
    ]), trendParams);
    expect(result).not.toBeNull();
    expect(result!.latestTrend).toBe(0);
    expect(result!.compression).toBe(0);
    expect(result!.qualified).toBe(true);
  });

  it('averages out a single wider bar: tr=2 rejects, tr=3 passes the same convergence', () => {
    // ONUSDT 4H @08-05 16:00 pattern: mostly narrow bars with one wider blip in
    // the trailing window. A 2-bar latest window makes that single bar flip the
    // verdict (latestTrend > 0.9); a 3-bar window averages it away (latestTrend
    // < 0.9) while compression still passes — the convergence is obvious.
    const bars = candles([
      [iso(0), 100, 0.02],
      [iso(1), 100, 0.02],
      [iso(2), 100, 0.02],
      [iso(3), 100, 0.02],
      [iso(4), 100, 0.004], // middle
      [iso(5), 100, 0.004],
      [iso(6), 100, 0.007], // wider blip
      [iso(7), 100, 0.004],
    ]);
    const common = { boxWindow: 4, maxCompression: 0.8, maxLatestTrend: 0.9 };
    const tr2 = computeQuietMetrics(bars, { ...common, trendWindow: 2 });
    const tr3 = computeQuietMetrics(bars, { ...common, trendWindow: 3 });
    expect(tr2).not.toBeNull();
    expect(tr3).not.toBeNull();
    expect(tr2!.compression).toBeLessThan(common.maxCompression);
    expect(tr2!.latestTrend).toBeGreaterThan(common.maxLatestTrend); // 1.375, rejected
    expect(tr2!.qualified).toBe(false);
    expect(tr3!.latestTrend).toBeLessThan(common.maxLatestTrend); // 0.34, passes
    expect(tr3!.qualified).toBe(true);
  });

  it('is scale-free: 0.5%/bar and 2%/bar narrow with the same latestTrend ratio', () => {
    const small = computeQuietMetrics(candles([
      [iso(0), 100, 0.02],
      [iso(1), 100, 0.02],
      [iso(2), 100, 0.02],
      [iso(3), 100, 0.02],
      [iso(4), 100, 0.008],
      [iso(5), 100, 0.008],
      [iso(6), 100, 0.0056],
      [iso(7), 100, 0.0056],
    ]), trendParams);
    const large = computeQuietMetrics(candles([
      [iso(0), 100, 0.08],
      [iso(1), 100, 0.08],
      [iso(2), 100, 0.08],
      [iso(3), 100, 0.08],
      [iso(4), 100, 0.032],
      [iso(5), 100, 0.032],
      [iso(6), 100, 0.0224],
      [iso(7), 100, 0.0224],
    ]), trendParams);
    expect(small).not.toBeNull();
    expect(large).not.toBeNull();
    expect(small!.latestTrend).toBeCloseTo(large!.latestTrend);
    expect(small!.latestTrend).toBeCloseTo(0.7);
    expect(small!.qualified).toBe(true);
    expect(large!.qualified).toBe(true);
  });
});

describe('Coin Scan score (sort key) and defaults', () => {
  it('score = compression + latestTrend', () => {
    const result = computeQuietMetrics(candles([
      [t[0], 100, 0.02],
      [t[1], 100, 0.02],
      [t[2], 100, 0.006], // compression 0.3, latestTrend 0.3
      [t[3], 100, 0.006],
    ]), { boxWindow: 2, trendWindow: 2 });
    expect(result).not.toBeNull();
    expect(result!.compression).toBeCloseTo(0.3);
    expect(result!.latestTrend).toBeCloseTo(0.3);
    expect(result!.score).toBeCloseTo(0.6);
  });

  it('sorts lower scores as stronger convergence (a flat coin ranks behind a compressed one)', () => {
    const flat = computeQuietMetrics(candles([
      [t[0], 100, 0.02],
      [t[1], 100, 0.02],
      [t[2], 100, 0.02],
      [t[3], 100, 0.02],
    ]), { boxWindow: 2, trendWindow: 2 });
    const compressed = computeQuietMetrics(candles([
      [t[0], 100, 0.02],
      [t[1], 100, 0.02],
      [t[2], 100, 0.006],
      [t[3], 100, 0.006],
    ]), { boxWindow: 2, trendWindow: 2 });
    expect(flat).not.toBeNull();
    expect(compressed).not.toBeNull();
    expect(flat!.score).toBeGreaterThan(compressed!.score);
  });

  it('exposes the pure-price and plateau defaults', () => {
    expect(DEFAULT_MAX_COMPRESSION).toBe(0.8);
    expect(DEFAULT_MAX_LATEST_TREND).toBe(0.9);
    expect(DEFAULT_TREND_WINDOW).toBe(3);
    expect(DEFAULT_PLATEAU_MIN).toBe(2);
    expect(PLATEAU_BOX_WINDOWS).toEqual([3, 4, 5, 6]);
  });

  it('falls back to thresholds and trendWindow when omitted', () => {
    // Default trendWindow 3: latest (bars 5..7 = 0.008/0.0056/
    // 0.0056, mean 0.0064) narrower than middle (bars 2..4 = 0.02/0.02/0.008,
    // mean 0.016) → latestTrend ≈ 0.4 < 0.9 while compression < 0.8.
    const result = computeQuietMetrics(candles([
      [iso(0), 100, 0.02],
      [iso(1), 100, 0.02],
      [iso(2), 100, 0.02],
      [iso(3), 100, 0.02],
      [iso(4), 100, 0.008],
      [iso(5), 100, 0.008],
      [iso(6), 100, 0.0056],
      [iso(7), 100, 0.0056],
    ]), { boxWindow: 4 });
    expect(result).not.toBeNull();
    expect(result!.compression).toBeLessThan(DEFAULT_MAX_COMPRESSION);
    expect(result!.latestTrend).toBeLessThan(DEFAULT_MAX_LATEST_TREND);
    expect(result!.qualified).toBe(true);
  });
});

describe('Gold-style 1D convergence (08-01..08-04 horizontal, amplitude narrowing)', () => {
  // Gold 1D 08-03/08-04: the price band is roughly horizontal (4040..4112) while
  // per-day amplitude narrows. After removing the volume gate, compression and
  // latestTrend alone qualify it with a small boxWindow (3 or 4), matching the
  // acceptance criteria for XAUUSDT 1D @08-03 and @08-04.
  it('qualifies with boxWindow 3', () => {
    const result = computeQuietMetrics(candles([
      [iso(0), 100, 0.012],
      [iso(1), 100, 0.012],
      [iso(2), 100, 0.012], // prior (compression)
      [iso(3), 100, 0.012],
      [iso(4), 100, 0.008],
      [iso(5), 100, 0.004],
      [iso(6), 100, 0.004], // recent + latest
    ]), { boxWindow: 3, trendWindow: 2 });
    expect(result).not.toBeNull();
    expect(result!.compression).toBeCloseTo((0.016 / 3) / 0.012, 5); // ≈ 0.444
    expect(result!.latestTrend).toBeCloseTo(0.004 / 0.01, 5); // 0.4
    expect(result!.qualified).toBe(true);
  });

  it('qualifies with boxWindow 4', () => {
    const result = computeQuietMetrics(candles([
      [iso(0), 100, 0.012],
      [iso(1), 100, 0.012],
      [iso(2), 100, 0.012],
      [iso(3), 100, 0.012], // prior (compression)
      [iso(4), 100, 0.005], // middle (latest-trend)
      [iso(5), 100, 0.005],
      [iso(6), 100, 0.004], // recent + latest
      [iso(7), 100, 0.004],
    ]), { boxWindow: 4, trendWindow: 2 });
    expect(result).not.toBeNull();
    expect(result!.compression).toBeCloseTo(0.0045 / 0.012, 5); // 0.375
    expect(result!.latestTrend).toBeCloseTo(0.8, 5);
    expect(result!.qualified).toBe(true);
  });
});

describe('Coin Scan plateau (multi-window consecutive convergence)', () => {
  const plateauParams = { maxCompression: 0.8, maxLatestTrend: 0.9, trendWindow: 3, plateauMin: 2 };

  function ampBars(amplitudes: number[]): Candlestick[] {
    return candles(amplitudes.map((amplitude, index) => [iso(index), 100, amplitude]));
  }

  it('qualifies when every plateau window compresses (step-narrowing tail)', () => {
    // bars 0..5 wide (0.02), 6..8 medium (0.01), 9..11 narrow (0.003). Every box
    // window 3..6 compresses against its prior and still narrows into the tail.
    const result = computePlateau(ampBars([0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.01, 0.01, 0.01, 0.003, 0.003, 0.003]), plateauParams);
    expect(result).not.toBeNull();
    expect(result!.windows.map((w) => w.boxWindow)).toEqual([3, 4, 5, 6]);
    expect(result!.windows.map((w) => w.qualified)).toEqual([true, true, true, true]);
    expect(result!.plateauWidth).toBe(4);
    expect(result!.qualified).toBe(true);
    // Best window = the qualified window with the smallest score. bw=3 is
    // degenerate (latestTrend == compression = 0.3) and its compression is the
    // most extreme, so it wins with score 0.6 (bw=4 scores 0.3167 + 0.3).
    expect(result!.bestBoxWindow).toBe(3);
    expect(result!.compression).toBeCloseTo(0.3, 5);
    expect(result!.latestTrend).toBeCloseTo(0.3, 5);
    expect(result!.score).toBeCloseTo(0.6, 5);
  });

  it('clamps tr(bw) = min(trendWindow, boxWindow): bw=3 collapses latest onto box', () => {
    // With the default trendWindow 3, bw=3 uses tr=3: the latest-trend windows
    // coincide with the box windows (latest == recent, middle == prior), so
    // latestTrend equals compression at bw=3 and the compression gate carries
    // it. This matches the case-library plateau ({3,4} for HYPE 1H): a 2-bar
    // latest window at bw=3 was too twitchy (HYPE 1H lt 0.905 > 0.9 with tr=2,
    // 0.669 == compression with tr=3).
    const result = computePlateau(ampBars([0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.01, 0.01, 0.01, 0.003, 0.003, 0.003]), plateauParams);
    expect(result).not.toBeNull();
    const bw3 = result!.windows[0];
    expect(bw3.boxWindow).toBe(3);
    expect(bw3.compression).toBeCloseTo(0.3, 5);
    expect(bw3.latestTrend).toBeCloseTo(bw3.compression, 5);
    expect(bw3.qualified).toBe(true);
  });

  it('counts consecutive qualified windows without merging gaps ([T,T,F,T] → width 2)', () => {
    // A wide blip at bar 7 (0.05) sits inside bw=5's recent window but is diluted
    // out of bw=6's larger window, so only bw=5 fails compression.
    const result = computePlateau(ampBars([0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.01, 0.05, 0.01, 0.01, 0.003, 0.003]), plateauParams);
    expect(result).not.toBeNull();
    expect(result!.windows.map((w) => w.qualified)).toEqual([true, true, false, true]);
    expect(result!.plateauWidth).toBe(2); // bw 3-4 run; bw 6 is not merged across the gap
    expect(result!.qualified).toBe(true); // 2 >= plateauMin 2
  });

  it('requires plateauMin consecutive windows to qualify', () => {
    const bars = ampBars([0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.01, 0.05, 0.01, 0.01, 0.003, 0.003]);
    const min2 = computePlateau(bars, { ...plateauParams, plateauMin: 2 });
    const min3 = computePlateau(bars, { ...plateauParams, plateauMin: 3 });
    expect(min2).not.toBeNull();
    expect(min3).not.toBeNull();
    expect(min2!.qualified).toBe(true);
    expect(min3!.qualified).toBe(false); // width 2 < plateauMin 3
  });

  it('selects the best window from the qualified windows by min score', () => {
    const result = computePlateau(ampBars([0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.01, 0.05, 0.01, 0.01, 0.003, 0.003]), plateauParams);
    expect(result).not.toBeNull();
    // Qualified windows: bw=3 (score 0.4571), bw=4 (0.4886), bw=6 (0.9453).
    // bw=3 wins: degenerate latestTrend == compression = (0.016/3)/(0.07/3).
    expect(result!.bestBoxWindow).toBe(3);
    expect(result!.compression).toBeCloseTo(0.016 / 0.07, 5); // ≈ 0.2286
    expect(result!.latestTrend).toBeCloseTo(0.016 / 0.07, 5);
    expect(result!.score).toBeCloseTo(2 * (0.016 / 0.07), 5);
  });

  it('plateauMin=1 degenerates to a single qualifying window', () => {
    // Only bw=3 compresses (a wide blip at bar 4 makes bw=4's recent not below
    // its prior); bw=5/6 lack history (8 bars < 2 * 5). Width is 1, so it only
    // qualifies when plateauMin = 1.
    const bars = ampBars([0.01, 0.01, 0.01, 0.01, 0.05, 0.004, 0.004, 0.004]);
    const min1 = computePlateau(bars, { ...plateauParams, plateauMin: 1 });
    const min2 = computePlateau(bars, { ...plateauParams, plateauMin: 2 });
    expect(min1).not.toBeNull();
    expect(min2).not.toBeNull();
    expect(min1!.windows.map((w) => w.qualified)).toEqual([true, false, false, false]);
    expect(min1!.plateauWidth).toBe(1);
    expect(min1!.qualified).toBe(true);
    expect(min2!.qualified).toBe(false);
    expect(min1!.bestBoxWindow).toBe(3);
  });

  it('lets small box windows qualify when larger ones lack history', () => {
    // 8 completed bars: bw=3 and bw=4 compute and qualify; bw=5 (needs 10) and
    // bw=6 (needs 12) are null, and a null window never breaks the run.
    const result = computePlateau(ampBars([0.02, 0.02, 0.02, 0.02, 0.02, 0.01, 0.004, 0.004]), plateauParams);
    expect(result).not.toBeNull();
    expect(result!.windows.map((w) => w.qualified)).toEqual([true, true, false, false]);
    expect(result!.plateauWidth).toBe(2);
    expect(result!.qualified).toBe(true);
    expect(result!.bestBoxWindow).toBe(3);
  });

  it('returns null when no box window can be computed', () => {
    // 4 bars is fewer than 2 * 3 (the smallest plateau window).
    expect(computePlateau(ampBars([0.02, 0.02, 0.02, 0.02]), plateauParams)).toBeNull();
  });

  it('returns null when a price is non-positive', () => {
    const bars = ampBars([0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.01, 0.01, 0.01, 0.003, 0.003, 0.003]);
    bars[5] = { ...bars[5], low: 0, high: 0 };
    expect(computePlateau(bars, plateauParams)).toBeNull();
  });
});
