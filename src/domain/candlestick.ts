import type { ReviewTimeframe } from './trade';

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
