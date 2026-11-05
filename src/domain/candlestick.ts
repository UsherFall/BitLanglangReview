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

/**
 * A Free Replay session's recorded candle source (11/02). `binance-only` is the
 * strict Binance venue Free Replay has always used for its「币安」option; `okx`
 * and `bitget` are the other two selectable sources. This is the ROUTE's
 * vocabulary — it is stored verbatim in the session and sent as `source=`.
 *
 * 11/05: owned by the domain, not by a UI module, because it is a wire/storage
 * contract shared by the replay helpers, the panel, and the chart mapping.
 */
export type ReplayCandleSource = 'binance-only' | 'okx' | 'bitget';

/**
 * Every source value a chart can be told to read (11/05). Non-Replay callers
 * use `CandleSourceId`; a Free Replay panel additionally inherits the Session's
 * `binance-only` venue. `binance` and `binance-only` are deliberately distinct:
 * they share a venue and a day grid but are different `/api/candles` policies.
 */
export type ChartCandleSource = CandleSourceId | ReplayCandleSource;

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

/**
 * Nominal duration of one Review Timeframe in milliseconds. `1M` is 30 DAYS,
 * not a calendar-month or exchange closed-bar rule; venue grid code owns those.
 */
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

/** Merge pages by timestamp (last write wins), returning ascending candles. */
export function mergeCandles<T extends { timestamp: number }>(candles: readonly T[]): T[] {
  return [...new Map(candles.map((candle) => [candle.timestamp, candle])).values()].sort((a, b) => a.timestamp - b.timestamp);
}
