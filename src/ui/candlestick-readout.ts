import type { Candlestick } from '../domain/candlestick';
import type { Time } from 'lightweight-charts';

export function candlestickAtTime(candles: Candlestick[], time: Time | null | undefined): Candlestick | null {
  if (typeof time !== 'number') return null;
  const timestamp = time * 1000;
  return candles.find((candle) => candle.timestamp === timestamp) ?? null;
}

export function formatCandlestickPrice(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 8 });
}
