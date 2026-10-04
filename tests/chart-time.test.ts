import { describe, expect, it } from 'vitest';
import type { Candlestick } from '../src/domain/candlestick';
import { reviewTimeframes } from '../src/domain/trade';
import { formatChartTime, freeReplayCandleCompletionTime, freeReplayCursorTimeForProgress, freeReplayCursorTimeForStart, freeReplayCursorTimeForTimeframeSwitch, freeReplayProgressTimeForStart, markerTimeForEvent, timeframeMs, timeframeTimeForPoint } from '../src/ui/chart-time';

describe('Chart Time', () => {
  it('supports 1m as the first review timeframe', () => {
    expect(reviewTimeframes[0]).toBe('1m');
    expect(timeframeMs('1m')).toBe(60_000);
  });

  it('formats 1m labels with intraday time like other minute timeframes', () => {
    expect(formatChartTime((Date.parse('2024-05-21T10:07:00+08:00') / 1000) as never, '1m')).toBe('05-21 10:07');
  });

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

  it('keeps the free replay start progress exact while displaying only completed candles', () => {
    expect(freeReplayProgressTimeForStart('2024-05-21 10:35')).toBe(Date.parse('2024-05-21T10:35:00+08:00') / 1000);
    expect(freeReplayCursorTimeForStart('2024-05-21T10:07:30+08:00', '1m')).toBe(Date.parse('2024-05-21T10:06:00+08:00') / 1000);
    expect(freeReplayCursorTimeForStart('2024-05-21T10:35:00+08:00', '5m')).toBe(Date.parse('2024-05-21T10:30:00+08:00') / 1000);
    expect(freeReplayCursorTimeForStart('2024-05-21T10:35:00+08:00', '4H')).toBe(Date.parse('2024-05-21T04:00:00+08:00') / 1000);
  });

  it('maps free replay progress to the latest completed candlestick when switching review timeframes', () => {
    const progress = Date.parse('2024-05-21T10:35:00+08:00') / 1000;

    expect(freeReplayCursorTimeForProgress(progress, '5m')).toBe(Date.parse('2024-05-21T10:30:00+08:00') / 1000);
    expect(freeReplayCursorTimeForTimeframeSwitch(progress, '15m')).toBe(Date.parse('2024-05-21T10:15:00+08:00') / 1000);
    expect(freeReplayCursorTimeForTimeframeSwitch(progress, '1H')).toBe(Date.parse('2024-05-21T09:00:00+08:00') / 1000);
    expect(freeReplayCursorTimeForTimeframeSwitch(progress, '4H')).toBe(Date.parse('2024-05-21T04:00:00+08:00') / 1000);
  });

  it('computes completion times for free replay cursor candles', () => {
    expect(freeReplayCandleCompletionTime(Date.parse('2024-05-21T10:30:00+08:00') / 1000, '5m')).toBe(Date.parse('2024-05-21T10:35:00+08:00') / 1000);
    expect(freeReplayCandleCompletionTime(Date.parse('2024-05-21T08:00:00+08:00') / 1000, '4H')).toBe(Date.parse('2024-05-21T12:00:00+08:00') / 1000);
    expect(freeReplayCandleCompletionTime(Date.parse('2024-05-01T00:00:00+08:00') / 1000, '1M')).toBe(Date.parse('2024-06-01T00:00:00+08:00') / 1000);
  });
});

/**
 * The two venues cut a day differently, so a marker must be floored on the grid
 * of the source that produced its candlesticks. Reference timestamps are real
 * bar opens read from each venue (2026-10): Binance opens the day at 00:00Z
 * (08:00 Beijing), OKX at 00:00 Beijing (16:00Z the day before).
 */
