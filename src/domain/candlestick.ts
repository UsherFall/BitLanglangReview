import type { ReviewTimeframe } from './trade';

/**
 * The exchange a chart's candlesticks come from. Shared by the UI (which picks
 * the source per review mode) and the server (which selects the `CandleSource`),
 * so both sides stay on the same vocabulary when a new source is registered.
 */
export type CandleSourceId = 'okx' | 'bitget';

export type Candlestick = {
  instrument: string;
  timeframe: ReviewTimeframe;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};
