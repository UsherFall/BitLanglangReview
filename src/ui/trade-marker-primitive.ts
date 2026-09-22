import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
  UTCTimestamp,
} from 'lightweight-charts';
import type { Candlestick } from '../domain/candlestick';
import type { MarkerPoint } from './trade-markers';

export const OPEN_COLOR = '#2DD4BF';
export const CLOSE_COLOR = '#FB7185';

/** Matches the chart's own background so each dot can punch a small halo out
 * of the candles underneath it instead of sitting on top of them. */
const CHART_BG = '#101318';
const ACTIVE_DIAMETER = 11;
const MUTED_DIAMETER = 8;
const MUTED_ALPHA = 0.55;
/** Vertical clearance between a dot and the candle it belongs to. */
const GAP = 8;
const HALO_WIDTH = 1.6;
/** Minimum centre-to-centre spacing between dots on the same side. */
const MIN_STACK_GAP = 3;

export type DrawnPoint = {
  point: MarkerPoint;
  /** Chart coordinates in CSS pixels (same space as crosshair `param.point`). */
  x: number;
  y: number;
  radius: number;
};

export type TradeMarkerPrimitiveOptions = {
  /** Draw each point's price beside it (off by default: prices live in the tooltip). */
  showText?: boolean;
};

/**
 * Draws trade points on the chart canvas instead of using the built-in series
 * markers. Two reasons: the built-in shapes cannot express "just a dot, no
 * label, with a hover card", and a DOM/SVG overlay was already tried and
 * rejected for making dragging stutter — canvas drawing repaints with the
 * chart, so dragging stays smooth.
 */
export class TradeMarkerPrimitive implements ISeriesPrimitive<Time> {
  private readonly view = new TradeMarkerView();
  private points: MarkerPoint[];
  private candles: Candlestick[];
  private showText: boolean;
  private requestUpdate: (() => void) | null = null;

  constructor(points: MarkerPoint[], candles: Candlestick[], options: TradeMarkerPrimitiveOptions = {}) {
    this.points = points;
    this.candles = candles;
    this.showText = options.showText === true;
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this.view.setApis(param.chart as IChartApi, param.series as ISeriesApi<'Candlestick'>);
    this.requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this.view.setApis(null, null);
    this.requestUpdate = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view];
  }

  /**
   * The chart calls this before every repaint (pan, zoom, resize, data
   * change). Dot positions are pixel coordinates, so they MUST be recomputed
   * here — refreshing the data alone leaves the dots frozen where they were
   * while the candles scroll underneath them.
   */
  updateAllViews(): void {
    this.view.setData(this.points, this.candles, this.showText);
    this.view.update();
  }

  /** Replaces the drawn points (marker toggle, mode switch, new candles) and
   * repaints immediately, so the chart never shows a stale set. */
  setPoints(points: MarkerPoint[], candles: Candlestick[]): void {
    this.points = points;
    this.candles = candles;
    this.view.setData(points, candles, this.showText);
    this.view.update();
    this.requestUpdate?.();
  }

  setShowText(showText: boolean): void {
    this.showText = showText;
    this.requestUpdate?.();
  }

  drawnPoints(): DrawnPoint[] {
    return this.view.currentPoints();
  }

  /** The point set currently handed to the chart (empty while markers are off). */
  currentPoints(): readonly MarkerPoint[] {
    return this.points;
  }

  /** Nearest point within `radius` CSS pixels of (x, y), or null. */
  findPointAt(x: number, y: number, radius = 16): MarkerPoint | null {
    let best: MarkerPoint | null = null;
    let bestDistance = radius;
    for (const drawn of this.view.currentPoints()) {
      const distance = Math.hypot(x - drawn.x, y - drawn.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = drawn.point;
      }
    }
    return best;
  }
}

class TradeMarkerView implements IPrimitivePaneView {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<'Candlestick'> | null = null;
  private points: MarkerPoint[] = [];
  private candles: Candlestick[] = [];
  private showText = false;
  private drawn: DrawnPoint[] = [];

  setApis(chart: IChartApi | null, series: ISeriesApi<'Candlestick'> | null): void {
    this.chart = chart;
    this.series = series;
  }

  setData(points: MarkerPoint[], candles: Candlestick[], showText: boolean): void {
    this.points = points;
    this.candles = candles;
    this.showText = showText;
  }

