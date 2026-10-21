import { Eraser, Magnet, Minus, MoveUpRight } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import type { Candlestick } from '../domain/candlestick';
import type { ChartDrawing, ChartDrawingKind, ChartPoint, SaveChartDrawingInput } from '../domain/drawing';
import type { ReviewTimeframe } from '../domain/trade';
import { nextMagnetMode, snapDrawingPoint, type MagnetMode } from './drawing-snap';
import { timeframeTimeForPoint } from './chart-time';

/**
 * The drawing layer of a chart: the tool row, the SVG overlay, the drag
 * handling and the persistence.
 *
 * Why it exists (10/21): the code lived INSIDE `App.tsx`, duplicated between
 * `TradeChart` and `FreeReplayChart`, so the 选品 page's level drawer — which
 * renders `OtherCoinChart` — had a chart but NO way to draw on it. The user
 * asked for exactly that ("画线点开后里面并没有画线功能"). Extracting the layer
 * is what makes a third chart able to draw.
 *
 * The behaviour is unchanged for the two existing charts: this is a MOVE, not a
 * rewrite. `App.tsx` still owns its chart, its candles and its price scale;
 * the hook only owns the drawings.
 *
 * ## Units
 *
 * A drawing's points carry **seconds** (`lightweight-charts`' `coordinateToTime`
 * returns seconds) while a candlestick's `timestamp` is **milliseconds**. The
 * conversion happens in ONE place — `pointTimeMs` in `src/domain/level-alert.ts`
 * — and the 距线 path reads it from there. Do not compare a point's `time` with
 * a candle's `timestamp` directly.
 */

/** Which part of a drawing a drag grabbed. */
export type DrawingDragTarget = 'body' | 'start' | 'end';

/**
 * The unsnapped pointer point captured on pointer down.
 *
 * It feeds the incremental `'body'` translation in `moveDrawing`, so reusing a
 * snapped point here would quantize the delta and make a whole drawing jump bar
 * by bar (both horizontally and price-wise) instead of following the pointer.
 */
type DrawingDrag = {
  drawing: ChartDrawing;
  target: DrawingDragTarget;
  startPoint: ChartPoint;
};

/** Everything a drawing point needs in order to snap to the candlestick under the pointer. */
export type DrawingSnapOptions = {
  candles: Candlestick[];
  timeframe: ReviewTimeframe;
  mode: MagnetMode;
};

export const MAGNET_MODE_LABELS: Record<MagnetMode, string> = { off: '关', weak: '弱', strong: '强' };
export const MAGNET_MODE_HINTS: Record<MagnetMode, string> = { off: '磁吸：关（点击切换为弱）', weak: '磁吸：弱（点击切换为强）', strong: '磁吸：强（点击切换为关）' };

export type ChartDrawingsOptions = {
  /** The instrument the drawings belong to (the chart's own symbol). */
  instrument: string;
  /** The timeframe the drawings belong to. Levels are per (instrument, timeframe). */
  timeframe: ReviewTimeframe;
  /** The trade the drawings belong to; `null` for a free-standing chart. */
  tradeId?: string | null;
  /** The chart API ref (the drawing overlay reads coordinates through it). */
  chartApiRef: React.RefObject<IChartApi | null>;
  /** The candlestick series ref. */
  seriesRef: React.RefObject<ISeriesApi<'Candlestick'> | null>;
  /**
   * The candles the magnet snaps to AND the price basis of a new line.
   *
   * The last COMPLETED bar's close becomes the line's `refPrice`/`refTime`,
   * which is what lets the 距线 scan carry the line into the scan source's
   * price basis (see `levelScaleFactor`).
   *
   * A REF is accepted as well as an array: the trade-review chart keeps its
   * rendered candles in a ref (it re-renders for other reasons), and reading
   * the ref lazily keeps the drawing layer from forcing a re-render on every
   * candle update.
   */
  candles: Candlestick[] | React.RefObject<Candlestick[]>;
  /**
   * The candles the MAGNET snaps to, when it must differ from the geometry
   * candles. Free Replay needs it: the magnet must only see the REVEALED
   * candles, or a point drawn in the blank right padding would snap to a
   * future candle's OHLC and leak its levels.
   */
  snapCandles?: Candlestick[] | React.RefObject<Candlestick[]>;
  /** Whether the chart can draw at all (the 其他币 panel stays read-only). */
  enabled?: boolean;
  /**
   * Chart-specific buttons rendered INSIDE the drawing toolbar, after the
   * drawing tools (the trade review puts its price-scale and marker toggles
   * there).
   */
  toolbarExtra?: ReactNode;
};

