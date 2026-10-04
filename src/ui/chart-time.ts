import type { Time, UTCTimestamp } from 'lightweight-charts';
import type { Candlestick } from '../domain/candlestick';
import type { ReviewTimeframe } from '../domain/trade';

/**
 * Which exchange's daily boundary the review timeframes follow.
 *
 * The two venues cut a day differently, and intraday timeframes do not care
 * (`5m` opens on the same instant either way), so this only moves `1D` / `1W` /
 * `1M`:
 *
 * - `utc` — Binance USDT-M. A day starts at 00:00Z = 08:00 Beijing.
 * - `shanghai` — OKX. A day starts at 00:00 Beijing = 16:00Z the day before.
 *
 * Callers must pass the grid of the source that produced their candlesticks;
 * flooring against the wrong grid puts markers between bars and shifts the
 * review window by 8 hours.
 */
export type CandleGrid = 'utc' | 'shanghai';

export function markerTimeForEvent(eventTime: string, timeframe: ReviewTimeframe, candles: Candlestick[], grid: CandleGrid = 'shanghai'): UTCTimestamp {
  const timestamp = Date.parse(eventTime);
  if (!Number.isFinite(timestamp)) return 0 as UTCTimestamp;

  return timeframeTimeForTimestamp(timestamp, timeframe, candles, grid);
}

export function timeframeTimeForPoint(pointTime: number, timeframe: ReviewTimeframe, candles: Candlestick[], grid: CandleGrid = 'shanghai'): UTCTimestamp {
  return timeframeTimeForTimestamp(pointTime * 1000, timeframe, candles, grid);
}

export function freeReplayProgressTimeForStart(startTime: string): UTCTimestamp {
  const timestamp = parseReviewInputTime(startTime);
  if (!Number.isFinite(timestamp)) return 0 as UTCTimestamp;
  return Math.floor(timestamp / 1000) as UTCTimestamp;
}

export function freeReplayCursorTimeForStart(startTime: string, timeframe: ReviewTimeframe, grid: CandleGrid = 'shanghai'): UTCTimestamp {
  const timestamp = parseReviewInputTime(startTime);
  if (!Number.isFinite(timestamp)) return 0 as UTCTimestamp;
  return freeReplayCursorTimeForProgress(Math.floor(timestamp / 1000), timeframe, grid);
}

export function freeReplayCursorTimeForTimeframeSwitch(previousCursorTime: number, timeframe: ReviewTimeframe, grid: CandleGrid = 'shanghai'): UTCTimestamp {
  return freeReplayCursorTimeForProgress(previousCursorTime, timeframe, grid);
}

export function freeReplayCursorTimeForProgress(progressTime: number, timeframe: ReviewTimeframe, grid: CandleGrid = 'shanghai'): UTCTimestamp {
  const progressTimestamp = progressTime * 1000;
  if (!Number.isFinite(progressTimestamp)) return 0 as UTCTimestamp;
  const containingStart = floorTimestamp(progressTimestamp, timeframe, grid);
  return Math.floor(floorTimestamp(containingStart - 1, timeframe, grid) / 1000) as UTCTimestamp;
}

export function freeReplayCandleCompletionTime(cursorTime: number, timeframe: ReviewTimeframe, grid: CandleGrid = 'shanghai'): UTCTimestamp {
  const cursorTimestamp = cursorTime * 1000;
  if (!Number.isFinite(cursorTimestamp)) return 0 as UTCTimestamp;
  if (timeframe === '1M') {
    // A monthly bar closes at the next month's 1st, on whichever grid it opened
    // on — 00:00Z for Binance, 00:00 Beijing for OKX.
    const parts = shanghaiParts(new Date(cursorTimestamp));
    const year = grid === 'utc' ? new Date(cursorTimestamp).getUTCFullYear() : Number(parts.year);
    const month = grid === 'utc' ? new Date(cursorTimestamp).getUTCMonth() + 1 : Number(parts.month);
    const close = grid === 'utc'
      ? Date.UTC(year, month, 1)
      : Date.UTC(year, month, 1) - 8 * 60 * 60_000;
    return Math.floor(close / 1000) as UTCTimestamp;
  }
  return Math.floor((cursorTimestamp + timeframeMs(timeframe)) / 1000) as UTCTimestamp;
}

function timeframeTimeForTimestamp(timestamp: number, timeframe: ReviewTimeframe, candles: Candlestick[], grid: CandleGrid): UTCTimestamp {
  const containing = containingCandleTimestamp(timestamp, timeframe, candles);
  if (containing !== null) return Math.floor(containing / 1000) as UTCTimestamp;

  return Math.floor(floorTimestamp(timestamp, timeframe, grid) / 1000) as UTCTimestamp;
}

export function entryVisibleRange(entryTime: string, timeframe: ReviewTimeframe, grid: CandleGrid = 'shanghai'): { from: UTCTimestamp; to: UTCTimestamp } {
  const entry = Date.parse(entryTime);
  // Snap the entry to the candle grid before computing the window. The raw
  // entry minute (e.g. 16:31 for a 5m chart) is usually off-grid, and
  // lightweight-charts' setVisibleRange converts an off-grid time by ceiling
  // to the NEXT index (timeToIndex lowerBound), which would turn
  // entry ± 150 bars into "first candle .. last candle" — i.e. the whole
  // dataset — instead of a window centered on the trade.
  const snappedEntry = floorTimestamp(entry, timeframe, grid);
  return {
    from: Math.floor((snappedEntry - timeframeMs(timeframe) * 150) / 1000) as UTCTimestamp,
    to: Math.floor((snappedEntry + timeframeMs(timeframe) * 150) / 1000) as UTCTimestamp,
  };
}

