import { CandlestickSeries, ColorType, createChart, createSeriesMarkers, CrosshairMode, type IChartApi, type ISeriesApi, type ISeriesMarkersPluginApi, type LogicalRange, type MouseEventParams, type Time, type UTCTimestamp } from 'lightweight-charts';
import { ChevronDown, ChevronUp, Eraser, Minus, Search, Slash } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Candlestick } from '../domain/candlestick';
import type { ChartDrawing, ChartDrawingKind, ChartPoint, SaveChartDrawingInput } from '../domain/drawing';
import type { TradeReview } from '../domain/review';
import type { ReviewedTrade, ReviewQueueOptions, SortField } from '../domain/review-queue';
import { reviewTimeframes, type ReviewTimeframe } from '../domain/trade';
import { isSameVisibleRange, shouldLoadEarlier, shouldLoadLater, type VisibleTimeRange } from './chart-autoload';
import { visibleRangeForAnchor, visibleRangeForLatestAnchor, type NavigationAnchor, type NumericVisibleRange } from './chart-navigation-anchor';
import { entryVisibleRange, formatChartTime, freeReplayCursorTimeForStart, freeReplayCursorTimeForTimeframeSwitch, timeframeMs, timeframeTimeForPoint } from './chart-time';
import { candlestickAtTime, formatCandlestickPrice } from './candlestick-readout';
import { FreeReplayPanel, type FreeReplayStart } from './FreeReplayPanel';
import { nextFreeReplayCursor, previousFreeReplayCursor, shouldPrefetchFutureCandles, visibleCandlesForFreeReplay } from './free-replay-chart';
import { ReviewEditor } from './ReviewEditor';
import { firstUnreviewedTrade, reviewProgress } from './review-progress';
import { tradeMarkers } from './trade-markers';

type TradeResponse = {
  trades: ReviewedTrade[];
  instruments: string[];
  tags: string[];
};

const sortLabels: Record<SortField, string> = {
  entryTime: '时间',
  returnRate: '收益率',
  profit: '收益',
  holdingMinutes: '持仓',
};

type DrawingDragTarget = 'body' | 'start' | 'end';
type ReviewMode = 'trade' | 'freeReplay';

type DrawingDrag = {
  drawing: ChartDrawing;
  target: DrawingDragTarget;
  startPoint: ChartPoint;
};

