import { describe, expect, it } from 'vitest';
import type { Candlestick } from '../src/domain/candlestick';
import { computeQuietMetrics } from '../src/domain/coin-scan';

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

function candles(entries: Array<[string, number, number]>): Candlestick[] {
  return entries.map(([iso, volume, amplitude]) => makeCandle(iso, volume, amplitude));
}

const params = { ratioThreshold: 0.7, volatilityThreshold: 0.7, consecutive: 2, window: 2 };
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
    expect(result!.qualified).toBe(true);
    expect(result!.intensity).toBeCloseTo((0.5 + (40 / 75 + 0.008 / 0.015) / 2) / 2);
  });

  it('does not qualify when one trailing bar has a wide amplitude', () => {
    const result = computeQuietMetrics(candles([
      [t[0], 100, 0.02],
      [t[1], 100, 0.02],
      [t[2], 50, 0.01], // calm
      [t[3], 40, 0.05], // ampRatio 0.05/0.015 = 3.33 breaks calm
    ]), params);
    expect(result).not.toBeNull();
    expect(result!.consecutiveQuiet).toBe(0);
    expect(result!.qualified).toBe(false);
  });

  it('returns null with fewer than window + consecutive candlesticks', () => {
    expect(computeQuietMetrics(candles([
      [t[0], 100, 0.02],
      [t[1], 100, 0.02],
      [t[2], 50, 0.01],
    ]), params)).toBeNull();
  });

  it('returns null when a volume window average is zero', () => {
    expect(computeQuietMetrics(candles([
      [t[0], 0, 0.02],
      [t[1], 0, 0.02],
      [t[2], 10, 0.01],
      [t[3], 10, 0.01],
    ]), params)).toBeNull();
  });

  it('treats a zero-amplitude baseline with a flat current bar as calm', () => {
    const result = computeQuietMetrics(candles([
      [t[0], 100, 0],
      [t[1], 100, 0],
      [t[2], 50, 0],
      [t[3], 40, 0],
    ]), params);
    expect(result).not.toBeNull();
    expect(result!.amplitudeRatio).toBe(0);
    expect(result!.consecutiveQuiet).toBe(2);
    expect(result!.qualified).toBe(true);
  });

  it('marks a zero-amplitude baseline with a moving current bar as not calm', () => {
    const result = computeQuietMetrics(candles([
      [t[0], 100, 0],
      [t[1], 100, 0],
      [t[2], 50, 0],
      [t[3], 40, 0.01],
    ]), params);
    expect(result).not.toBeNull();
    expect(result!.amplitudeRatio).toBeGreaterThan(0.7);
    expect(result!.consecutiveQuiet).toBe(0);
    expect(result!.qualified).toBe(false);
  });
});
