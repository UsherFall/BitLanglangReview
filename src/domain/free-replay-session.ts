import type { ReplayCandleSource } from './candlestick';
import type { PaperTradingSession } from './paper-trading';
import type { ReviewTimeframe } from './trade';

/**
 * 11/10 结束/恢复复盘：`ended` 是可逆的只读冻结态（交易与 K 线进度锁住、
 * 单子仍可查看），不是永久完结；`active` 是可操作态。旧会话/payload 缺省
 * 一律按 `active` 读。
 */
export type FreeReplayReviewStatus = 'active' | 'ended';

/** Active Free Replay state shared by browser sessions and the wire/store boundary. */
export type FreeReplayStart = {
  /** Missing means a legacy session and keeps its original venue. */
  candleSource?: ReplayCandleSource;
  instrument: string;
  startTime: string;
  dataAnchorTime: string;
  startCursorTime: number;
  startProgressTime: number;
  progressTime: number;
  cursorTime: number;
};

/**
 * Save payload: active Replay plus its timeframe and Paper Trading blob.
 * Defaults are the strict UI shape; the Store Adapter may explicitly widen the
 * blob/timeframe for opaque legacy JSON while the route validates new writes.
 * `reviewStatus` is optional on the wire: an unsaved/legacy payload means
 * `active` (see `FreeReplayReviewStatus`).
 */
export type FreeReplaySessionPayload<
  Paper = PaperTradingSession,
  Timeframe extends string = ReviewTimeframe,
> = FreeReplayStart & {
  timeframe: Timeframe;
  paperTrading: Paper;
  reviewStatus?: FreeReplayReviewStatus;
};

/**
 * A persisted history row; only the saved form carries the server timestamp.
 * A saved row ALWAYS reports an explicit `reviewStatus` (legacy rows read as
 * `active`).
 */
export type FreeReplaySession<
  Paper = PaperTradingSession,
  Timeframe extends string = ReviewTimeframe,
> = FreeReplaySessionPayload<Paper, Timeframe> & {
  reviewStatus: FreeReplayReviewStatus;
  updatedAt: string;
};