export type ChartDrawings = {
  drawingTool: ChartDrawingKind | null;
  selectDrawingTool: (tool: ChartDrawingKind | null) => void;
  drawings: ChartDrawing[];
  selectedDrawingId: string;
  setSelectedDrawingId: (id: string) => void;
  /** The tool row (水平线 / 射线 / 删除). `null` when the chart is read-only. */
  toolbar: ReactNode;
  /** The SVG overlay that hosts the drawn shapes. */
  overlay: ReactNode;
  /** The overlay's own ref — the chart must attach it to the `<svg>`. */
  overlayRef: React.RefObject<SVGSVGElement | null>;
  /** Re-render trigger for the shapes (the viewport moved). */
  overlayVersion: number;
  /** Bump `overlayVersion` — the chart calls this when the viewport moves. */
  bumpOverlay: () => void;
  magnetMode: MagnetMode;
  setMagnetMode: (mode: MagnetMode) => void;
};

/**
 * The drawing layer of one chart.
 *
 * The chart owns `chartApiRef` / `seriesRef` / `candles`; this hook owns the
 * drawings, the active tool, the drag state and the persistence.
 */
export function useChartDrawings(options: ChartDrawingsOptions): ChartDrawings {
  const { instrument, timeframe, tradeId = null, chartApiRef, seriesRef, candles } = options;
  const enabled = options.enabled ?? true;
  const overlayRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DrawingDrag | null>(null);
  const [drawingTool, setDrawingTool] = useState<ChartDrawingKind | null>(null);
  const [drawings, setDrawings] = useState<ChartDrawing[]>([]);
  const [selectedDrawingId, setSelectedDrawingId] = useState('');
  const [draftPoint, setDraftPoint] = useState<ChartPoint | null>(null);
  const [draftEndPoint, setDraftEndPoint] = useState<ChartPoint | null>(null);
  const [overlayVersion, setOverlayVersion] = useState(0);
  const [magnetMode, setMagnetMode] = useState<MagnetMode>('weak');

  // The magnet reads the CURRENT candles, so the options object is built on
  // every render (the chart re-renders when its candles change).
  const drawingSnap: DrawingSnapOptions = {
    candles: readCandles(options.snapCandles ?? options.candles),
    timeframe,
    mode: magnetMode,
  };

  /** The candles as an array, whether the caller passed an array or a ref. */
  function readCandles(input: Candlestick[] | React.RefObject<Candlestick[]>): Candlestick[] {
    return Array.isArray(input) ? input : (input.current ?? []);
  }

  // Load the instrument's drawings. Levels are per (instrument, timeframe), so
  // a timeframe switch reloads the set (each timeframe is measured with its
  // OWN volatility scale).
  useEffect(() => {
    setSelectedDrawingId('');
    setDraftPoint(null);
    setDraftEndPoint(null);
    if (!enabled) {
      setDrawings([]);
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({ instrument, timeframe });
    fetch(`/api/drawings?${params}`)
      .then((response) => response.json())
      .then(({ drawings: next }: { drawings?: ChartDrawing[] }) => {
        if (!cancelled) setDrawings(next ?? []);
      })
      .catch(() => {
        if (!cancelled) setDrawings([]);
      });
    return () => {
      cancelled = true;
    };
  }, [instrument, timeframe, enabled]);

  /**
   * The close of the last COMPLETED bar — the price basis of a new line.
   *
   * A line drawn on this chart belongs to THIS venue's price basis. The 距线
   * scan measures it on the scan source's candles, so the line records the
   * reference here and the scan rescales it (see `levelScaleFactor`).
   */
  function referenceBar(): { refPrice?: number; refTime?: number } {
    const last = readCandles(options.candles).at(-1);
    if (!last || !(last.close > 0)) return {};
    return { refPrice: last.close, refTime: last.timestamp };
  }

  async function saveDrawing(input: SaveChartDrawingInput) {
    const saved = (await fetch('/api/drawings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }).then((response) => response.json())) as ChartDrawing;
    setDrawings((current) => [...current.filter((drawing) => drawing.id !== saved.id), saved]);
    setSelectedDrawingId(saved.id);
  }

  async function deleteSelectedDrawing() {
    if (!selectedDrawingId) return;
    await fetch(`/api/drawings?${new URLSearchParams({ id: selectedDrawingId })}`, { method: 'DELETE' });
    setDrawings((current) => current.filter((drawing) => drawing.id !== selectedDrawingId));
    setSelectedDrawingId('');
  }

  /**
   * Picking a tool abandons any half-drawn point. Without this the leftover
   * draft keeps rendering — in the NEW tool's shape, since the preview follows
   * the active tool — as a line the user never drew and cannot click away.
   */
  function selectDrawingTool(tool: ChartDrawingKind | null) {
    setDrawingTool(tool);
    setDraftPoint(null);
    setDraftEndPoint(null);
  }

  function handleOverlayClick(event: React.MouseEvent<SVGSVGElement>) {
    if (!drawingTool) {
      setSelectedDrawingId('');
      return;
    }
    const point = pointFromMouse(event, chartApiRef.current, seriesRef.current, overlayRef.current, drawingSnap);
    if (!point) return;
    if (drawingTool === 'horizontal') {
      void saveDrawing({ tradeId, instrument, timeframe, kind: 'horizontal', points: [point], ...referenceBar() });
      return;
    }
    if (!draftPoint) {
      setDraftPoint(point);
      setDraftEndPoint(point);
      return;
    }
    void saveDrawing({ tradeId, instrument, timeframe, kind: drawingTool, points: [draftPoint, point], ...referenceBar() });
    setDraftPoint(null);
    setDraftEndPoint(null);
  }

  function handleDrawingPointerDown(event: React.PointerEvent<SVGElement>, drawing: ChartDrawing, target: DrawingDragTarget) {
    if (drawing.id === 'draft') return;
    // Unsnapped on purpose: this point only feeds the incremental 'body' translation.
    const point = pointFromPointer(event, chartApiRef.current, seriesRef.current, overlayRef.current, null);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    setDrawingTool(null);
    setSelectedDrawingId(drawing.id);
    dragRef.current = { drawing, target, startPoint: point };
    overlayRef.current?.setPointerCapture(event.pointerId);
  }

  function handleOverlayPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    const snappedPoint = pointFromPointer(event, chartApiRef.current, seriesRef.current, overlayRef.current, drawingSnap);
    const rawPoint = pointFromPointer(event, chartApiRef.current, seriesRef.current, overlayRef.current, null);
    if (!snappedPoint || !rawPoint) return;
    if (!drag) {
      if ((drawingTool === 'segment' || drawingTool === 'ray') && draftPoint) setDraftEndPoint(snappedPoint);
      return;
    }
    event.preventDefault();
    // Endpoint drags take the snapped point; 'body' translation stays continuous on the raw one.
    const point = drag.target === 'body' ? rawPoint : snappedPoint;
    const updated = moveDrawing(drag.drawing, drag.target, drag.startPoint, point);
    setDrawings((current) => current.map((drawing) => (drawing.id === updated.id ? updated : drawing)));
  }

  function handleOverlayPointerUp(event: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const snappedPoint = pointFromPointer(event, chartApiRef.current, seriesRef.current, overlayRef.current, drawingSnap);
    const rawPoint = pointFromPointer(event, chartApiRef.current, seriesRef.current, overlayRef.current, null);
    dragRef.current = null;
    overlayRef.current?.releasePointerCapture(event.pointerId);
    const point = drag.target === 'body' ? rawPoint : snappedPoint;
    if (!point) return;
    const updated = moveDrawing(drag.drawing, drag.target, drag.startPoint, point);
    setDrawings((current) => current.map((drawing) => (drawing.id === updated.id ? updated : drawing)));
    void saveDrawing(updated);
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && selectedDrawingId) {
        setSelectedDrawingId('');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedDrawingId]);

  const toolbar: ReactNode = enabled ? (
    <div className="drawing-toolbar">
      <button className={drawingTool === 'horizontal' ? 'selected' : ''} title="水平直线" onClick={() => selectDrawingTool(drawingTool === 'horizontal' ? null : 'horizontal')}><Minus size={16} /></button>
      <button className={drawingTool === 'ray' ? 'selected' : ''} title="射线" onClick={() => selectDrawingTool(drawingTool === 'ray' ? null : 'ray')}><MoveUpRight size={16} /></button>
      <button title="删除选中画线" disabled={!selectedDrawingId} onClick={deleteSelectedDrawing}><Eraser size={16} /></button>
      <button type="button" className={`magnet-mode${magnetMode !== 'off' ? ' selected' : ''}`} title={MAGNET_MODE_HINTS[magnetMode]} aria-label="磁吸模式" aria-pressed={magnetMode !== 'off'} onClick={() => setMagnetMode((current) => nextMagnetMode(current))}><Magnet size={16} />{MAGNET_MODE_LABELS[magnetMode]}</button>
      {options.toolbarExtra}
    </div>
  ) : null;

  const overlay: ReactNode = enabled ? (
    <svg
      ref={overlayRef}
      className={`drawing-overlay ${drawingTool ? 'drawing' : ''}`}
      onClick={handleOverlayClick}
      onPointerMove={handleOverlayPointerMove}
      onPointerUp={handleOverlayPointerUp}
      onPointerCancel={handleOverlayPointerUp}
    >
      {selectedDrawingId && !drawingTool && <rect width="100%" height="100%" fill="transparent" className="drawing-deselect-target" onClick={(event) => { event.stopPropagation(); setSelectedDrawingId(''); }} />}
      <DrawingOverlay
        drawings={drawings}
        selectedDrawingId={selectedDrawingId}
        draftPoint={draftPoint}
        draftEndPoint={draftEndPoint}
        draftKind={drawingTool}
        chart={chartApiRef.current}
        series={seriesRef.current}
        timeframe={timeframe}
        candles={readCandles(options.candles)}
        version={overlayVersion}
        onSelect={setSelectedDrawingId}
        onPointerDown={handleDrawingPointerDown}
      />
    </svg>
  ) : null;

  return {
    drawingTool,
    selectDrawingTool,
    drawings,
    selectedDrawingId,
    setSelectedDrawingId,
    toolbar,
    overlay,
    overlayRef,
    overlayVersion,
    bumpOverlay: () => setOverlayVersion((version) => version + 1),
    magnetMode,
    setMagnetMode,
  };
}

function DrawingOverlay({ drawings, selectedDrawingId, draftPoint, draftEndPoint, draftKind, chart, series, timeframe, candles, version, onSelect, onPointerDown }: {
  drawings: ChartDrawing[];
  selectedDrawingId: string;
  draftPoint: ChartPoint | null;
  draftEndPoint: ChartPoint | null;
  draftKind: ChartDrawingKind | null;
  chart: IChartApi | null;
  series: ISeriesApi<'Candlestick'> | null;
  timeframe: ReviewTimeframe;
  candles: Candlestick[];
  version: number;
  onSelect: (id: string) => void;
  onPointerDown: (event: React.PointerEvent<SVGElement>, drawing: ChartDrawing, target: DrawingDragTarget) => void;
}) {
  // The version is read so the overlay re-renders when the viewport moves (the
  // shapes are positioned in pixels, so a pan/zoom must re-place them).
  void version;
  if (!chart || !series) return null;
  return (
    <>
      {drawings.map((drawing) => <DrawingShape key={drawing.id} drawing={drawing} selected={drawing.id === selectedDrawingId} chart={chart} series={series} timeframe={timeframe} candles={candles} onSelect={onSelect} onPointerDown={onPointerDown} />)}
      {draftPoint && <DrawingShape drawing={{ id: 'draft', tradeId: '', instrument: '', timeframe, kind: draftKind ?? 'segment', points: [draftPoint, draftEndPoint ?? draftPoint], createdAt: '', updatedAt: '' }} selected={false} chart={chart} series={series} timeframe={timeframe} candles={candles} onSelect={() => {}} onPointerDown={() => {}} />}
    </>
  );
}

function DrawingShape({ drawing, selected, chart, series, timeframe, candles, onSelect, onPointerDown }: { drawing: ChartDrawing; selected: boolean; chart: IChartApi; series: ISeriesApi<'Candlestick'>; timeframe: ReviewTimeframe; candles: Candlestick[]; onSelect: (id: string) => void; onPointerDown: (event: React.PointerEvent<SVGElement>, drawing: ChartDrawing, target: DrawingDragTarget) => void }) {
  const color = selected ? '#FACC15' : '#38BDF8';
  const style = drawingStyleForTimeframe(timeframe);
  const width = selected ? style.selectedStrokeWidth : style.strokeWidth;
  if (drawing.kind === 'horizontal') {
    const y = series.priceToCoordinate(drawing.points[0]?.price ?? NaN);
    if (y == null) return null;
    return (
      <g>
        <line x1="0" x2="100%" y1={y} y2={y} stroke={color} strokeWidth={width} className="drawing-shape" onClick={(event) => { event.stopPropagation(); onSelect(drawing.id); }} onPointerDown={(event) => onPointerDown(event, drawing, 'body')} />
        {selected && <circle cx="24" cy={y} r={style.handleRadius} className="drawing-handle" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => onPointerDown(event, drawing, 'body')} />}
      </g>
    );
  }
  const points = drawing.points.map((point) => pointToScreen(drawing.id === 'draft' ? point : { ...point, time: timeframeTimeForPoint(point.time, timeframe, candles) }, chart, series));
  if (points.some((point) => !point)) return null;
  // A ray keeps its two handles on the real points (`'start'` = endpoint,
  // `'end'` = direction point) and only the drawn line runs past `'end'`.
  const start = points[0]!;
  const directionPoint = points[1]!;
  const end = drawing.kind === 'ray' ? rayEndPoint(start, directionPoint) : directionPoint;
  return (
    <g>
      <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={color} strokeWidth={width} className="drawing-shape" onClick={(event) => { event.stopPropagation(); onSelect(drawing.id); }} onPointerDown={(event) => onPointerDown(event, drawing, 'body')} />
      {selected && <circle cx={start.x} cy={start.y} r={style.handleRadius} className="drawing-handle" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => onPointerDown(event, drawing, 'start')} />}
      {selected && <circle cx={directionPoint.x} cy={directionPoint.y} r={style.handleRadius} className="drawing-handle" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => onPointerDown(event, drawing, 'end')} />}
    </g>
  );
}

