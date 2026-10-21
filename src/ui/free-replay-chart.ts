import type { Candlestick } from '../domain/candlestick';
import type { ReviewTimeframe } from '../domain/trade';
import type { CandleGrid } from './chart-time';
import { freeReplayCandleCompletionTime } from './chart-time';

/**
 * The candle source and day boundary Free Replay charts against.
 *
 * 10/21: Free Replay moved from Binance to **Bitget** - it replays Bitget
 * positions, so its candles come from Bitget, and the position's entry price
 * and the chart share one price basis with no scaling. Bitget opens a day at
 * 00:00 Beijing (measured: its 1D bars open at 16:00Z), so the grid is
 * `shanghai`.
 *
 * These two travel together on purpose: the source decides the grid, and a
 * request sent to one venue while flooring times on the other's grid puts the
 * reveal cursor between candlesticks.
 *
 * The OLD constants were `binance-only` + `utc`. Sessions recorded before the
 * move carry no `candleSource` (see `free-replay-session-store.ts`) and keep
 * replaying against Binance - the venue is a property of the SESSION, not a
 * global setting.
 */
export const FREE_REPLAY_CANDLE_SOURCE = 'bitget';
export const FREE_REPLAY_CANDLE_GRID: CandleGrid = 'shanghai';

/**
 * The source a session recorded BEFORE the 10/21 move replays against.
 *
 * A session without a `candleSource` was recorded while Free Replay was still
 * on Binance, so it must stay there: switching it to Bitget would move the
 * candlesticks under a replay the user already has progress in.
 */
export const LEGACY_REPLAY_CANDLE_SOURCE = 'binance-only';
export const LEGACY_REPLAY_CANDLE_GRID: CandleGrid = 'utc';

/**
 * The source and grid of ONE replay session.
 *
 * The venue is a property of the SESSION, not a global setting (10/21): a
 * session created before the move keeps its old venue, a new one uses the
 * current default. The two travel together — the source decides the grid.
 */
export function replayCandleSource(session: { candleSource?: string } | null | undefined): string {
  // A session that names its venue uses it; a session recorded before the
  // move keeps Binance; and a caller with NO session at all (the replay's
  // other-coin panel) uses the CURRENT default.
  if (session && session.candleSource) return session.candleSource;
  if (session) return LEGACY_REPLAY_CANDLE_SOURCE;
  return FREE_REPLAY_CANDLE_SOURCE;
}

export function replayCandleGrid(session: { candleSource?: string } | null | undefined): CandleGrid {
  if (!session) return FREE_REPLAY_CANDLE_GRID;
  return session.candleSource ? FREE_REPLAY_CANDLE_GRID : LEGACY_REPLAY_CANDLE_GRID;
}

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
  // The cursor is past every loaded candle (a restored session, or data that
  // lagged behind a fast reveal): keep pulling later candles so the replay can
  // catch up instead of dead-ending with no further candlesticks to reveal.
  if (cursorIndex < 0) return true;
  return ordered.length - cursorIndex - 1 <= threshold;
}

export function shouldBackfillFreeReplayHistory(candles: Candlestick[], cursorTime: number, visibleBars: number, rightPaddingBars = 10): boolean {
  if (!Number.isFinite(visibleBars) || visibleBars <= rightPaddingBars) return false;
  const visibleThroughCursor = visibleCandlesForFreeReplay(candles, cursorTime);
  const requiredCandlesThroughCursor = Math.max(1, Math.round(visibleBars) - Math.max(1, Math.round(rightPaddingBars)));
  return visibleThroughCursor.length > 0 && visibleThroughCursor.length < requiredCandlesThroughCursor;
}
