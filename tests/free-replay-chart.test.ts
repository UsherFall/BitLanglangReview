import { describe, expect, it } from 'vitest';
import type { Candlestick } from '../src/domain/candlestick';
import { nextFreeReplayCursor, previousFreeReplayCursor, shouldPrefetchFutureCandles, visibleCandlesForFreeReplay } from '../src/ui/free-replay-chart';

describe('Free Replay Chart', () => {
  it('shows candlesticks through the free replay cursor and hides future candlesticks', () => {
    const candles = [
      makeCandle('2024-05-21T09:50:00+08:00'),
      makeCandle('2024-05-21T09:55:00+08:00'),
      makeCandle('2024-05-21T10:00:00+08:00'),
      makeCandle('2024-05-21T10:05:00+08:00'),
    ];

    expect(visibleCandlesForFreeReplay(candles, Date.parse('2024-05-21T10:00:00+08:00') / 1000).map((candle) => candle.timestamp)).toEqual([
      Date.parse('2024-05-21T09:50:00+08:00'),
      Date.parse('2024-05-21T09:55:00+08:00'),
      Date.parse('2024-05-21T10:00:00+08:00'),
    ]);
  });

  it('reveals the next loaded candlestick', () => {
    const candles = [
      makeCandle('2024-05-21T10:00:00+08:00'),
      makeCandle('2024-05-21T10:05:00+08:00'),
      makeCandle('2024-05-21T10:10:00+08:00'),
    ];

    expect(nextFreeReplayCursor(candles, Date.parse('2024-05-21T10:00:00+08:00') / 1000)).toBe(Date.parse('2024-05-21T10:05:00+08:00') / 1000);
  });

  it('rewinds to the previous loaded candlestick without moving before the start cursor', () => {
    const candles = [
      makeCandle('2024-05-21T10:00:00+08:00'),
      makeCandle('2024-05-21T10:05:00+08:00'),
      makeCandle('2024-05-21T10:10:00+08:00'),
    ];
    const startCursor = Date.parse('2024-05-21T10:00:00+08:00') / 1000;

    expect(previousFreeReplayCursor(candles, Date.parse('2024-05-21T10:10:00+08:00') / 1000, startCursor)).toBe(Date.parse('2024-05-21T10:05:00+08:00') / 1000);
    expect(previousFreeReplayCursor(candles, startCursor, startCursor)).toBe(startCursor);
  });

  it('prefetches more future candlesticks before the hidden buffer is exhausted', () => {
    const candles = [
      makeCandle('2024-05-21T10:00:00+08:00'),
      makeCandle('2024-05-21T10:05:00+08:00'),
      makeCandle('2024-05-21T10:10:00+08:00'),
    ];

    expect(shouldPrefetchFutureCandles(candles, Date.parse('2024-05-21T10:05:00+08:00') / 1000, 1)).toBe(true);
    expect(shouldPrefetchFutureCandles(candles, Date.parse('2024-05-21T10:00:00+08:00') / 1000, 1)).toBe(false);
  });
});

function makeCandle(time: string): Candlestick {
  return {
    instrument: 'BTC-USDT-SWAP',
    timeframe: '5m',
    timestamp: Date.parse(time),
    open: 1,
    high: 2,
    low: 0.5,
    close: 1.5,
    volume: 10,
  };
}
