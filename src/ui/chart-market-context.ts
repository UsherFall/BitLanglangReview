import type { CandleSourceId, ChartCandleSource } from '../domain/candlestick';
import type { CandleGrid } from './chart-time';

/**
 * The three values a chart source actually decides (11/05).
 *
 * They are intentionally separate even when their values look alike:
 *
 * - `venue` names the tradeable venue, and is the vocabulary the Free Replay
 *   instrument list understands (`/api/free-replay/instruments?source=`).
 * - `requestSource` is the `/api/candles?source=` value. It is NOT always the
 *   venue: `binance` and `binance-only` are two different request policies
 *   (candidate chain vs. strict Binance) over the same venue.
 * - `grid` is the day boundary the candlesticks open on. Binance opens a day at
 *   00:00Z; OKX and Bitget open at 00:00 Beijing.
 *
 * Venue, request source and grid travel together: a request sent to one venue
 * while flooring times on another's grid puts the reveal cursor between
 * candlesticks.
 */
export type ChartMarketContext = {
  venue: CandleSourceId;
  requestSource: ChartCandleSource;
  grid: CandleGrid;
};

/**
 * source → { venue, requestSource, grid }.
 *
 * ONE exhaustive table so the main Free Replay chart and its Other Coin Panel
 * cannot drift. `binance` keeps its candidate-chain request policy; only a
 * Session that actually recorded `binance-only` asks for strict Binance.
 */
const CHART_MARKET_CONTEXTS: Record<ChartCandleSource, ChartMarketContext> = {
  binance: { venue: 'binance', requestSource: 'binance', grid: 'utc' },
  'binance-only': { venue: 'binance', requestSource: 'binance-only', grid: 'utc' },
  okx: { venue: 'okx', requestSource: 'okx', grid: 'shanghai' },
  bitget: { venue: 'bitget', requestSource: 'bitget', grid: 'shanghai' },
};

export function chartMarketContext(source: ChartCandleSource): ChartMarketContext {
  return CHART_MARKET_CONTEXTS[source];
}
