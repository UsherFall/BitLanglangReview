import type { ReviewTimeframe } from './trade';

/**
 * The exchange a chart's candlesticks come from. Shared by the UI (which picks
 * the source per review mode) and the server (which selects the `CandleSource`),
 * so both sides stay on the same vocabulary when a new source is registered.
 *
 * `bitget` (10/21): the coin scan's default source, and the source the
 * Bitget-sourced review modes read. Its symbols are the SAME vocabulary as
 * Binance's (`BTCUSDT`), and its prices are the same scale as OKX's — so a
 * Bitget position charts against Bitget candles with no translation at all.
 */
export type CandleSourceId = 'okx' | 'binance' | 'bitget';

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