export function App() {
  const [filters, setFilters] = useState<ReviewQueueOptions>({ sortField: 'entryTime', sortDirection: 'asc' });
  const [data, setData] = useState<TradeResponse>({ trades: [], instruments: [], tags: [] });
  const [selectedId, setSelectedId] = useState<string>('');
  const selectedTradeRowRef = useRef<HTMLButtonElement | null>(null);
  const [timeframe, setTimeframe] = useState<ReviewTimeframe>('5m');
  const [reviewMode, setReviewMode] = useState<ReviewMode>('trade');
  const [freeReplay, setFreeReplay] = useState<FreeReplayStart | null>(null);
  const [freeReplayCandles, setFreeReplayCandles] = useState<Candlestick[]>([]);
  const selectedTrade = data.trades.find((trade) => trade.id === selectedId) ?? data.trades[0] ?? null;
  const progress = reviewProgress(data.trades, selectedTrade?.id ?? '');
  const nextUnreviewedTrade = firstUnreviewedTrade(data.trades);

  useEffect(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }
    fetch(`/api/trades?${params}`)
      .then((response) => response.json())
      .then((next: TradeResponse) => {
        setData(next);
        setSelectedId((current) => (next.trades.some((trade) => trade.id === current) ? current : next.trades[0]?.id ?? ''));
      });
  }, [filters]);

  function handleReviewSaved(review: TradeReview) {
    setData((current) => ({
      ...current,
      tags: [...new Set([...current.tags, ...review.tags])].sort(),
      trades: current.trades.map((trade) => (trade.id === review.tradeId ? { ...trade, review } : trade)),
    }));
  }

  function revealNextFreeReplayCandle() {
    setFreeReplay((current) => current ? { ...current, cursorTime: nextFreeReplayCursor(freeReplayCandles, current.cursorTime) } : current);
  }

  function rewindFreeReplayCandle() {
    setFreeReplay((current) => current ? { ...current, cursorTime: previousFreeReplayCursor(freeReplayCandles, current.cursorTime, current.startCursorTime) } : current);
  }

  function switchFreeReplayTimeframe(nextTimeframe: ReviewTimeframe) {
    setTimeframe(nextTimeframe);
    setFreeReplay((current) => current ? {
      ...current,
      startCursorTime: freeReplayCursorTimeForStart(current.startTime, nextTimeframe),
      cursorTime: freeReplayCursorTimeForTimeframeSwitch(current.cursorTime, nextTimeframe),
    } : current);
  }

  useEffect(() => {
    if (reviewMode !== 'freeReplay') return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        revealNextFreeReplayCandle();
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        rewindFreeReplayCandle();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [reviewMode, freeReplayCandles]);

  useEffect(() => {
    selectedTradeRowRef.current?.scrollIntoView({ block: 'center' });
  }, [selectedId]);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="mode-switch">
          <button className={reviewMode === 'trade' ? 'selected' : ''} onClick={() => setReviewMode('trade')}>Trade Review</button>
          <button className={reviewMode === 'freeReplay' ? 'selected' : ''} onClick={() => setReviewMode('freeReplay')}>Free Replay</button>
        </div>
        {reviewMode === 'trade' ? (
          <>
        <div className="toolbar">
          <div className="search-block">
            <Search size={16} />
            <select value={filters.instrument ?? ''} onChange={(event) => setFilters({ ...filters, instrument: event.target.value || undefined })}>
              <option value="">全部交易对</option>
              {data.instruments.map((instrument) => <option key={instrument}>{instrument}</option>)}
            </select>
          </div>
          <select value={filters.direction ?? ''} onChange={(event) => setFilters({ ...filters, direction: event.target.value as ReviewQueueOptions['direction'] || undefined })}>
            <option value="">多空</option>
            <option value="多">多</option>
            <option value="空">空</option>
          </select>
          <select value={filters.result ?? ''} onChange={(event) => setFilters({ ...filters, result: event.target.value as ReviewQueueOptions['result'] || undefined })}>
            <option value="">盈亏</option>
            <option value="profit">盈利</option>
            <option value="loss">亏损</option>
            <option value="flat">打平</option>
          </select>
          <select value={filters.tag ?? ''} onChange={(event) => setFilters({ ...filters, tag: event.target.value || undefined })}>
            <option value="">全部标签</option>
            {data.tags.map((tag) => <option key={tag}>{tag}</option>)}
          </select>
          <select value={filters.noteState ?? ''} onChange={(event) => setFilters({ ...filters, noteState: event.target.value as ReviewQueueOptions['noteState'] || undefined })}>
            <option value="">备注状态</option>
            <option value="withNote">有备注</option>
            <option value="withoutNote">无备注</option>
          </select>
          <div className="date-row">
            <input type="date" value={filters.startDate ?? ''} onChange={(event) => setFilters({ ...filters, startDate: event.target.value || undefined })} />
            <input type="date" value={filters.endDate ?? ''} onChange={(event) => setFilters({ ...filters, endDate: event.target.value || undefined })} />
          </div>
          <div className="sort-row">
            <select value={filters.sortField ?? 'entryTime'} onChange={(event) => setFilters({ ...filters, sortField: event.target.value as SortField })}>
              {(Object.keys(sortLabels) as SortField[]).map((field) => <option key={field} value={field}>{sortLabels[field]}</option>)}
            </select>
            <button className="icon-button" title="切换排序方向" onClick={() => setFilters({ ...filters, sortDirection: filters.sortDirection === 'desc' ? 'asc' : 'desc' })}>
              {filters.sortDirection === 'desc' ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
            </button>
          </div>
        </div>
        <div className="review-progress" aria-label="Review progress">
          <div>
            <span>当前</span>
            <strong>{progress.current ? progress.current.toLocaleString() : '-'} / {progress.total.toLocaleString()}</strong>
          </div>
          <div>
            <span>已复盘</span>
            <strong>{progress.reviewed.toLocaleString()} / {progress.total.toLocaleString()}</strong>
          </div>
          <div>
            <span>已复盘收益</span>
            <strong className={profitTone(progress.reviewedProfit)}>{formatSignedUsdt(progress.reviewedProfit)}</strong>
          </div>
          <button className="continue-review" disabled={!nextUnreviewedTrade} onClick={() => nextUnreviewedTrade && setSelectedId(nextUnreviewedTrade.id)}>
            {nextUnreviewedTrade ? '继续复盘' : '已完成'}
          </button>
        </div>
        <div className="trade-list">
          {data.trades.map((trade) => (
            <button key={trade.id} ref={trade.id === selectedTrade?.id ? selectedTradeRowRef : null} className={`trade-row ${trade.id === selectedTrade?.id ? 'active' : ''}`} onClick={() => setSelectedId(trade.id)}>
              <span className="time">{trade.entryTime.slice(0, 16).replace('T', ' ')}</span>
              <strong>{trade.instrument}</strong>
              <span className={trade.direction === '多' ? 'long' : 'short'}>{trade.direction}</span>
              <span className="trade-meta">{formatLeverage(trade.leverage)} · 平仓 {trade.exitTime.slice(5, 16).replace('T', ' ')}</span>
              <span className={trade.profit >= 0 ? 'profit' : 'loss'}>{formatPercent(trade.returnRate)} / {trade.profit.toFixed(2)}</span>
              <span className="tags">{trade.review?.tags.join(' · ') || '未标记'}</span>
            </button>
          ))}
        </div>
          </>
        ) : <FreeReplayPanel timeframe={timeframe} onStart={(next) => { setFreeReplay(next); setFreeReplayCandles([]); }} onReveal={revealNextFreeReplayCandle} onRewind={rewindFreeReplayCandle} />}
      </aside>
      <section className="workspace">
        {reviewMode === 'freeReplay' ? freeReplay ? (
          <>
            <header className="detail-header">
              <div>
                <h1>{freeReplay.instrument}</h1>
                <p>Free Replay from {freeReplay.startTime}</p>
              </div>
              <div className="timeframes">
                {reviewTimeframes.map((item) => <button key={item} className={item === timeframe ? 'selected' : ''} onClick={() => switchFreeReplayTimeframe(item)}>{item}</button>)}
              </div>
            </header>
            <FreeReplayChart replay={freeReplay} timeframe={timeframe} onCandlesLoaded={setFreeReplayCandles} />
          </>
        ) : (
          <div className="empty-state">Choose an instrument and start time to begin Free Replay</div>
        ) : selectedTrade ? (
          <>
            <header className="detail-header">
              <div>
                <h1>{selectedTrade.instrument}</h1>
                <p>{selectedTrade.entryTime.slice(0, 16).replace('T', ' ')} 到 {selectedTrade.exitTime.slice(0, 16).replace('T', ' ')}</p>
              </div>
              <div className="timeframes">
                {reviewTimeframes.map((item) => <button key={item} className={item === timeframe ? 'selected' : ''} onClick={() => setTimeframe(item)}>{item}</button>)}
              </div>
            </header>
            <TradeChart trade={selectedTrade} timeframe={timeframe} />
            <div className="review-panel">
              <div className="metrics">
                <Metric label="方向" value={selectedTrade.direction} />
                <Metric label="开仓" value={selectedTrade.entryPrice.toString()} />
                <Metric label="平仓" value={selectedTrade.exitPrice.toString()} />
                <Metric label="收益率" value={formatPercent(selectedTrade.returnRate)} tone={selectedTrade.returnRate >= 0 ? 'good' : 'bad'} />
                <Metric label="收益" value={`${selectedTrade.profit.toFixed(2)} USDT`} tone={selectedTrade.profit >= 0 ? 'good' : 'bad'} />
                <Metric label="持仓" value={`${selectedTrade.holdingMinutes} 分钟`} />
              </div>
              <ReviewEditor trade={selectedTrade} onSaved={handleReviewSaved} />
            </div>
          </>
        ) : <div className="empty-state">没有匹配的交易</div>}
      </section>
    </main>
  );
}

