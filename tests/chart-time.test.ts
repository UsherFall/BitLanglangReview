import { describe, expect, it } from 'vitest';
import type { Candlestick } from '../src/domain/candlestick';
import { formatChartTime, freeReplayCursorTimeForStart, freeReplayCursorTimeForTimeframeSwitch, markerTimeForEvent, timeframeTimeForPoint } from '../src/ui/chart-time';

describe('Chart Time', () => {
  it('places a trade point on the review timeframe candlestick that contains it', () => {
    const candles: Candlestick[] = [
      makeCandle('2024-05-21T00:00:00+08:00'),
      makeCandle('2024-05-21T04:00:00+08:00'),
      makeCandle('2024-05-21T08:00:00+08:00'),
    ];

    expect(markerTimeForEvent('2024-05-21T01:17:00.000+08:00', '4H', candles)).toBe(Date.parse('2024-05-21T00:00:00+08:00') / 1000);
    expect(markerTimeForEvent('2024-05-21T05:30:00.000+08:00', '4H', candles)).toBe(Date.parse('2024-05-21T04:00:00+08:00') / 1000);
  });

  it('shows full dates on daily timeframe tick labels', () => {
    expect(formatChartTime((Date.parse('2024-05-21T00:00:00+08:00') / 1000) as never, '1D')).toBe('2024-05-21');
  });

  it('places a trade point on the daily candlestick that contains it', () => {
    const candles: Candlestick[] = [
      { ...makeCandle('2024-05-21T00:00:00+08:00'), timeframe: '1D' },
      { ...makeCandle('2024-05-22T00:00:00+08:00'), timeframe: '1D' },
    ];

    expect(markerTimeForEvent('2024-05-21T01:17:00.000+08:00', '1D', candles)).toBe(Date.parse('2024-05-21T00:00:00+08:00') / 1000);
  });

  it('does not pin a trade point after the loaded range to the last loaded candlestick', () => {
    const candles: Candlestick[] = [
      makeCandle('2024-05-21T00:00:00+08:00'),
      makeCandle('2024-05-21T04:00:00+08:00'),
    ];

    expect(markerTimeForEvent('2024-05-21T08:30:00.000+08:00', '4H', candles)).toBe(Date.parse('2024-05-21T08:00:00+08:00') / 1000);
  });

  it('places drawing point times on the active review timeframe candlestick', () => {
    const candles: Candlestick[] = [
      makeCandle('2024-05-21T00:00:00+08:00'),
      makeCandle('2024-05-21T04:00:00+08:00'),
    ];

    expect(timeframeTimeForPoint(Date.parse('2024-05-21T01:17:00.000+08:00') / 1000, '4H', candles)).toBe(Date.parse('2024-05-21T00:00:00+08:00') / 1000);
  });

  it('places a free replay start minute on the containing review timeframe candlestick', () => {
    expect(freeReplayCursorTimeForStart('2024-05-21T10:07:00+08:00', '15m')).toBe(Date.parse('2024-05-21T10:00:00+08:00') / 1000);
    expect(freeReplayCursorTimeForStart('2024-05-21T10:07:00+08:00', '1H')).toBe(Date.parse('2024-05-21T10:00:00+08:00') / 1000);
  });

  it('places the free replay cursor on the containing candlestick when switching review timeframes', () => {
    const previousCursor = Date.parse('2024-05-21T10:35:00+08:00') / 1000;

    expect(freeReplayCursorTimeForTimeframeSwitch(previousCursor, '15m')).toBe(Date.parse('2024-05-21T10:30:00+08:00') / 1000);
    expect(freeReplayCursorTimeForTimeframeSwitch(previousCursor, '1H')).toBe(Date.parse('2024-05-21T10:00:00+08:00') / 1000);
  });
});

function makeCandle(time: string): Candlestick {
  return {
    instrument: 'ETH-USDT-SWAP',
    timeframe: '4H',
    timestamp: Date.parse(time),
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 1,
  };
}
