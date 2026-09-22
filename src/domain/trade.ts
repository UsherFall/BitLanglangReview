export type Direction = '多' | '空';

/**
 * One open or close action inside a trade, when the source can supply the
 * individual orders behind it (Bitget orders-history can; the xlsx workbook
 * only records the cycle's first entry and last exit). The chart plots a point
 * per action and shows these fields on hover, so `fee` follows the `Trade.fee`
 * convention of a positive cost.
 */
export type TradePoint = {
  kind: 'open' | 'close';
  /** Shanghai-timezone ISO, same convention as `entryTime` / `exitTime`. */
  time: string;
  timeMs: number;
  price: number;
  qty: number;
  fee: number;
  /** Realized pnl of this action; null for opens (nothing realized yet). */
  profit: number | null;
  /** Exchange order source, e.g. `market` / `loss_market` (stop). */
  source: string;
  leverage: number | null;
};

export type Trade = {
  id: string;
  sequence: number;
  instrument: string;
  direction: Direction;
  /** Null when the data source cannot supply leverage (e.g. Bitget history-position rows). */
  leverage: number | null;
  /** Null when the data source cannot supply margin. */
  margin: number | null;
  entryPrice: number;
  exitPrice: number;
  /** Null when the data source cannot supply a reliable return rate. */
  returnRate: number | null;
  profit: number;
  /** Null when the data source cannot supply notional turnover. */
  turnover: number | null;
  size: number;
  /** Null when the data source cannot supply peak position value. */
  maxPositionValue: number | null;
  fee: number;
  entryTime: string;
  exitTime: string;
  holdingMinutes: number;
  amplitude: number | null;
  sourceNote: string;
  /** Per-action points when the source exposes them; absent → chart shows the
   * entry/exit pair only. */
  points?: TradePoint[];
};

export type ReviewTimeframe = '1m' | '5m' | '15m' | '1H' | '4H' | '1D' | '1W' | '1M';

export const reviewTimeframes: ReviewTimeframe[] = ['1m', '5m', '15m', '1H', '4H', '1D', '1W', '1M'];
