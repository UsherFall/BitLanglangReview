import type { Time, UTCTimestamp } from 'lightweight-charts';
import type { Candlestick } from '../domain/candlestick';
import type { ReviewTimeframe } from '../domain/trade';

export function markerTimeForEvent(eventTime: string, timeframe: ReviewTimeframe, candles: Candlestick[]): UTCTimestamp {
  const timestamp = Date.parse(eventTime);
  if (!Number.isFinite(timestamp)) return 0 as UTCTimestamp;

  return timeframeTimeForTimestamp(timestamp, timeframe, candles);
}

export function timeframeTimeForPoint(pointTime: number, timeframe: ReviewTimeframe, candles: Candlestick[]): UTCTimestamp {
  return timeframeTimeForTimestamp(pointTime * 1000, timeframe, candles);
}

export function freeReplayProgressTimeForStart(startTime: string): UTCTimestamp {
  const timestamp = parseReviewInputTime(startTime);
  if (!Number.isFinite(timestamp)) return 0 as UTCTimestamp;
  return Math.floor(timestamp / 1000) as UTCTimestamp;
}

export function freeReplayCursorTimeForStart(startTime: string, timeframe: ReviewTimeframe): UTCTimestamp {
  const timestamp = parseReviewInputTime(startTime);
  if (!Number.isFinite(timestamp)) return 0 as UTCTimestamp;
  return freeReplayCursorTimeForProgress(Math.floor(timestamp / 1000), timeframe);
}

export function freeReplayCursorTimeForTimeframeSwitch(previousCursorTime: number, timeframe: ReviewTimeframe): UTCTimestamp {
  return freeReplayCursorTimeForProgress(previousCursorTime, timeframe);
}

export function freeReplayCursorTimeForProgress(progressTime: number, timeframe: ReviewTimeframe): UTCTimestamp {
  const progressTimestamp = progressTime * 1000;
  if (!Number.isFinite(progressTimestamp)) return 0 as UTCTimestamp;
  const containingStart = floorTimestamp(progressTimestamp, timeframe);
  return Math.floor(floorTimestamp(containingStart - 1, timeframe) / 1000) as UTCTimestamp;
}

export function freeReplayCandleCompletionTime(cursorTime: number, timeframe: ReviewTimeframe): UTCTimestamp {
  const cursorTimestamp = cursorTime * 1000;
  if (!Number.isFinite(cursorTimestamp)) return 0 as UTCTimestamp;
  if (timeframe === '1M') {
    const parts = shanghaiParts(new Date(cursorTimestamp));
    const year = Number(parts.year);
    const month = Number(parts.month);
    return Math.floor((Date.UTC(year, month, 1) - 8 * 60 * 60_000) / 1000) as UTCTimestamp;
  }
  return Math.floor((cursorTimestamp + timeframeMs(timeframe)) / 1000) as UTCTimestamp;
}

function timeframeTimeForTimestamp(timestamp: number, timeframe: ReviewTimeframe, candles: Candlestick[]): UTCTimestamp {
  const containing = containingCandleTimestamp(timestamp, timeframe, candles);
  if (containing !== null) return Math.floor(containing / 1000) as UTCTimestamp;

  return Math.floor(floorTimestamp(timestamp, timeframe) / 1000) as UTCTimestamp;
}

export function entryVisibleRange(entryTime: string, timeframe: ReviewTimeframe): { from: UTCTimestamp; to: UTCTimestamp } {
  const entry = Date.parse(entryTime);
  // Snap the entry to the candle grid before computing the window. The raw
  // entry minute (e.g. 16:31 for a 5m chart) is usually off-grid, and
  // lightweight-charts' setVisibleRange converts an off-grid time by ceiling
  // to the NEXT index (timeToIndex lowerBound), which would turn
  // entry ± 150 bars into "first candle .. last candle" — i.e. the whole
  // dataset — instead of a window centered on the trade.
  const snappedEntry = floorTimestamp(entry, timeframe);
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

function containingCandleTimestamp(timestamp: number, timeframe: ReviewTimeframe, candles: Candlestick[]): number | null {
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

function floorTimestamp(timestamp: number, timeframe: ReviewTimeframe): number {
  const date = new Date(timestamp);
  const parts = shanghaiParts(date);
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);

  if (timeframe === '1M') return Date.UTC(year, month - 1, 1) - 8 * 60 * 60_000;
  if (timeframe === '1W') return timestamp - (timestamp % timeframeMs(timeframe));
  if (timeframe === '1D') return Date.UTC(year, month - 1, day) - 8 * 60 * 60_000;

  const stepMinutes = timeframeMs(timeframe) / 60_000;
  const totalMinutes = hour * 60 + minute;
  const flooredMinutes = Math.floor(totalMinutes / stepMinutes) * stepMinutes;
  return Date.UTC(year, month - 1, day, Math.floor(flooredMinutes / 60), flooredMinutes % 60) - 8 * 60 * 60_000;
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
