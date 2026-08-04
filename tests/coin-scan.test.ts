import { describe, expect, it } from 'vitest';
import type { Candlestick } from '../src/domain/candlestick';
import { computeShrinkMetrics } from '../src/domain/coin-scan';

function makeCandle(iso: string, volume: number): Candlestick {
  return {
    instrument: 'BTC-USDT-SWAP',
    timeframe: '5m',
    timestamp: Date.parse(iso),
    open: 100,
    high: 100,
    low: 100,
    close: 100,
    volume,
  };
}

function volumes(entries: Array<[string, number]>): Candlestick[] {
  return entries.map(([iso, volume]) => makeCandle(iso, volume));
}

const params = { ratioThreshold: 0.7, consecutive: 3, window: 4 };
const base = [
  '2024-05-21T00:00:00+08:00',
  '2024-05-21T00:05:00+08:00',
  '2024-05-21T00:10:00+08:00',
  '2024-05-21T00:15:00+08:00',
  '2024-05-21T00:20:00+08:00',
  '2024-05-21T00:25:00+08:00',
  '2024-05-21T00:30:00+08:00',
];

describe('Coin Scan shrink metrics', () => {
  it('computes ratio as the last candle volume over its preceding window average', () => {
    // Sliding window of 4; trailing 50s give ratios 0.2 / 0.2105 / 0.25.
    const candles = volumes([
      [base[0], 100],
      [base[1], 200],
      [base[2], 300],
      [base[3], 400],
      [base[4], 50],
      [base[5], 50],
      [base[6], 50],
    ]);
    const result = computeShrinkMetrics(candles, params);
    expect(result).not.toBeNull();
    expect(result!.currentVolume).toBe(50);
    expect(result!.averageVolume).toBe((300 + 400 + 50 + 50) / 4);
    expect(result!.ratio).toBeCloseTo(50 / 200);
    expect(result!.intensity).toBeCloseTo((0.2 + 50 / 237.5 + 0.25) / 3);
  });

  it('qualifies when the trailing consecutive ratios are all below the threshold', () => {
    const candles = volumes([
      [base[0], 100],
      [base[1], 100],
      [base[2], 100],
      [base[3], 100],
      [base[4], 20], // ratio 0.2
      [base[5], 30], // ratio 30/80 = 0.375
      [base[6], 25], // ratio 25/62.5 = 0.4
    ]);
    const result = computeShrinkMetrics(candles, params);
    expect(result).not.toBeNull();
    expect(result!.consecutiveShrunk).toBe(3);
    expect(result!.qualified).toBe(true);
    expect(result!.intensity).toBeCloseTo((0.2 + 0.375 + 0.4) / 3);
  });

  it('does not qualify when one trailing ratio is above the threshold', () => {
    const candles = volumes([
      [base[0], 100],
      [base[1], 100],
      [base[2], 100],
      [base[3], 100],
      [base[4], 20], // ratio 0.2
      [base[5], 30], // ratio 0.375
      [base[6], 90], // ratio 90/62.5 = 1.44 breaks the streak
    ]);
    const result = computeShrinkMetrics(candles, params);
    expect(result).not.toBeNull();
    expect(result!.consecutiveShrunk).toBe(0);
    expect(result!.qualified).toBe(false);
    expect(result!.intensity).toBeCloseTo((0.2 + 0.375 + 1.44) / 3);
  });

  it('returns null with fewer than window + consecutive candlesticks', () => {
    const candles = volumes([
      [base[0], 100],
      [base[1], 100],
      [base[2], 100],
      [base[3], 100],
      [base[4], 20],
      [base[5], 30],
    ]);
    expect(computeShrinkMetrics(candles, params)).toBeNull();
  });

  it('sorts candles ascending by timestamp regardless of input order', () => {
    const candles = volumes([
      [base[2], 300],
      [base[0], 100],
      [base[3], 400],
      [base[1], 200],
      [base[4], 50],
      [base[6], 50],
      [base[5], 50],
    ]);
    const result = computeShrinkMetrics(candles, params);
    expect(result).not.toBeNull();
    expect(result!.ratio).toBeCloseTo(0.25);
  });

  it('returns null when a window average is zero', () => {
    const candles = volumes([
      [base[0], 0],
      [base[1], 0],
      [base[2], 0],
      [base[3], 0],
      [base[4], 10],
      [base[5], 20],
      [base[6], 30],
    ]);
    expect(computeShrinkMetrics(candles, params)).toBeNull();
  });
});