function FreeReplayChart({ replay, timeframe, onCandlesLoaded }: { replay: FreeReplayStart; timeframe: ReviewTimeframe; onCandlesLoaded: (candles: Candlestick[]) => void }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const loadingFutureRef = useRef(false);
  const lastFutureLoadAnchorRef = useRef<number | null>(null);
  const loadingEarlierRef = useRef(false);
  const lastLoadEarlierRangeRef = useRef<VisibleTimeRange | null>(null);
  const initializedRangeKeyRef = useRef('');
  const suppressAutoLoadRef = useRef(false);
  const pointerRef = useRef<{ inside: boolean; x: number }>({ inside: false, x: 0 });
  const pendingRenderRef = useRef(false);
  const idleTimerRef = useRef<number | null>(null);
  const latestAnchorRef = useRef<NavigationAnchor | null>(null);
  const loadedCandlesRef = useRef<Candlestick[]>([]);
  const dragRef = useRef<DrawingDrag | null>(null);
  const [loadedCandles, setLoadedCandles] = useState<Candlestick[]>([]);
  const [renderedCandles, setRenderedCandles] = useState<Candlestick[]>([]);
  const [status, setStatus] = useState('Loading candlesticks');
  const [drawingTool, setDrawingTool] = useState<ChartDrawingKind | null>(null);
  const [drawings, setDrawings] = useState<ChartDrawing[]>([]);
  const [selectedDrawingId, setSelectedDrawingId] = useState('');
  const [draftPoint, setDraftPoint] = useState<ChartPoint | null>(null);
  const [overlayVersion, setOverlayVersion] = useState(0);

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = createChart(chartRef.current, {
      layout: { background: { type: ColorType.Solid, color: '#101318' }, textColor: '#C9D1D9' },
      grid: { vertLines: { color: '#222832' }, horzLines: { color: '#222832' } },
      rightPriceScale: { borderColor: '#2D333B' },
      crosshair: { mode: CrosshairMode.Normal },
      localization: {
        locale: 'zh-CN',
        timeFormatter: (time: Time) => formatChartTime(time, timeframe),
      },
      timeScale: {
        borderColor: '#2D333B',
        tickMarkFormatter: (time: Time) => formatChartTime(time, timeframe),
      },
      autoSize: true,
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#16A34A',
      downColor: '#DC2626',
      borderVisible: false,
      wickUpColor: '#16A34A',
      wickDownColor: '#DC2626',
    });
    chartApiRef.current = chart;
    seriesRef.current = series;
    const refreshOverlay = () => setOverlayVersion((version) => version + 1);
    chart.timeScale().subscribeVisibleTimeRangeChange(refreshOverlay);
    return () => chart.remove();
  }, []);

  useEffect(() => {
    setSelectedDrawingId('');
    setDraftPoint(null);
    fetch(`/api/drawings?${new URLSearchParams({ instrument: replay.instrument })}`)
      .then((response) => response.json())
      .then(({ drawings: next }: { drawings?: ChartDrawing[] }) => setDrawings(next ?? []));
  }, [replay.instrument]);

  useEffect(() => {
    setStatus('Loading candlesticks');
    lastFutureLoadAnchorRef.current = null;
    lastLoadEarlierRangeRef.current = null;
    initializedRangeKeyRef.current = '';
    pendingRenderRef.current = false;
    latestAnchorRef.current = null;
    if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
    const params = new URLSearchParams({ instrument: replay.instrument, timeframe, entryTime: replay.startTime, mode: 'initial' });
    fetch(`/api/candles?${params}`)
      .then((response) => response.json())
      .then(({ candles }: { candles: Candlestick[] }) => {
        const merged = mergeCandles(candles);
        updateLoadedCandles(merged);
        setRenderedCandles(merged);
        setStatus(merged.length ? '' : 'No candlesticks');
      })
      .catch(() => setStatus('Candlestick loading failed'));
  }, [replay.instrument, replay.startTime, timeframe]);

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartApiRef.current;
    if (!series || !chart) return;
    const visibleCandles = visibleCandlesForFreeReplay(renderedCandles, replay.cursorTime);
    const range = entryVisibleRange(replay.startTime, timeframe);
    const rangeTo = Math.floor(replay.cursorTime + timeframeMs(timeframe) * 10 / 1000) as UTCTimestamp;
    series.setData(chartDataWithWhitespace(visibleCandles, [Number(range.from) * 1000, Number(rangeTo) * 1000]));
    const rangeKey = `${replay.instrument}:${replay.startTime}:${timeframe}`;
    if (visibleCandles.length && initializedRangeKeyRef.current !== rangeKey) {
      initializedRangeKeyRef.current = rangeKey;
      suppressAutoLoadRef.current = true;
      chart.timeScale().setVisibleRange({ from: range.from, to: rangeTo });
      window.setTimeout(() => {
        suppressAutoLoadRef.current = false;
      }, 0);
    }
  }, [renderedCandles, replay.cursorTime, replay.instrument, replay.startTime, timeframe]);

  useEffect(() => {
    if (!loadedCandlesRef.current.length) return;
    setRenderedCandles(loadedCandlesRef.current);
  }, [replay.cursorTime]);

  useEffect(() => {
    const chart = chartApiRef.current;
    if (!chart) return;
    const handler = (_range: LogicalRange | null) => {
      if (suppressAutoLoadRef.current) return;
      const visible = chart.timeScale().getVisibleRange();
      if (!visible || loadedCandles.length < 2) return;
      latestAnchorRef.current = captureFreeReplayNavigationAnchor(chart) ?? latestAnchorRef.current;
      const visibleRange = { from: Number(visible.from), to: Number(visible.to) };
      if (!Number.isFinite(visibleRange.from) || !Number.isFinite(visibleRange.to)) return;
      const first = loadedCandles[0].timestamp / 1000;
      const last = loadedCandles[loadedCandles.length - 1].timestamp / 1000;
      const span = visibleRange.to - visibleRange.from;
      const threshold = Math.max(span * 0.35, inferCandleStep(loadedCandles) / 1000 * 20);
      if (shouldLoadEarlier(visibleRange, { first, last }, threshold) && !isSameVisibleRange(lastLoadEarlierRangeRef.current, visibleRange)) {
        lastLoadEarlierRangeRef.current = visibleRange;
        void loadEarlierFreeReplayCandles();
      }
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(handler);
    return () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
  }, [loadedCandles, replay.instrument, replay.startTime, timeframe]);

  useEffect(() => {
    const last = loadedCandles[loadedCandles.length - 1];
    if (!last || loadingFutureRef.current || lastFutureLoadAnchorRef.current === last.timestamp) return;
    if (!shouldPrefetchFutureCandles(loadedCandles, replay.cursorTime, 20)) return;
    loadingFutureRef.current = true;
    lastFutureLoadAnchorRef.current = last.timestamp;
    const params = new URLSearchParams({
      instrument: replay.instrument,
      timeframe,
      entryTime: replay.startTime,
      mode: 'later',
      anchor: String(last.timestamp),
    });
    fetch(`/api/candles?${params}`)
      .then((response) => response.json())
      .then(({ candles }: { candles: Candlestick[] }) => {
        if (!candles.length) return;
        const merged = mergeCandles([...loadedCandlesRef.current, ...candles]);
        loadedCandlesRef.current = merged;
        onCandlesLoaded(merged);
      })
      .catch(() => {
        setStatus('Future candlestick loading failed');
      })
      .finally(() => {
        loadingFutureRef.current = false;
      });
  }, [loadedCandles, replay.cursorTime, replay.instrument, replay.startTime, timeframe]);

  async function loadEarlierFreeReplayCandles() {
    const chart = chartApiRef.current;
    if (loadingEarlierRef.current || !chart || !loadedCandles.length) return;
    loadingEarlierRef.current = true;
    setStatus('Loading earlier candlesticks');
    const anchor = loadedCandles[0].timestamp;
    const params = new URLSearchParams({
      instrument: replay.instrument,
      timeframe,
      entryTime: replay.startTime,
      mode: 'earlier',
      anchor: String(anchor),
    });
    try {
      const { candles } = (await fetch(`/api/candles?${params}`).then((response) => response.json())) as { candles: Candlestick[] };
      if (candles.length) {
        setLoadedCandles((current) => {
          const merged = mergeCandles([...current, ...candles]);
          loadedCandlesRef.current = merged;
          onCandlesLoaded(merged);
          return merged;
        });
        pendingRenderRef.current = true;
        scheduleFreeReplayPendingRender();
      }
      setStatus('');
    } catch {
      setStatus('Earlier candlestick loading failed');
    } finally {
      loadingEarlierRef.current = false;
    }
  }

  function updateLoadedCandles(candles: Candlestick[]) {
    loadedCandlesRef.current = candles;
    setLoadedCandles(candles);
    onCandlesLoaded(candles);
  }

  function scheduleFreeReplayPendingRender() {
    if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => {
      idleTimerRef.current = null;
      applyFreeReplayPendingCandles();
    }, 250);
  }

  function applyFreeReplayPendingCandles() {
    if (!pendingRenderRef.current) return;
    const chart = chartApiRef.current;
    if (!chart) return;
    const visible = currentFreeReplayVisibleRange(chart);
    if (!visible) return;
    const anchor = latestAnchorRef.current ?? captureFreeReplayNavigationAnchor(chart);
    pendingRenderRef.current = false;
    suppressAutoLoadRef.current = true;
    setRenderedCandles(loadedCandlesRef.current);
    if (anchor) {
      chart.timeScale().setVisibleRange(visibleRangeForLatestAnchor(visible, anchor) as { from: UTCTimestamp; to: UTCTimestamp });
    } else {
      chart.timeScale().setVisibleRange(visible as { from: UTCTimestamp; to: UTCTimestamp });
    }
    window.setTimeout(() => {
      suppressAutoLoadRef.current = false;
    }, 0);
  }

  function captureFreeReplayNavigationAnchor(chart: IChartApi): NavigationAnchor | null {
    const visible = currentFreeReplayVisibleRange(chart);
    if (!visible) return null;
    const rect = chartRef.current?.getBoundingClientRect();
    if (pointerRef.current.inside && rect && rect.width > 0) {
      const x = Math.min(Math.max(pointerRef.current.x - rect.left, 0), rect.width);
      const time = chart.timeScale().coordinateToTime(x);
      if (typeof time === 'number') return { time, ratio: x / rect.width };
    }
    return { time: (visible.from + visible.to) / 2, ratio: 0.5 };
  }

  function currentFreeReplayVisibleRange(chart: IChartApi): NumericVisibleRange | null {
    const visible = chart.timeScale().getVisibleRange();
    if (!visible) return null;
    const from = Number(visible.from);
    const to = Number(visible.to);
    return Number.isFinite(from) && Number.isFinite(to) && to > from ? { from, to } : null;
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

  function handleOverlayClick(event: React.MouseEvent<SVGSVGElement>) {
    if (!drawingTool) return;
    const point = pointFromMouse(event, chartApiRef.current, seriesRef.current, overlayRef.current);
    if (!point) return;
    if (drawingTool === 'horizontal') {
      void saveDrawing({ tradeId: null, instrument: replay.instrument, timeframe, kind: 'horizontal', points: [point] });
      return;
    }
    if (!draftPoint) {
      setDraftPoint(point);
      return;
    }
    void saveDrawing({ tradeId: null, instrument: replay.instrument, timeframe, kind: 'segment', points: [draftPoint, point] });
    setDraftPoint(null);
  }

  function handleDrawingPointerDown(event: React.PointerEvent<SVGElement>, drawing: ChartDrawing, target: DrawingDragTarget) {
    if (drawing.id === 'draft') return;
    const point = pointFromPointer(event, chartApiRef.current, seriesRef.current, overlayRef.current);
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
    if (!drag) return;
    const point = pointFromPointer(event, chartApiRef.current, seriesRef.current, overlayRef.current);
    if (!point) return;
    event.preventDefault();
    const updated = moveDrawing(drag.drawing, drag.target, drag.startPoint, point);
    setDrawings((current) => current.map((drawing) => (drawing.id === updated.id ? updated : drawing)));
  }

  function handleOverlayPointerUp(event: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const point = pointFromPointer(event, chartApiRef.current, seriesRef.current, overlayRef.current);
    dragRef.current = null;
    overlayRef.current?.releasePointerCapture(event.pointerId);
    if (!point) return;
    const updated = moveDrawing(drag.drawing, drag.target, drag.startPoint, point);
    setDrawings((current) => current.map((drawing) => (drawing.id === updated.id ? updated : drawing)));
    void saveDrawing(updated);
  }

  return (
    <div className="chart-wrap" onPointerMove={(event) => { pointerRef.current = { inside: true, x: event.clientX }; }} onPointerLeave={() => { pointerRef.current.inside = false; }}>
      <div className="drawing-toolbar">
        <button className={drawingTool === 'horizontal' ? 'selected' : ''} title="Horizontal line" onClick={() => setDrawingTool(drawingTool === 'horizontal' ? null : 'horizontal')}><Minus size={16} /></button>
        <button className={drawingTool === 'segment' ? 'selected' : ''} title="Segment" onClick={() => setDrawingTool(drawingTool === 'segment' ? null : 'segment')}><Slash size={16} /></button>
        <button title="Delete selected drawing" disabled={!selectedDrawingId} onClick={deleteSelectedDrawing}><Eraser size={16} /></button>
      </div>
      <div ref={chartRef} className="chart" />
      <svg ref={overlayRef} className={`drawing-overlay ${drawingTool ? 'drawing' : ''}`} onClick={handleOverlayClick} onPointerMove={handleOverlayPointerMove} onPointerUp={handleOverlayPointerUp} onPointerCancel={handleOverlayPointerUp}>
        <DrawingOverlay drawings={drawings} selectedDrawingId={selectedDrawingId} draftPoint={draftPoint} chart={chartApiRef.current} series={seriesRef.current} timeframe={timeframe} candles={renderedCandles} version={overlayVersion} onSelect={setSelectedDrawingId} onPointerDown={handleDrawingPointerDown} />
      </svg>
      {status && <div className="chart-status">{status}</div>}
    </div>
  );
}

