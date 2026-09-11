import { CandlestickSeries, ColorType, createChart, CrosshairMode, type IChartApi, type ISeriesApi, type LogicalRange, type Time, type UTCTimestamp } from 'lightweight-charts';
import { Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Candlestick } from '../domain/candlestick';
import type { ReviewTimeframe } from '../domain/trade';
import { isSameVisibleRange, shouldLoadEarlier, shouldLoadLater, type VisibleTimeRange } from './chart-autoload';
import { formatChartPrice } from './chart-price';
import { entryVisibleRange, formatChartTime, markerTimeForEvent, timeframeMs } from './chart-time';

const DEFAULT_INSTRUMENT = 'BTC-USDT-SWAP';

type InstrumentResponse = {
  instruments: string[];
};

type LoadDirection = 'earlier' | 'later';

export function OtherCoinChart({ entryTime, timeframe, onClose }: {
  entryTime: string;
  timeframe: ReviewTimeframe;
  onClose: () => void;
}) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartWrapRef = useRef<HTMLDivElement>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const loadedCandlesRef = useRef<Candlestick[]>([]);
  const loadingRef = useRef<{ earlier: boolean; later: boolean }>({ earlier: false, later: false });
  const lastLoadRangeRef = useRef<{ earlier: VisibleTimeRange | null; later: VisibleTimeRange | null }>({ earlier: null, later: null });
  const suppressAutoLoadRef = useRef(false);
  const activeKeyRef = useRef('');
  const [instruments, setInstruments] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [instrument, setInstrument] = useState(DEFAULT_INSTRUMENT);
  const [status, setStatus] = useState('加载 K 线');
  const [showCandidates, setShowCandidates] = useState(false);
  // Entry-candle reference line position in CSS px; null = not loaded / off-scale.
  const [entryX, setEntryX] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/free-replay/instruments')
      .then((response) => response.json())
      .then((data: InstrumentResponse) => setInstruments(Array.isArray(data.instruments) ? data.instruments : []))
      .catch(() => setInstruments([]));
  }, []);

  const filteredInstruments = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return [];
    return instruments
      .filter((item) => item.toLowerCase().includes(keyword))
      .slice(0, 20);
  }, [instruments, query]);

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = createChart(chartRef.current, {
      layout: { background: { type: ColorType.Solid, color: '#101318' }, textColor: '#C9D1D9' },
      grid: { vertLines: { color: '#222832' }, horzLines: { color: '#222832' } },
      rightPriceScale: { borderColor: '#2D333B' },
      crosshair: { mode: CrosshairMode.Normal },
      localization: {
        locale: 'zh-CN',
        priceFormatter: formatChartPrice,
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
    return () => {
      chartApiRef.current = null;
      seriesRef.current = null;
      chart.remove();
    };
  }, [timeframe]);

  useEffect(() => {
    const key = `${instrument}:${timeframe}:${entryTime}`;
    activeKeyRef.current = key;
    loadedCandlesRef.current = [];
    loadingRef.current = { earlier: false, later: false };
    lastLoadRangeRef.current = { earlier: null, later: null };
    suppressAutoLoadRef.current = true;
    setStatus('加载 K 线');
    setEntryX(null);
    let cancelled = false;
    const params = new URLSearchParams({ instrument, timeframe, entryTime, mode: 'initial' });
    fetch(`/api/candles?${params}`)
      .then((response) => response.json())
      .then((data: { candles: Candlestick[] }) => {
        if (cancelled || activeKeyRef.current !== key) return;
        const merged = mergeCandles(data.candles);
        loadedCandlesRef.current = merged;
        setStatus(merged.length ? '' : '没有拿到 K 线');
        const series = seriesRef.current;
        const chart = chartApiRef.current;
        if (!series || !chart) return;
        renderCandles(series, merged);
        const range = entryVisibleRange(entryTime, timeframe);
        lastLoadRangeRef.current = { earlier: range, later: range };
        chart.timeScale().setVisibleRange({ from: range.from, to: range.to });
        window.requestAnimationFrame(() => {
          if (activeKeyRef.current !== key) return;
          recomputeEntryX();
        });
        window.setTimeout(() => {
          suppressAutoLoadRef.current = false;
        }, 0);
      })
      .catch(() => {
        if (!cancelled) setStatus('K 线加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, [instrument, entryTime, timeframe]);

  useEffect(() => {
    const chart = chartApiRef.current;
    if (!chart) return;
    const handler = (range: LogicalRange | null) => {
      // Re-align the entry marker before the auto-load early return: programmatic
      // range changes (instrument/timeframe switch, load-more) also move it.
      recomputeEntryX();
      if (suppressAutoLoadRef.current) return;
      const series = seriesRef.current;
      const visible = currentVisibleRange(chart);
      const candles = loadedCandlesRef.current;
      if (!series || !range || !visible || candles.length < 2) return;
      const step = timeframeMs(timeframe) / 1000;
      const span = visible.to - visible.from;
      const threshold = Math.max(span * 0.35, step * 20);
      const first = candles[0].timestamp / 1000;
      const last = candles[candles.length - 1].timestamp / 1000;
      const loadedRange = { first, last };
      if (shouldLoadEarlier(visible, loadedRange, threshold) && !isSameVisibleRange(lastLoadRangeRef.current.earlier, visible)) {
        lastLoadRangeRef.current.earlier = visible;
        void loadMore('earlier');
      }
      if (shouldLoadLater(visible, loadedRange, threshold) && !isSameVisibleRange(lastLoadRangeRef.current.later, visible)) {
        lastLoadRangeRef.current.later = visible;
        void loadMore('later');
      }
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(handler);
    return () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
  }, [timeframe, instrument, entryTime]);

  // `autoSize` only re-lays-out the canvas; it fires no logical-range event, so a
  // panel resize needs its own trigger to keep the marker aligned.
  useEffect(() => {
    const wrap = chartWrapRef.current;
    if (!wrap || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => recomputeEntryX());
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [timeframe, instrument, entryTime]);

  function recomputeEntryX() {
    const chart = chartApiRef.current;
    if (!chart) return;
    const time = markerTimeForEvent(entryTime, timeframe, loadedCandlesRef.current);
    const coordinate = chart.timeScale().timeToCoordinate(time);
    setEntryX(coordinate == null ? null : coordinate);
  }

  async function loadMore(direction: LoadDirection) {
    const key = `${instrument}:${timeframe}:${entryTime}`;
    if (activeKeyRef.current !== key || loadingRef.current[direction] || !loadedCandlesRef.current.length) return;
    loadingRef.current[direction] = true;
    setStatus(direction === 'earlier' ? '加载更早 K 线' : '加载更晚 K 线');
    const candles = loadedCandlesRef.current;
    const anchor = direction === 'earlier' ? candles[0].timestamp : candles[candles.length - 1].timestamp;
    const params = new URLSearchParams({ instrument, timeframe, entryTime, mode: direction, anchor: String(anchor) });
    try {
      const { candles: next } = (await fetch(`/api/candles?${params}`).then((response) => response.json())) as { candles: Candlestick[] };
      if (activeKeyRef.current !== key) return;
      if (!next.length) {
        setStatus('');
        return;
      }
      const chart = chartApiRef.current;
      const series = seriesRef.current;
      const visible = chart ? currentVisibleRange(chart) : null;
      loadedCandlesRef.current = mergeCandles([...loadedCandlesRef.current, ...next]);
      if (!series || !chart) return;
      suppressAutoLoadRef.current = true;
      renderCandles(series, loadedCandlesRef.current);
      if (visible) {
        chart.timeScale().setVisibleRange({ from: visible.from as UTCTimestamp, to: visible.to as UTCTimestamp });
      }
      window.requestAnimationFrame(() => {
        if (activeKeyRef.current !== key) return;
        recomputeEntryX();
      });
      window.setTimeout(() => {
        suppressAutoLoadRef.current = false;
      }, 0);
      setStatus('');
    } catch {
      setStatus('K 线加载失败');
    } finally {
      loadingRef.current[direction] = false;
    }
  }

  function chooseInstrument(next: string) {
    setInstrument(next);
    setQuery('');
    setShowCandidates(false);
  }

  return (
    <div className="other-coin-panel" aria-label="其他币 K 线">
      <div className="other-coin-header">
        <div className="other-coin-search">
          <Search size={14} />
          <input
            value={query}
            placeholder="搜索其他币，如 ETH"
            onChange={(event) => {
              setQuery(event.target.value);
              setShowCandidates(true);
            }}
            onFocus={() => setShowCandidates(true)}
            onBlur={() => window.setTimeout(() => setShowCandidates(false), 150)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && filteredInstruments[0]) {
                chooseInstrument(filteredInstruments[0]);
              }
            }}
          />
          {showCandidates && filteredInstruments.length > 0 && (
            <div className="other-coin-candidates">
              {filteredInstruments.map((item) => (
                <button key={item} type="button" onMouseDown={(event) => { event.preventDefault(); chooseInstrument(item); }}>
                  {item}
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" className="other-coin-close" aria-label="关闭其他币 K 线" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="other-coin-title">{instrument}</div>
      <div ref={chartWrapRef} className="other-coin-chart-wrap">
        <div ref={chartRef} className="other-coin-chart" />
        <svg className="other-coin-marker-overlay" aria-hidden="true">
          {entryX != null && <line x1={entryX} x2={entryX} y1={0} y2="100%" />}
        </svg>
      </div>
      {status && <div className="other-coin-status">{status}</div>}
    </div>
  );
}

function renderCandles(series: ISeriesApi<'Candlestick'>, candles: Candlestick[]) {
  series.setData(candles.map((candle) => ({
    time: Math.floor(candle.timestamp / 1000) as UTCTimestamp,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  })));
}

function currentVisibleRange(chart: IChartApi): VisibleTimeRange | null {
  const visible = chart.timeScale().getVisibleRange();
  if (!visible) return null;
  const from = Number(visible.from);
  const to = Number(visible.to);
  return Number.isFinite(from) && Number.isFinite(to) && to > from ? { from, to } : null;
}

function mergeCandles(candles: Candlestick[]): Candlestick[] {
  return [...new Map(candles.map((candle) => [candle.timestamp, candle])).values()].sort((a, b) => a.timestamp - b.timestamp);
}
