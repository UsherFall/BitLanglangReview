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

export function hoverPricePercentage(pointerPrice: number | null | undefined, baselinePrice: number | null | undefined): number | null {
  if (!isPositiveFinite(baselinePrice) || !isFiniteNumber(pointerPrice)) return null;
  return (pointerPrice - baselinePrice) / baselinePrice * 100;
}

export function formatHoverPricePercentage(value: number): string {
  const normalized = Object.is(value, -0) ? 0 : value;
  return `${normalized >= 0 ? '+' : ''}${normalized.toFixed(2)}%`;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveFinite(value: number | null | undefined): value is number {
  return isFiniteNumber(value) && value > 0;
}
