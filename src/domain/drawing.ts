import type { ReviewTimeframe } from './trade';

export type ChartDrawingKind = 'horizontal' | 'segment';

export type ChartPoint = {
  time: number;
  price: number;
};

export type ChartDrawing = {
  id: string;
  tradeId: string | null;
  instrument: string;
  timeframe: ReviewTimeframe;
  kind: ChartDrawingKind;
  points: ChartPoint[];
  createdAt: string;
  updatedAt: string;
};

export type SaveChartDrawingInput = Omit<ChartDrawing, 'id' | 'createdAt' | 'updatedAt'> & {
  id?: string;
};