function TradeChart({ trade, timeframe }: { trade: ReviewedTrade; timeframe: ReviewTimeframe }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const candlesRef = useRef<Candlestick[]>([]);
  const renderedCandlesRef = useRef<Candlestick[]>([]);
  const loadingRef = useRef<{ earlier: boolean; later: boolean }>({ earlier: false, later: false });
  const lastLoadRangeRef = useRef<{ earlier: VisibleTimeRange | null; later: VisibleTimeRange | null }>({ earlier: null, later: null });
  const pointerRef = useRef<{ inside: boolean; x: number }>({ inside: false, x: 0 });
  const pendingRenderRef = useRef(false);
  const idleTimerRef = useRef<number | null>(null);
  const latestAnchorRef = useRef<NavigationAnchor | null>(null);
  const activeKeyRef = useRef('');
  const suppressAutoLoadRef = useRef(false);
  const dragRef = useRef<DrawingDrag | null>(null);
  const [status, setStatus] = useState('加载 K 线');
  const [drawingTool, setDrawingTool] = useState<ChartDrawingKind | null>(null);
  const [drawings, setDrawings] = useState<ChartDrawing[]>([]);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string>('');
  const [draftPoint, setDraftPoint] = useState<ChartPoint | null>(null);
  const [activeCandle, setActiveCandle] = useState<Candlestick | null>(null);
  const [overlayVersion, setOverlayVersion] = useState(0);

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = createChart(chartRef.current, {
      layout: { background: { type: ColorType.Solid, color: '#101318' }, textColor: '#C9D1D9' },
      grid: { vertLines: { color: '#222832' }, horzLines: { color: '#222832' } },
      rightPriceScale: { borderColor: '#2D333B' },
      crosshair: { mode: CrosshairMode.Normal },
      localization: {
        locale: 'zh-CN',
        timeFormatter: (time: Time) => formatChartTime(time, timeframe),
      },
      timeScale: {
        borderColor: '#2D333B',
        tickMarkFormatter: (time: Time) => formatChartTime(time, timeframe),
      },
      autoSize: true,
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#16A34A',
      downColor: '#DC2626',
      borderVisible: false,
      wickUpColor: '#16A34A',
      wickDownColor: '#DC2626',
    });
    chartApiRef.current = chart;
    seriesRef.current = series;
    markersRef.current = createSeriesMarkers(series, []);
    const refreshOverlay = () => setOverlayVersion((version) => version + 1);
    const updateActiveCandle = (param: MouseEventParams) => {
      setActiveCandle(candlestickAtTime(renderedCandlesRef.current, param.time));
    };
    chart.timeScale().subscribeVisibleTimeRangeChange(refreshOverlay);
    chart.subscribeCrosshairMove(updateActiveCandle);
    return () => chart.remove();
  }, []);

  useEffect(() => {
    setSelectedDrawingId('');
    setDraftPoint(null);
    fetch(`/api/drawings?${new URLSearchParams({ instrument: trade.instrument })}`)
      .then((response) => response.json())
      .then(({ drawings: next }: { drawings: ChartDrawing[] }) => setDrawings(next));
  }, [trade.instrument]);

  useEffect(() => {
    setStatus('加载 K 线');
    const key = `${trade.id}:${timeframe}`;
    activeKeyRef.current = key;
    candlesRef.current = [];
    renderedCandlesRef.current = [];
    setActiveCandle(null);
    loadingRef.current = { earlier: false, later: false };
    lastLoadRangeRef.current = { earlier: null, later: null };
    pendingRenderRef.current = false;
    latestAnchorRef.current = null;
    if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
    const params = new URLSearchParams({ instrument: trade.instrument, timeframe, entryTime: trade.entryTime, mode: 'initial' });
    fetch(`/api/candles?${params}`)
      .then((response) => response.json())
      .then(({ candles }: { candles: Candlestick[] }) => {
        if (activeKeyRef.current !== key) return;
        const series = seriesRef.current;
        const chart = chartApiRef.current;
        if (!series || !chart) return;
        candlesRef.current = mergeCandles(candles);
        renderedCandlesRef.current = candlesRef.current;
        const entryRange = entryVisibleRange(trade.entryTime, timeframe);
        suppressAutoLoadRef.current = true;
        renderCandles(trade, timeframe, candlesRef.current, series, markersRef.current);
        chart.timeScale().setVisibleRange(entryRange);
        window.setTimeout(() => {
          suppressAutoLoadRef.current = false;
        }, 0);
        setStatus(candles.length ? '' : '没有拿到 K 线');
      })
      .catch(() => setStatus('K 线加载失败'));
  }, [trade.id, timeframe]);

  useEffect(() => {
    const chart = chartApiRef.current;
    if (!chart) return;
    const handler = (range: LogicalRange | null) => {
      if (suppressAutoLoadRef.current) return;
      const visible = chart.timeScale().getVisibleRange();
      if (!range || !visible || candlesRef.current.length < 2) return;
      latestAnchorRef.current = captureNavigationAnchor(chart) ?? latestAnchorRef.current;
      schedulePendingRender();
      const first = candlesRef.current[0].timestamp / 1000;
      const last = candlesRef.current[candlesRef.current.length - 1].timestamp / 1000;
      const visibleRange = { from: Number(visible.from), to: Number(visible.to) };
      const span = Number(visible.to) - Number(visible.from);
      const threshold = Math.max(span * 0.35, inferCandleStep(candlesRef.current) / 1000 * 20);
      if (shouldLoadEarlier(visibleRange, { first, last }, threshold) && !isSameVisibleRange(lastLoadRangeRef.current.earlier, visibleRange)) {
        lastLoadRangeRef.current.earlier = visibleRange;
        void loadMore('earlier');
      }
      if (shouldLoadLater(visibleRange, { first, last }, threshold) && !isSameVisibleRange(lastLoadRangeRef.current.later, visibleRange)) {
        lastLoadRangeRef.current.later = visibleRange;
        void loadMore('later');
      }
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(handler);
    return () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
  }, [trade.id, timeframe]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      const chart = chartApiRef.current;
      if (!chart) return;
      const visible = currentVisibleRange(chart);
      if (!visible) return;
      event.preventDefault();
      const step = timeframeMs(timeframe) / 1000;
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      chart.timeScale().setVisibleRange({
        from: (visible.from + step * direction) as UTCTimestamp,
        to: (visible.to + step * direction) as UTCTimestamp,
      });
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [timeframe]);

  function schedulePendingRender() {
    if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => {
      idleTimerRef.current = null;
      applyPendingCandles();
    }, 250);
  }

  function applyPendingCandles() {
    if (!pendingRenderRef.current) return;
    const series = seriesRef.current;
    const chart = chartApiRef.current;
    if (!series || !chart) return;
    const visible = currentVisibleRange(chart);
    const anchor = latestAnchorRef.current ?? captureNavigationAnchor(chart);
    pendingRenderRef.current = false;
    renderedCandlesRef.current = candlesRef.current;
    suppressAutoLoadRef.current = true;
    renderCandles(trade, timeframe, renderedCandlesRef.current, series, markersRef.current);
    if (visible && anchor) {
      chart.timeScale().setVisibleRange(visibleRangeForAnchor(anchor, visible.to - visible.from) as { from: UTCTimestamp; to: UTCTimestamp });
    }
    window.setTimeout(() => {
      suppressAutoLoadRef.current = false;
    }, 0);
  }

  function captureNavigationAnchor(chart: IChartApi): NavigationAnchor | null {
    const visible = currentVisibleRange(chart);
    if (!visible) return null;
    const rect = chartRef.current?.getBoundingClientRect();
    if (pointerRef.current.inside && rect && rect.width > 0) {
      const x = Math.min(Math.max(pointerRef.current.x - rect.left, 0), rect.width);
      const time = chart.timeScale().coordinateToTime(x);
      if (typeof time === 'number') return { time, ratio: x / rect.width };
    }
    return { time: (visible.from + visible.to) / 2, ratio: 0.5 };
  }

  function currentVisibleRange(chart: IChartApi): NumericVisibleRange | null {
    const visible = chart.timeScale().getVisibleRange();
    if (!visible) return null;
    const from = Number(visible.from);
    const to = Number(visible.to);
    return Number.isFinite(from) && Number.isFinite(to) && to > from ? { from, to } : null;
  }

  async function loadMore(direction: 'earlier' | 'later') {
    if (loadingRef.current[direction] || !candlesRef.current.length) return;
    loadingRef.current[direction] = true;
    setStatus(direction === 'earlier' ? '加载更早 K 线' : '加载更晚 K 线');
    const anchor = direction === 'earlier' ? candlesRef.current[0].timestamp : candlesRef.current[candlesRef.current.length - 1].timestamp;
    const params = new URLSearchParams({
      instrument: trade.instrument,
      timeframe,
      entryTime: trade.entryTime,
      mode: direction,
      anchor: String(anchor),
    });
    try {
      const { candles } = (await fetch(`/api/candles?${params}`).then((response) => response.json())) as { candles: Candlestick[] };
      if (candles.length) {
        candlesRef.current = mergeCandles([...candlesRef.current, ...candles]);
        pendingRenderRef.current = true;
        schedulePendingRender();
      }
      setStatus('');
    } catch {
      setStatus('K 线加载失败');
    } finally {
      loadingRef.current[direction] = false;
    }
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

  function handleOverlayClick(event: React.MouseEvent<SVGSVGElement>) {
    if (!drawingTool) return;
    const point = pointFromMouse(event, chartApiRef.current, seriesRef.current, overlayRef.current);
    if (!point) return;
    if (drawingTool === 'horizontal') {
      void saveDrawing({ tradeId: trade.id, instrument: trade.instrument, timeframe, kind: 'horizontal', points: [point] });
      return;
    }
    if (!draftPoint) {
      setDraftPoint(point);
      return;
    }
    void saveDrawing({ tradeId: trade.id, instrument: trade.instrument, timeframe, kind: 'segment', points: [draftPoint, point] });
    setDraftPoint(null);
  }

  function handleDrawingPointerDown(event: React.PointerEvent<SVGElement>, drawing: ChartDrawing, target: DrawingDragTarget) {
    if (drawing.id === 'draft') return;
    const point = pointFromPointer(event, chartApiRef.current, seriesRef.current, overlayRef.current);
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
    if (!drag) return;
    const point = pointFromPointer(event, chartApiRef.current, seriesRef.current, overlayRef.current);
    if (!point) return;
    event.preventDefault();
    const updated = moveDrawing(drag.drawing, drag.target, drag.startPoint, point);
    setDrawings((current) => current.map((drawing) => (drawing.id === updated.id ? updated : drawing)));
  }

  function handleOverlayPointerUp(event: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const point = pointFromPointer(event, chartApiRef.current, seriesRef.current, overlayRef.current);
    dragRef.current = null;
    overlayRef.current?.releasePointerCapture(event.pointerId);
    if (!point) return;
    const updated = moveDrawing(drag.drawing, drag.target, drag.startPoint, point);
    setDrawings((current) => current.map((drawing) => (drawing.id === updated.id ? updated : drawing)));
    void saveDrawing(updated);
  }

  return (
    <div className="chart-wrap" onPointerMove={(event) => { pointerRef.current = { inside: true, x: event.clientX }; }} onPointerLeave={() => { pointerRef.current.inside = false; setActiveCandle(null); }}>
      <div className="drawing-toolbar">
        <button className={drawingTool === 'horizontal' ? 'selected' : ''} title="水平直线" onClick={() => setDrawingTool(drawingTool === 'horizontal' ? null : 'horizontal')}><Minus size={16} /></button>
        <button className={drawingTool === 'segment' ? 'selected' : ''} title="线段" onClick={() => setDrawingTool(drawingTool === 'segment' ? null : 'segment')}><Slash size={16} /></button>
        <button title="删除选中画线" disabled={!selectedDrawingId} onClick={deleteSelectedDrawing}><Eraser size={16} /></button>
      </div>
      <CandlestickReadout candle={activeCandle} timeframe={timeframe} />
      <div ref={chartRef} className="chart" />
      <svg ref={overlayRef} className={`drawing-overlay ${drawingTool ? 'drawing' : ''}`} onClick={handleOverlayClick} onPointerMove={handleOverlayPointerMove} onPointerUp={handleOverlayPointerUp} onPointerCancel={handleOverlayPointerUp}>
        <DrawingOverlay drawings={drawings} selectedDrawingId={selectedDrawingId} draftPoint={draftPoint} chart={chartApiRef.current} series={seriesRef.current} timeframe={timeframe} candles={renderedCandlesRef.current} version={overlayVersion} onSelect={setSelectedDrawingId} onPointerDown={handleDrawingPointerDown} />
      </svg>
      {status && <div className="chart-status">{status}</div>}
    </div>
  );
}