export function timeframeMs(timeframe: ReviewTimeframe): number {
  const map: Record<ReviewTimeframe, number> = {
    '1m': 60_000,
    '5m': 5 * 60_000,
    '15m': 15 * 60_000,
    '1H': 60 * 60_000,
    '4H': 4 * 60 * 60_000,
    '1D': 24 * 60 * 60_000,
    '1W': 7 * 24 * 60 * 60_000,
    '1M': 30 * 24 * 60 * 60_000,
  };
  return map[timeframe];
}

export function formatChartTime(time: Time, timeframe: ReviewTimeframe): string {
  const date = new Date(timeToTimestamp(time));
  const parts = shanghaiParts(date);

  if (timeframe === '1D') {
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  if (timeframe === '1W' || timeframe === '1M') {
    return `${parts.year}-${parts.month}`;
  }

  if (parts.hour === '00' && parts.minute === '00') {
    return `${parts.month}-${parts.day}`;
  }

  return `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

/**
 * The bar time of the candlestick that contains `timestamp`.
 *
 * Units: **milliseconds in, milliseconds out** — matching `Candlestick.timestamp`.
 * Drawing points (`ChartPoint.time`) are in **seconds**, so callers coming from a
 * drawing point must multiply by 1000 first (see `timeframeTimeForPoint`).
 * Returns `null` when no loaded candlestick contains the timestamp (empty list,
 * or a timestamp before the first / after the last candlestick).
 */
export function containingCandleTimestamp(timestamp: number, timeframe: ReviewTimeframe, candles: Candlestick[]): number | null {
  if (!candles.length) return null;
  const ordered = [...candles].sort((a, b) => a.timestamp - b.timestamp);
  const fallbackStep = timeframeMs(timeframe);

  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index];
    const next = ordered[index + 1];
    if (timestamp < current.timestamp) return null;
    const end = next?.timestamp ?? current.timestamp + fallbackStep;
    if (timestamp < end) return current.timestamp;
  }

  return null;
}

function floorTimestamp(timestamp: number, timeframe: ReviewTimeframe, grid: CandleGrid): number {
  // Intraday timeframes share one grid on both venues, so only `1D` / `1W` /
  // `1M` branch. Binance cuts the day at 00:00Z (08:00 Beijing, the boundary
  // the reviewer reads as "a new day"); OKX cuts it at 00:00 Beijing.
  if (timeframe === '1D' || timeframe === '1W' || timeframe === '1M') {
    if (grid === 'utc') {
      if (timeframe === '1D') {
        const date = new Date(timestamp);
        return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
      }
      if (timeframe === '1W') return weekStartUtc(timestamp);
      const date = new Date(timestamp);
      return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
    }
    const parts = shanghaiParts(new Date(timestamp));
    const year = Number(parts.year);
    if (timeframe === '1M') return Date.UTC(year, Number(parts.month) - 1, 1) - 8 * 60 * 60_000;
    if (timeframe === '1W') return weekStartShanghai(Number(parts.year), Number(parts.month), Number(parts.day));
    return Date.UTC(year, Number(parts.month) - 1, Number(parts.day)) - 8 * 60 * 60_000;
  }

  // Intraday: floor within the day. The Shanghai grid only matters for the day
  // boundary, which the modulo already respects.
  const stepMinutes = timeframeMs(timeframe) / 60_000;
  if (grid === 'shanghai') {
    const parts = shanghaiParts(new Date(timestamp));
    const totalMinutes = Number(parts.hour) * 60 + Number(parts.minute);
    const flooredMinutes = Math.floor(totalMinutes / stepMinutes) * stepMinutes;
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Math.floor(flooredMinutes / 60), flooredMinutes % 60) - 8 * 60 * 60_000;
  }
  const date = new Date(timestamp);
  const totalMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  const flooredMinutes = Math.floor(totalMinutes / stepMinutes) * stepMinutes;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), Math.floor(flooredMinutes / 60), flooredMinutes % 60);
}

/**
 * Open time of the UTC calendar week (Monday 00:00Z) containing `timestamp`.
 *
 * Computed from the calendar rather than by flooring a nominal 7-day step: a
 * floor like `timestamp - timestamp % 7d` lands on whichever weekday the epoch
 * happened to fall on, so it can miss the Monday grid by days.
 */
function weekStartUtc(timestamp: number): number {
  const date = new Date(timestamp);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - daysSinceMonday * 24 * 60 * 60_000;
}

/** Open time of the Shanghai calendar week (Monday 00:00 Beijing) containing the given Shanghai date. */
function weekStartShanghai(year: number, month: number, day: number): number {
  const date = new Date(Date.UTC(year, month - 1, day));
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return Date.UTC(year, month - 1, day - daysSinceMonday) - 8 * 60 * 60_000;
}

function timeToTimestamp(time: Time): number {
  if (typeof time === 'number') return time * 1000;
  if (typeof time === 'string') return Date.parse(`${time}T00:00:00+08:00`);
  return Date.parse(`${time.year}-${pad(time.month)}-${pad(time.day)}T00:00:00+08:00`);
}

function parseReviewInputTime(value: string): number {
  const trimmed = value.trim();
  if (/([zZ]|[+-]\d{2}:?\d{2})$/.test(trimmed)) return Date.parse(trimmed);
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) {
    return Date.parse(`${trimmed.replace(' ', 'T')}+08:00`);
  }
  return Date.parse(trimmed);
}

function shanghaiParts(date: Date): Record<'year' | 'month' | 'day' | 'hour' | 'minute', string> {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