/**
 * How far, in pixels, a ray is projected past its direction point.
 *
 * The overlay is a root `<svg>` filling `.chart-wrap`, so the root viewport
 * clips anything outside it (and `.chart-wrap` adds `overflow: hidden`). A
 * constant this large therefore ends at the visible edge without needing the
 * overlay's size — no size props and no `ResizeObserver`, and no dependency on
 * `timeScale().width()` / `paneSize()`, which the chart test mocks do not
 * provide.
 */
const RAY_LENGTH = 20000;

/** `start` projected towards `direction`, `RAY_LENGTH` pixels away. */
function rayEndPoint(start: { x: number; y: number }, direction: { x: number; y: number }): { x: number; y: number } {
  const dx = direction.x - start.x;
  const dy = direction.y - start.y;
  const length = Math.hypot(dx, dy);
  // Two clicks on the same spot leave no direction to extend along; fall back to
  // the plain two-point shape instead of dividing by zero (`NaN` coordinates).
  if (!Number.isFinite(length) || length === 0) return direction;
  return { x: start.x + (dx / length) * RAY_LENGTH, y: start.y + (dy / length) * RAY_LENGTH };
}

function drawingStyleForTimeframe(timeframe: ReviewTimeframe): { strokeWidth: number; selectedStrokeWidth: number; handleRadius: number } {
  if (timeframe === '5m' || timeframe === '15m') return { strokeWidth: 1, selectedStrokeWidth: 2, handleRadius: 4 };
  if (timeframe === '1H' || timeframe === '4H') return { strokeWidth: 1.5, selectedStrokeWidth: 2.5, handleRadius: 5 };
  return { strokeWidth: 2, selectedStrokeWidth: 3, handleRadius: 5 };
}

