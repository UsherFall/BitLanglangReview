import type { ReviewTimeframe } from './trade';

/**
 * `'ray'` is the two-point tool offered by the toolbar: `points[0]` is the
 * endpoint and `points[1]` the direction point the line extends towards.
 * `'segment'` is no longer creatable — it stays in the union because drawings
 * saved before the swap still exist and must keep rendering.
 */
export type ChartDrawingKind = 'horizontal' | 'segment' | 'ray';

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