  currentPoints(): DrawnPoint[] {
    return this.drawn;
  }

  update(): void {
    this.drawn = layoutPoints(this.chart, this.series, this.points, this.candles);
  }

  renderer(): IPrimitivePaneRenderer | null {
    const drawn = this.drawn;
    const showText = this.showText;
    if (drawn.length === 0) return null;
    return {
      draw: (target) => {
        target.useMediaCoordinateSpace((scope) => {
          const context = scope.context;
          for (const item of drawn) drawDot(context, item);
          if (showText) for (const item of drawn) drawPrice(context, item);
        });
      },
    };
  }
}

function layoutPoints(
  chart: IChartApi | null,
  series: ISeriesApi<'Candlestick'> | null,
  points: readonly MarkerPoint[],
  candles: readonly Candlestick[],
): DrawnPoint[] {
  if (!chart || !series) return [];
  const timeScale = chart.timeScale();
  const drawn: DrawnPoint[] = [];
  const occupied: Record<'above' | 'below', number[]> = { above: [], below: [] };

  for (const point of points) {
    const x = timeScale.timeToCoordinate(point.time as UTCTimestamp);
    if (x === null) continue;
    // Look the candle up by the point's chart time, never by its raw timestamp:
    // the x coordinate and the price anchor must come from the SAME candlestick,
    // otherwise a point whose time snapped onto one candle would be drawn at
    // another candle's price level.
    const candle = candleByChartTime(point.time, candles);
    // Opens hang under the candle's low, closes above its high, so a dot never
    // covers the price action it refers to.
    const anchor = candle ? (point.kind === 'open' ? candle.low : candle.high) : point.price;
    const anchorY = series.priceToCoordinate(anchor);
    if (anchorY === null) continue;

    const radius = (point.muted ? MUTED_DIAMETER : ACTIVE_DIAMETER) / 2;
    const side = point.kind === 'open' ? 'below' : 'above';
    const direction = point.kind === 'open' ? 1 : -1;
    let y = point.kind === 'open' ? anchorY + GAP + radius : anchorY - GAP - radius;

    // Nudge dots apart when several actions land on the same candle side.
    const minGap = radius * 2 + MIN_STACK_GAP;
    for (let guard = 0; guard < 24; guard += 1) {
      const clashes = occupied[side].some((used) => Math.abs(used - y) < minGap);
      if (!clashes) break;
      y += direction * minGap;
    }
    occupied[side].push(y);

    drawn.push({ point, x, y, radius });
  }

  return drawn;
}

/** The loaded candlestick whose chart time (seconds) equals `chartTime`. */
function candleByChartTime(chartTime: number, candles: readonly Candlestick[]): Candlestick | null {
  for (const candle of candles) {
    if (Math.floor(candle.timestamp / 1000) === chartTime) return candle;
  }
  return null;
}

function drawDot(context: CanvasRenderingContext2D, item: DrawnPoint): void {
  const color = item.point.kind === 'open' ? OPEN_COLOR : CLOSE_COLOR;
  context.save();
  if (item.point.muted) context.globalAlpha = MUTED_ALPHA;

  context.beginPath();
  context.arc(item.x, item.y, item.radius + HALO_WIDTH, 0, Math.PI * 2);
  context.fillStyle = CHART_BG;
  context.fill();

  context.beginPath();
  context.arc(item.x, item.y, item.radius, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();
  context.restore();
}

function drawPrice(context: CanvasRenderingContext2D, item: DrawnPoint): void {
  const color = item.point.kind === 'open' ? OPEN_COLOR : CLOSE_COLOR;
  context.save();
  if (item.point.muted) context.globalAlpha = MUTED_ALPHA;
  context.font = '600 11px Inter, "Microsoft YaHei", Arial, sans-serif';
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  context.lineWidth = 3;
  context.strokeStyle = CHART_BG;
  const text = formatPointPrice(item.point.price);
  const x = item.x + item.radius + 6;
  const y = item.y + 1;
  context.strokeText(text, x, y);
  context.fillStyle = color;
  context.fillText(text, x, y);
  context.restore();
}

function formatPointPrice(price: number): string {
  if (price >= 1000) return price.toFixed(1);
  if (price >= 1) return price.toFixed(2);
  if (price >= 0.01) return price.toFixed(4);
  return String(Number(price.toPrecision(4)));
}
