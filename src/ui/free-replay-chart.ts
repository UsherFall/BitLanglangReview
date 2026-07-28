import type { Candlestick } from '../domain/candlestick';
import type { ReviewTimeframe } from '../domain/trade';
import { freeReplayCandleCompletionTime } from './chart-time';

export function visibleCandlesForFreeReplay(candles: Candlestick[], cursorTime: number): Candlestick[] {
  const cursorTimestamp = cursorTime * 1000;
  return candles.filter((candle) => candle.timestamp <= cursorTimestamp);
}

export function nextFreeReplayCursor(candles: Candlestick[], cursorTime: number): number {
  const cursorTimestamp = cursorTime * 1000;
  const next = [...candles].sort((a, b) => a.timestamp - b.timestamp).find((candle) => candle.timestamp > cursorTimestamp);
  return next ? next.timestamp / 1000 : cursorTime;
}

export function nextFreeReplayProgress(candles: Candlestick[], cursorTime: number, progressTime: number, timeframe: ReviewTimeframe): { cursorTime: number; progressTime: number } {
  const nextCursorTime = nextFreeReplayCursor(candles, cursorTime);
  if (nextCursorTime === cursorTime) return { cursorTime, progressTime };
  return {
    cursorTime: nextCursorTime,
    progressTime: freeReplayCandleCompletionTime(nextCursorTime, timeframe),
  };
}

export function previousFreeReplayCursor(candles: Candlestick[], cursorTime: number, startCursorTime: number): number {
  if (cursorTime <= startCursorTime) return startCursorTime;
  const cursorTimestamp = cursorTime * 1000;
  const previous = [...candles].sort((a, b) => b.timestamp - a.timestamp).find((candle) => candle.timestamp < cursorTimestamp);
  return Math.max(previous ? previous.timestamp / 1000 : startCursorTime, startCursorTime);
}

export function previousFreeReplayProgress(cursorTime: number): number {
  return cursorTime;
}

export function shouldPrefetchFutureCandles(candles: Candlestick[], cursorTime: number, threshold: number): boolean {
  const ordered = [...candles].sort((a, b) => a.timestamp - b.timestamp);
  const cursorIndex = ordered.findIndex((candle) => candle.timestamp >= cursorTime * 1000);
  if (cursorIndex < 0) return false;
  return ordered.length - cursorIndex - 1 <= threshold;
}
