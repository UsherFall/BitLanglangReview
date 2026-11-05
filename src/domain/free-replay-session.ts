import type { ReplayCandleSource } from './candlestick';
import type { PaperTradingSession } from './paper-trading';
import type { ReviewTimeframe } from './trade';

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
 */
export type FreeReplaySessionPayload<
  Paper = PaperTradingSession,
  Timeframe extends string = ReviewTimeframe,
> = FreeReplayStart & {
  timeframe: Timeframe;
  paperTrading: Paper;
};

/** A persisted history row; only the saved form carries the server timestamp. */
export type FreeReplaySession<
  Paper = PaperTradingSession,
  Timeframe extends string = ReviewTimeframe,
> = FreeReplaySessionPayload<Paper, Timeframe> & {
  updatedAt: string;
};
