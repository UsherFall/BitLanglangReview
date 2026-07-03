import { describe, expect, it } from 'vitest';
import type { Candlestick } from '../src/domain/candlestick';
import { candlestickAtTime, formatCandlestickPrice } from '../src/ui/candlestick-readout';

describe('Candlestick Readout', () => {
  it('finds the candlestick under the chart crosshair time', () => {
    const candles = [makeCandle('2024-05-21T00:00:00+08:00'), makeCandle('2024-05-21T00:05:00+08:00')];

    expect(candlestickAtTime(candles, (Date.parse('2024-05-21T00:05:00+08:00') / 1000) as never)).toBe(candles[1]);
  });

  it('does not show prices for whitespace padding or an empty crosshair time', () => {
    const candles = [makeCandle('2024-05-21T00:00:00+08:00')];

    expect(candlestickAtTime(candles, (Date.parse('2024-05-21T00:10:00+08:00') / 1000) as never)).toBeNull();
    expect(candlestickAtTime(candles, undefined)).toBeNull();
  });

  it('keeps useful precision without unnecessary trailing zeros', () => {
    expect(formatCandlestickPrice(60345)).toBe('60,345');
    expect(formatCandlestickPrice(0.123456789)).toBe('0.12345679');
  });
});

function makeCandle(time: string): Candlestick {
  return {
    instrument: 'ETH-USDT-SWAP',
    timeframe: '5m',
    timestamp: Date.parse(time),
    open: 1,
    high: 2,
    low: 0.5,
    close: 1.5,
    volume: 1,
  };
}
