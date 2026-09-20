import type { Candlestick } from '../domain/candlestick';
import type { ChartPoint } from '../domain/drawing';
import type { ReviewTimeframe } from '../domain/trade';
import { containingCandleTimestamp } from './chart-time';

/**
 * How strongly a drawing point snaps to the candlestick under the pointer.
 * Mirrors klinecharts' `OverlayMode` (`normal | weak_magnet | strong_magnet`).
 */
export type MagnetMode = 'off' | 'weak' | 'strong';

/** Pixel radius of a `weak` snap outside `[low, high]`; klinecharts `modeSensitivity` default. */
export const DEFAULT_MAGNET_SENSITIVITY = 8;

export type SnapDrawingPointInput = {
  /** Raw pointer point (`coordinateToTime` / `coordinateToPrice` results); `time` in seconds. */
  point: ChartPoint;
  /** Pointer y inside the overlay, used to pick the closest OHLC pixel-wise. */
  pointerY: number;
  candles: Candlestick[];
  timeframe: ReviewTimeframe;
  mode: MagnetMode;
  /** Pixel threshold for `weak` snaps outside `[low, high]`. */
  sensitivity?: number;
  /** Price → pixel y; `null` means the candidate cannot be converted and is dropped. */
  priceToY: (price: number) => number | null;
};

/** Toolbar cycling order: weak → strong → off → weak. */
export function nextMagnetMode(mode: MagnetMode): MagnetMode {
  if (mode === 'weak') return 'strong';
  if (mode === 'strong') return 'off';
  return 'weak';
}

/**
 * Snap a raw drawing point onto the candlestick under the pointer.
 *
 * The pointer time is always attributed to the candlestick that contains it
 * (`containingCandleTimestamp`), and the price is taken from whichever of that
 * candlestick's `open` / `high` / `low` / `close` is closest in **pixels**.
 *
 * Weak mode only uses the pixel threshold when the pointer price is outside
 * `[low, high]`; inside the range it snaps unconditionally, exactly like
 * klinecharts. Every failure path returns the input point unchanged (never a
 * partial point, never `NaN`).
 */
export function snapDrawingPoint(input: SnapDrawingPointInput): ChartPoint {
  const { point, pointerY, candles, timeframe, mode, sensitivity = DEFAULT_MAGNET_SENSITIVITY, priceToY } = input;
  if (mode === 'off') return point;

  const containingTimestamp = containingCandleTimestamp(point.time * 1000, timeframe, candles);
  if (containingTimestamp === null) return point;
  const candle = candles.find((item) => item.timestamp === containingTimestamp);
  if (!candle) return point;

  const time = Math.floor(containingTimestamp / 1000);

  const candidates: { price: number; y: number }[] = [];
  for (const price of [candle.open, candle.high, candle.low, candle.close]) {
    const y = priceToY(price);
    // Drop candidates the chart cannot place; a non-finite y would poison the
    // distance comparison and could leak `NaN` into the drawing point.
    if (y === null || !Number.isFinite(y)) continue;
    candidates.push({ price, y });
  }
  if (!candidates.length) return { time, price: point.price };

  let nearest = candidates[0];
  let nearestDistance = Math.abs(nearest.y - pointerY);
  for (const candidate of candidates.slice(1)) {
    const distance = Math.abs(candidate.y - pointerY);
    // Strict `<` keeps the earlier field (open before high/low/close) on ties.
    if (distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }

  // Inside `[low, high]` the snap is unconditional; outside it, weak mode needs
  // the nearest OHLC to be within the pixel threshold.
  const insideRange = candle.low <= point.price && point.price <= candle.high;
  if (mode === 'strong' || insideRange || nearestDistance <= sensitivity) {
    return { time, price: nearest.price };
  }

  return { time, price: point.price };
}
