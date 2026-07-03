import type { Candlestick } from '../domain/candlestick';

export function visibleCandlesForFreeReplay(candles: Candlestick[], cursorTime: number): Candlestick[] {
  const cursorTimestamp = cursorTime * 1000;
  return candles.filter((candle) => candle.timestamp <= cursorTimestamp);
}

export function nextFreeReplayCursor(candles: Candlestick[], cursorTime: number): number {
  const cursorTimestamp = cursorTime * 1000;
  const next = [...candles].sort((a, b) => a.timestamp - b.timestamp).find((candle) => candle.timestamp > cursorTimestamp);
  return next ? next.timestamp / 1000 : cursorTime;
}

export function previousFreeReplayCursor(candles: Candlestick[], cursorTime: number, startCursorTime: number): number {
  if (cursorTime <= startCursorTime) return startCursorTime;
  const cursorTimestamp = cursorTime * 1000;
  const previous = [...candles].sort((a, b) => b.timestamp - a.timestamp).find((candle) => candle.timestamp < cursorTimestamp);
  return Math.max(previous ? previous.timestamp / 1000 : startCursorTime, startCursorTime);
}

export function shouldPrefetchFutureCandles(candles: Candlestick[], cursorTime: number, threshold: number): boolean {
  const ordered = [...candles].sort((a, b) => a.timestamp - b.timestamp);
  const cursorIndex = ordered.findIndex((candle) => candle.timestamp === cursorTime * 1000);
  if (cursorIndex < 0) return false;
  return ordered.length - cursorIndex - 1 <= threshold;
}
