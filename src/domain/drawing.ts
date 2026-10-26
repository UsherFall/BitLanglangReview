import type { ReviewTimeframe } from './trade';

/**
 * `'ray'` is the two-point tool offered by the toolbar: `points[0]` is the
 * endpoint and `points[1]` the direction point the line extends towards.
 * `'segment'` is no longer creatable — it stays in the union because drawings
 * saved before the swap still exist and must keep rendering.
 */
export type ChartDrawingKind = 'horizontal' | 'segment' | 'ray';

/**
 * The board a drawing belongs to (10/26): which workflow drew it.
 *
 * - `'scan'`   — the 选品 level drawer; the 距线 scan measures ONLY these.
 * - `'review'` — the trade-review and free-replay charts.
 *
 * Visibility and measurement are board-scoped: a chart loads only its own
 * board's lines (canonical-instrument matched WITHIN the board), so a review
 * level never leaks into the scan's 距线 column and vice versa. The board is
 * orthogonal to the instrument's naming — a line keeps the native symbol of
 * the chart it was drawn on; `canonicalInstrument` bridges names inside one
 * board (a scan-source switch must not hide the coin's drawer lines).
 */
export type DrawingBoard = 'scan' | 'review';

export const DRAWING_BOARDS: DrawingBoard[] = ['scan', 'review'];

export function isDrawingBoard(value: unknown): value is DrawingBoard {
  return value === 'scan' || value === 'review';
}

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
  /** See `DrawingBoard`. Stamped by the chart at save time; never edited. */
  board: DrawingBoard;
  /**
   * The points of a drawing carry **seconds** (`time`), not milliseconds:
   * `pointFromClient` reads the x coordinate with lightweight-charts'
   * `timeScale().coordinateToTime(...)`, which returns seconds. Anything that
   * compares a point with a candlestick timestamp MUST convert first — see
   * `pointTimeMs` in `src/domain/level-alert.ts` (the 距线 path did not, and
   * the ray interpolation was off by 1000×).
   */
  points: ChartPoint[];
  /**
   * The close of the chart's last COMPLETED candlestick at the moment the
   * drawing was made (same timeframe), and that bar's timestamp (ms).
   *
   * Why it exists (10/21): a level is drawn on ONE exchange's chart (Binance
   * in the 选品 drawer) but measured on ANOTHER exchange's candles (the scan
   * runs on Bitget). The two venues price the same base slightly differently,
   * and a 1% offset is enough to turn an «alert» into a «far» on a 0.5×scale
   * cut. These two fields freeze the price basis the line was drawn in, so
   * the scan can rescale the line instead of guessing.
   *
   * Both are OPTIONAL: lines drawn before 10/21 have no reference and are
   * measured unscaled (factor 1) — the pre-10/21 behaviour.
   */
  refPrice?: number;
  refTime?: number;
  createdAt: string;
  updatedAt: string;
};

export type SaveChartDrawingInput = Omit<ChartDrawing, 'id' | 'createdAt' | 'updatedAt'> & {
  id?: string;
};
