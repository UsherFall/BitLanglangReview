import type { Candlestick } from '../domain/candlestick';
import { okxInstrumentToBitgetSymbol, usdtSymbolToOkxInstrument } from '../domain/instrument-symbol';
import type { ReviewTimeframe } from '../domain/trade';
import type { CandleGrid } from './chart-time';
import { freeReplayCandleCompletionTime, timeframeMs } from './chart-time';

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
 * A Free Replay session's recorded candle source (11/02). `binance-only` is the
 * strict Binance venue Free Replay has always used for its「币安」option; `okx`
 * and `bitget` are the other two selectable sources. This is the ROUTE's
 * vocabulary — it is stored verbatim in the session and sent as `source=`.
 */
export type ReplayCandleSource = 'binance-only' | 'okx' | 'bitget';

/** The UI-facing source list, in display order (选品同款词汇). */
export const REPLAY_SOURCE_LABELS: Record<ReplayCandleSource, string> = {
  'binance-only': '币安',
  okx: 'OKX',
  bitget: 'Bitget',
};

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
 * chosen default. The two travel together — the source decides the grid.
 *
 * 11/02: the grid maps by the source's VALUE, not by the field's presence.
 * Mapping "any named source → shanghai" mis-anchored a RESTORED legacy session:
 * restore rewrites `null` to `binance-only`, and Binance days open at 00:00Z,
 * not 00:00 Beijing — a 1D/1W/1M reveal window on a restored legacy session
 * floored to the wrong day boundary.
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
  // 无会话（其他币面板）→ 当前默认源的日界；有会话 → 按源值映射（未记录 = 旧
  // Binance 会话，恢复路径会把 null 改写成 'binance-only'，按值映射两者一致）。
  if (!session) return FREE_REPLAY_CANDLE_GRID;
  const source = session.candleSource ?? LEGACY_REPLAY_CANDLE_SOURCE;
  // Binance opens a day at 00:00Z; OKX and Bitget at 00:00 Beijing.
  return source === 'binance-only' ? LEGACY_REPLAY_CANDLE_GRID : FREE_REPLAY_CANDLE_GRID;
}

/**
 * The instrument name to send the candle route for one source (11/02).
 *
 * Binance and Bitget share the `base+USDT` vocabulary; OKX uses
 * `base-USDT-SWAP`. A session keeps its instrument in the vocabulary it was
 * CREATED with (the session key `(instrument, startTime)` must stay stable
 * across source switches), and every candle request translates to the
 * REQUESTED source's vocabulary instead. A name the target venue does not
 * know answers an empty window — visible, never a silent venue switch.
 */
export function replayRequestInstrument(instrument: string, routeSource: string): string {
  if (routeSource === 'okx') return usdtSymbolToOkxInstrument(instrument) ?? instrument;
  return okxInstrumentToBitgetSymbol(instrument) ?? instrument;
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

/**
 * 焦点态右缘翻页是否还有可揭示的目标（11/03 焦点拖动乱飘修复）。
 *
 * 活动数据集最后一根已触及/越过揭示边界（cursorTime）时，`mode=later` 取回
 * 的蜡烛全是未揭示未来，`visibleCandlesForFreeReplay` 全部过滤 → 渲染数组
 * 永不增长 → `barsAfter` 恒 < 50 → 每个拖动帧都再发一次请求（请求风暴的
 * 根因）。揭示边界（未来不可见）本来就是回放的右墙：这种态不翻页。
 * 判据用严格小于 —— 最后一根恰在 cursorTime 上时，更晚的蜡烛同样是未来。
 */
export function shouldLoadLaterFocusCandles(activeCandles: Candlestick[], cursorTime: number): boolean {
  const last = activeCandles[activeCandles.length - 1];
  return last !== undefined && last.timestamp < cursorTime * 1000;
}

/**
 * 第一个落在 [fromMs, toMs] 内的已加载数据洞（11/02）。
 *
 * 历史翻页取数会在缓存里留下空窗，焦点取窗合并也会把两段不相邻的窗口拼进
 * 同一数组 —— earlier 只在视口左缘触发、later 只在右缘/光标前方 20 根触发，
 * 夹在中间的洞永远没有任何加载器会锚到它（「一段 K 线空缺」的根因），揭示
 * 光标还会直接跳过洞（少揭示蜡烛）。洞的判定与 `contiguousCandles` 同口径
 * （相邻 gap > 1.5×step）。返回洞两侧蜡烛的时间戳（毫秒），无洞返回 null。
 */
export function firstGapInRange(candles: Candlestick[], fromMs: number, toMs: number, timeframe: ReviewTimeframe): { from: number; to: number } | null {
  if (candles.length < 2) return null;
  const step = timeframeMs(timeframe);
  for (let i = 1; i < candles.length; i += 1) {
    const previous = candles[i - 1];
    const next = candles[i];
    if (next.timestamp - previous.timestamp > step * 1.5 && previous.timestamp < toMs && next.timestamp > fromMs) {
      return { from: previous.timestamp, to: next.timestamp };
    }
  }
  return null;
}