export function pointFromMouse(event: React.MouseEvent<SVGSVGElement>, chart: IChartApi | null, series: ISeriesApi<'Candlestick'> | null, overlay: SVGSVGElement | null, snap: DrawingSnapOptions | null = null): ChartPoint | null {
  return pointFromClient(event.clientX, event.clientY, chart, series, overlay, snap);
}

export function pointFromPointer(event: React.PointerEvent<SVGElement>, chart: IChartApi | null, series: ISeriesApi<'Candlestick'> | null, overlay: SVGSVGElement | null, snap: DrawingSnapOptions | null = null): ChartPoint | null {
  return pointFromClient(event.clientX, event.clientY, chart, series, overlay, snap);
}

function pointFromClient(clientX: number, clientY: number, chart: IChartApi | null, series: ISeriesApi<'Candlestick'> | null, overlay: SVGSVGElement | null, snap: DrawingSnapOptions | null = null): ChartPoint | null {
  if (!chart || !series || !overlay) return null;
  const rect = overlay.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const time = chart.timeScale().coordinateToTime(x);
  const price = series.coordinateToPrice(y);
  if (typeof time !== 'number' || price == null) return null;
  const point: ChartPoint = { time, price };
  if (!snap) return point;
  // The same pointer y drives both the raw price and the OHLC pixel distances.
  return snapDrawingPoint({
    point,
    pointerY: y,
    candles: snap.candles,
    timeframe: snap.timeframe,
    mode: snap.mode,
    priceToY: (candidate) => series.priceToCoordinate(candidate),
  });
}

export function moveDrawing(drawing: ChartDrawing, target: DrawingDragTarget, startPoint: ChartPoint, currentPoint: ChartPoint): ChartDrawing {
  const priceDelta = currentPoint.price - startPoint.price;
  const timeDelta = currentPoint.time - startPoint.time;
  const points = drawing.points.map((point, index) => {
    if (drawing.kind === 'horizontal') {
      return { ...point, price: point.price + priceDelta };
    }
    if (target === 'body') {
      return { time: point.time + timeDelta, price: point.price + priceDelta };
    }
    const shouldMove = (target === 'start' && index === 0) || (target === 'end' && index === 1);
    return shouldMove ? { time: currentPoint.time, price: currentPoint.price } : point;
  });
  return { ...drawing, points };
}

function pointToScreen(point: ChartPoint, chart: IChartApi, series: ISeriesApi<'Candlestick'>): { x: number; y: number } | null {
  const x = chart.timeScale().timeToCoordinate(point.time as UTCTimestamp);
  const y = series.priceToCoordinate(point.price);
  return x == null || y == null ? null : { x, y };
}