function CandlestickReadout({ candle, timeframe }: { candle: Candlestick | null; timeframe: ReviewTimeframe }) {
  if (!candle) return null;
  const fields = [
    ['开', candle.open],
    ['高', candle.high],
    ['低', candle.low],
    ['收', candle.close],
  ] as const;
  return (
    <div className="candlestick-readout">
      <span className="readout-time">{formatChartTime(Math.floor(candle.timestamp / 1000) as UTCTimestamp, timeframe)}</span>
      {fields.map(([label, value]) => <span key={label}><span>{label}</span>{formatCandlestickPrice(value)}</span>)}
    </div>
  );
}

function DrawingOverlay({ drawings, selectedDrawingId, draftPoint, chart, series, timeframe, candles, version, onSelect, onPointerDown }: {
  drawings: ChartDrawing[];
  selectedDrawingId: string;
  draftPoint: ChartPoint | null;
  chart: IChartApi | null;
  series: ISeriesApi<'Candlestick'> | null;
  timeframe: ReviewTimeframe;
  candles: Candlestick[];
  version: number;
  onSelect: (id: string) => void;
  onPointerDown: (event: React.PointerEvent<SVGElement>, drawing: ChartDrawing, target: DrawingDragTarget) => void;
}) {
  void version;
  if (!chart || !series) return null;
  return (
    <>
      {drawings.map((drawing) => <DrawingShape key={drawing.id} drawing={drawing} selected={drawing.id === selectedDrawingId} chart={chart} series={series} timeframe={timeframe} candles={candles} onSelect={onSelect} onPointerDown={onPointerDown} />)}
      {draftPoint && <DrawingShape drawing={{ id: 'draft', tradeId: '', instrument: '', timeframe, kind: 'segment', points: [draftPoint, draftPoint], createdAt: '', updatedAt: '' }} selected={false} chart={chart} series={series} timeframe={timeframe} candles={candles} onSelect={() => {}} onPointerDown={() => {}} />}
    </>
  );
}

