export type Direction = '多' | '空';

export type Trade = {
  id: string;
  sequence: number;
  instrument: string;
  direction: Direction;
  leverage: number;
  margin: number;
  entryPrice: number;
  exitPrice: number;
  returnRate: number;
  profit: number;
  turnover: number;
  size: number;
  maxPositionValue: number;
  fee: number;
  entryTime: string;
  exitTime: string;
  holdingMinutes: number;
  amplitude: number | null;
  sourceNote: string;
};

export type ReviewTimeframe = '5m' | '15m' | '1H' | '4H' | '1D' | '1W' | '1M';

export const reviewTimeframes: ReviewTimeframe[] = ['5m', '15m', '1H', '4H', '1D', '1W', '1M'];