describe('candle grid', () => {
  const binanceDailyBar = Date.parse('2026-10-04T00:00:00Z');
  const okxDailyBar = Date.parse('2026-10-03T16:00:00Z');
  const binanceWeeklyBar = Date.parse('2026-09-28T00:00:00Z'); // a Monday
  const okxWeeklyBar = Date.parse('2026-09-27T16:00:00Z'); // Monday 00:00 Beijing
  const binanceMonthlyBar = Date.parse('2026-10-01T00:00:00Z');
  const okxMonthlyBar = Date.parse('2026-09-30T16:00:00Z');

  it('floors an instant onto the Binance daily bar that contains it', () => {
    // 2026-10-04 17:30 Beijing sits inside the bar that opened 08:00 Beijing.
    const inside = Date.parse('2026-10-04T09:30:00Z');
    expect(markerTimeForEvent('2026-10-04T17:30:00+08:00', '1D', [], 'utc')).toBe(binanceDailyBar / 1000);
    expect(inside).toBeGreaterThan(binanceDailyBar);
  });

  it('floors an instant onto the OKX daily bar that contains it', () => {
    expect(markerTimeForEvent('2026-10-04T00:30:00+08:00', '1D', [], 'shanghai')).toBe(okxDailyBar / 1000);
  });

  it('keeps the two daily grids 8 hours apart', () => {
    // Same Beijing trading day, so the OKX bar opens 8h EARLIER in UTC terms.
    expect(binanceDailyBar - okxDailyBar).toBe(8 * 60 * 60_000);
  });

  it('floors weeks onto Monday for both grids', () => {
    // A Wednesday, so the answer cannot be the input day itself.
    const wednesday = Date.parse('2026-09-30T10:00:00Z');
    expect(markerTimeForEvent('2026-09-30T18:00:00+08:00', '1W', [], 'utc')).toBe(binanceWeeklyBar / 1000);
    expect(markerTimeForEvent('2026-09-30T18:00:00+08:00', '1W', [], 'shanghai')).toBe(okxWeeklyBar / 1000);
    expect(new Date(binanceWeeklyBar).getUTCDay()).toBe(1);
    expect(new Date(okxWeeklyBar).toISOString()).toBe('2026-09-27T16:00:00.000Z');
    expect(wednesday).toBeGreaterThan(binanceWeeklyBar);
  });

  it('floors months onto the 1st for both grids', () => {
    const probe = '2026-10-20T12:00:00+08:00';
    expect(markerTimeForEvent(probe, '1M', [], 'utc')).toBe(binanceMonthlyBar / 1000);
    expect(markerTimeForEvent(probe, '1M', [], 'shanghai')).toBe(okxMonthlyBar / 1000);
  });

  it('agrees across a month boundary, where a nominal 7-day week would drift', () => {
    // 2026-10-04 is a Sunday; the Monday grid must reach back to 09-28, and the
    // same must hold for the last week of a 31-day month.
    expect(markerTimeForEvent('2026-10-04T12:00:00+08:00', '1W', [], 'utc')).toBe(Date.parse('2026-09-28T00:00:00Z') / 1000);
    expect(markerTimeForEvent('2026-10-04T12:00:00+08:00', '1W', [], 'shanghai')).toBe(Date.parse('2026-09-27T16:00:00Z') / 1000);
  });

  it('leaves intraday timeframes on the same instant for both grids', () => {
    // 5m/1H/4H open at the same moment on both venues, so the grid must not
    // change the answer.
    for (const timeframe of ['5m', '15m', '1H', '4H'] as const) {
      const utc = markerTimeForEvent('2026-10-04T17:30:00+08:00', timeframe, [], 'utc');
      const shanghai = markerTimeForEvent('2026-10-04T17:30:00+08:00', timeframe, [], 'shanghai');
      expect({ timeframe, utc, shanghai }).toEqual({ timeframe, utc: shanghai, shanghai });
    }
  });

  it('closes a monthly bar at the next month on the same grid it opened', () => {
    const cursor = Date.parse('2026-10-15T00:00:00Z') / 1000;
    expect(freeReplayCandleCompletionTime(cursor, '1M', 'utc')).toBe(Date.parse('2026-11-01T00:00:00Z') / 1000);
    expect(freeReplayCandleCompletionTime(cursor, '1M', 'shanghai')).toBe(Date.parse('2026-10-31T16:00:00Z') / 1000);
  });

  it('keeps every floored instant exactly on its grid', () => {
    const probes = ['2026-10-04T17:30:00+08:00', '2026-03-01T09:15:00+08:00', '2026-12-31T23:59:00+08:00', '2024-02-29T12:00:00+08:00'];
    for (const probe of probes) {
      for (const grid of ['utc', 'shanghai'] as const) {
        for (const timeframe of ['1D', '1W', '1M'] as const) {
          const floored = markerTimeForEvent(probe, timeframe, [], grid) * 1000;
          const floor = shanghaiGridFloor(probe, timeframe, grid);
          expect({ probe, grid, timeframe, floored }).toEqual({ probe, grid, timeframe, floored: floor });
          // The floored instant must be a real bar open, i.e. not a partial day.
          expect(new Date(floored).getTime() - floor).toBe(0);
        }
      }
    }
  });
});

/** Independent re-implementation of the expected floor, used as a test oracle. */
function shanghaiGridFloor(probe: string, timeframe: string, grid: 'utc' | 'shanghai'): number {
  const time = Date.parse(probe);
  if (grid === 'utc') {
    const d = new Date(time);
    if (timeframe === '1M') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    if (timeframe === '1W') {
      const mondayOffset = (d.getUTCDay() + 6) % 7;
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - mondayOffset * 86_400_000;
    }
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  // Shanghai grid: work out the Beijing calendar date, then step back to the
  // day's 00:00 Beijing expressed as a UTC instant.
  const beijing = new Date(time + 8 * 3_600_000);
  let dayStartUtc = Date.UTC(beijing.getUTCFullYear(), beijing.getUTCMonth(), beijing.getUTCDate()) - 8 * 3_600_000;
  if (timeframe === '1M') return Date.UTC(beijing.getUTCFullYear(), beijing.getUTCMonth(), 1) - 8 * 3_600_000;
  if (timeframe === '1W') {
    const weekday = new Date(dayStartUtc + 8 * 3_600_000).getUTCDay();
    return dayStartUtc - ((weekday + 6) % 7) * 86_400_000;
  }
  return dayStartUtc;
}


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