function DrawingShape({ drawing, selected, chart, series, timeframe, candles, onSelect, onPointerDown }: { drawing: ChartDrawing; selected: boolean; chart: IChartApi; series: ISeriesApi<'Candlestick'>; timeframe: ReviewTimeframe; candles: Candlestick[]; onSelect: (id: string) => void; onPointerDown: (event: React.PointerEvent<SVGElement>, drawing: ChartDrawing, target: DrawingDragTarget) => void }) {
  const color = selected ? '#FACC15' : '#38BDF8';
  const width = selected ? 3 : 2;
  if (drawing.kind === 'horizontal') {
    const y = series.priceToCoordinate(drawing.points[0]?.price ?? NaN);
    if (y == null) return null;
    return (
      <g>
        <line x1="0" x2="100%" y1={y} y2={y} stroke={color} strokeWidth={width} className="drawing-shape" onClick={(event) => { event.stopPropagation(); onSelect(drawing.id); }} onPointerDown={(event) => onPointerDown(event, drawing, 'body')} />
        {selected && <circle cx="24" cy={y} r="5" className="drawing-handle" onPointerDown={(event) => onPointerDown(event, drawing, 'body')} />}
      </g>
    );
  }
  const points = drawing.points.map((point) => pointToScreen({ ...point, time: timeframeTimeForPoint(point.time, timeframe, candles) }, chart, series));
  if (points.some((point) => !point)) return null;
  return (
    <g>
      <line x1={points[0]!.x} y1={points[0]!.y} x2={points[1]!.x} y2={points[1]!.y} stroke={color} strokeWidth={width} className="drawing-shape" onClick={(event) => { event.stopPropagation(); onSelect(drawing.id); }} onPointerDown={(event) => onPointerDown(event, drawing, 'body')} />
      {selected && <circle cx={points[0]!.x} cy={points[0]!.y} r="5" className="drawing-handle" onPointerDown={(event) => onPointerDown(event, drawing, 'start')} />}
      {selected && <circle cx={points[1]!.x} cy={points[1]!.y} r="5" className="drawing-handle" onPointerDown={(event) => onPointerDown(event, drawing, 'end')} />}
    </g>
  );
}

