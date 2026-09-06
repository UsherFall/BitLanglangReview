export type Direction = '多' | '空';

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
};

export type ReviewTimeframe = '1m' | '5m' | '15m' | '1H' | '4H' | '1D' | '1W' | '1M';

export const reviewTimeframes: ReviewTimeframe[] = ['1m', '5m', '15m', '1H', '4H', '1D', '1W', '1M'];