function pointFromMouse(event: React.MouseEvent<SVGSVGElement>, chart: IChartApi | null, series: ISeriesApi<'Candlestick'> | null, overlay: SVGSVGElement | null): ChartPoint | null {
  return pointFromClient(event.clientX, event.clientY, chart, series, overlay);
}

function pointFromPointer(event: React.PointerEvent<SVGElement>, chart: IChartApi | null, series: ISeriesApi<'Candlestick'> | null, overlay: SVGSVGElement | null): ChartPoint | null {
  return pointFromClient(event.clientX, event.clientY, chart, series, overlay);
}

function pointFromClient(clientX: number, clientY: number, chart: IChartApi | null, series: ISeriesApi<'Candlestick'> | null, overlay: SVGSVGElement | null): ChartPoint | null {
  if (!chart || !series || !overlay) return null;
  const rect = overlay.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const time = chart.timeScale().coordinateToTime(x);
  const price = series.coordinateToPrice(y);
  if (typeof time !== 'number' || price == null) return null;
  return { time, price };
}

function moveDrawing(drawing: ChartDrawing, target: DrawingDragTarget, startPoint: ChartPoint, currentPoint: ChartPoint): ChartDrawing {
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

function renderCandles(trade: ReviewedTrade, timeframe: ReviewTimeframe, candles: Candlestick[], series: ISeriesApi<'Candlestick'>, markers: ISeriesMarkersPluginApi<Time> | null) {
  const nextMarkers = tradeMarkers(trade, timeframe, candles);
  series.setData(chartDataWithWhitespace(candles, nextMarkers.map((marker) => Number(marker.time) * 1000)));
  markers?.setMarkers(nextMarkers);
}

function chartDataWithWhitespace(candles: Candlestick[], extraTimestamps: number[] = []) {
  const real = candles.map((candle) => ({
    time: Math.floor(candle.timestamp / 1000) as UTCTimestamp,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  }));
  if (candles.length < 2) return real;

  const step = inferCandleStep(candles);
  const first = candles[0].timestamp;
  const last = candles[candles.length - 1].timestamp;
  const padCount = 200;
  const left = Array.from({ length: padCount }, (_, index) => ({
    time: Math.floor((first - step * (padCount - index)) / 1000) as UTCTimestamp,
  }));
  const right = Array.from({ length: padCount }, (_, index) => ({
    time: Math.floor((last + step * (index + 1)) / 1000) as UTCTimestamp,
  }));
  const occupied = new Set(real.map((item) => item.time));
  const extraWhitespace = extraTimestamps
    .map((timestamp) => Math.floor(timestamp / 1000) as UTCTimestamp)
    .filter((time) => !occupied.has(time))
    .map((time) => ({ time }));
  const sorted = [...left, ...real, ...right, ...extraWhitespace].sort((a, b) => Number(a.time) - Number(b.time));
  return [...new Map(sorted.map((item) => [Number(item.time), item])).values()];
}

function inferCandleStep(candles: Candlestick[]): number {
  for (let index = 1; index < candles.length; index += 1) {
    const diff = candles[index].timestamp - candles[index - 1].timestamp;
    if (diff > 0) return diff;
  }
  return 5 * 60_000;
}

function mergeCandles(candles: Candlestick[]): Candlestick[] {
  return [...new Map(candles.map((candle) => [candle.timestamp, candle])).values()].sort((a, b) => a.timestamp - b.timestamp);
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return <div className="metric"><span>{label}</span><strong className={tone ?? ''}>{value}</strong></div>;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function formatSignedUsdt(value: number): string {
  const normalized = Object.is(value, -0) ? 0 : value;
  const sign = normalized > 0 ? '+' : '';
  return `${sign}${normalized.toFixed(2)} USDT`;
}

function profitTone(value: number): 'good' | 'bad' | undefined {
  if (value > 0) return 'good';
  if (value < 0) return 'bad';
  return undefined;
}

function formatLeverage(value: number): string {
  return `${Number.isInteger(value) ? value.toString() : value.toFixed(2)}x`;
}
