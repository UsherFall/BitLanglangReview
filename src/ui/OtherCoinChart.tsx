import { CandlestickSeries, ColorType, createChart, CrosshairMode, type IChartApi, type ISeriesApi, type LogicalRange, type Time, type UTCTimestamp } from 'lightweight-charts';
import { Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Candlestick, CandleSourceId } from '../domain/candlestick';
import type { ReviewTimeframe } from '../domain/trade';
import { fetchCandles, ServerCandleError } from './candle-fetch';
import { isSameVisibleRange, shouldLoadEarlier, shouldLoadLater, type VisibleTimeRange } from './chart-autoload';
import { formatChartPrice } from './chart-price';
import { entryVisibleRange, formatChartTime, markerTimeForEvent, timeframeMs, type CandleGrid } from './chart-time';
import { FREE_REPLAY_CANDLE_GRID, FREE_REPLAY_CANDLE_SOURCE, shouldPrefetchFutureCandles, visibleCandlesForFreeReplay } from './free-replay-chart';

// Opening instrument, per source: the panel must start on a symbol its own
// source can resolve, or the first render asks for a contract that venue does
// not carry (OKX names in trade review, Binance symbols in Free Replay).
const DEFAULT_INSTRUMENT_BY_SOURCE: Record<string, string> = { okx: 'BTC-USDT-SWAP', binance: 'BTCUSDT' };

type InstrumentResponse = {
  instruments: string[];
};

type LoadDirection = 'earlier' | 'later';

export function OtherCoinChart({ entryTime, timeframe, cursorTime, candleSource = 'okx', onClose }: {
  entryTime: string;
  timeframe: ReviewTimeframe;
  /**
   * Free Replay cursor (seconds). When given, the panel runs in replay mode: it
   * renders nothing past the cursor and keeps later candlesticks loaded but
   * hidden, so the reviewer cannot see the future through this panel. The main
   * replay chart owns the cursor; this panel only follows it.
   */
  cursorTime?: number;
  /**
   * Which venue to read this panel's candlesticks from. It must match the
   * chart this panel sits beside: the venues do not share prices (QNT trades
   * near 263 on Binance and near 46 on OKX) and they cut the day differently, so
   * a mismatched panel would contradict the main chart it is meant to compare
   * against. Defaults to OKX, the trade-review source.
   */
  candleSource?: CandleSourceId;
  onClose: () => void;
}) {
  const isReplay = cursorTime != null;
  // Replay is bound to Binance on its own (no OKX fallback). Elsewhere the panel
  // follows the chart it sits beside. Venue and grid travel together: a request
  // to one venue floored on the other's grid lands between candlesticks.
  const venue: CandleSourceId = isReplay ? 'binance' : candleSource;
  const grid: CandleGrid = venue === 'binance' ? FREE_REPLAY_CANDLE_GRID : 'shanghai';
  // The panel picks from a venue-specific instrument list, so it always knows
  // the native symbol already and never needs the candidate chain — that chain
  // exists to translate a *trade's* OKX-style name, and it returns an empty
  // window for a Binance symbol.
  const requestSource = venue === 'binance' ? FREE_REPLAY_CANDLE_SOURCE : venue;
  const chartRef = useRef<HTMLDivElement>(null);
  const chartWrapRef = useRef<HTMLDivElement>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const loadedCandlesRef = useRef<Candlestick[]>([]);
  const loadingRef = useRef<{ earlier: boolean; later: boolean }>({ earlier: false, later: false });
  const lastLoadRangeRef = useRef<{ earlier: VisibleTimeRange | null; later: VisibleTimeRange | null }>({ earlier: null, later: null });
  const suppressAutoLoadRef = useRef(false);
  const activeKeyRef = useRef('');
  // In replay mode `entryTime` moves with the cursor on every reveal. Reading it
  // through a ref keeps it out of the initial-load effect dependencies, so
  // advancing the cursor re-anchors the marker and the prefetch without
  // re-downloading the whole +/-150 window each step.
  const entryTimeRef = useRef(entryTime);
  entryTimeRef.current = entryTime;
  const cursorTimeRef = useRef(cursorTime);
  cursorTimeRef.current = cursorTime;
  // Replay mode: tracks the newest already-prefetched position so a failed
  // prefetch can retry (a sticky guard would freeze the panel at the cursor).
  const lastPrefetchAnchorRef = useRef<number | null>(null);
  const [instruments, setInstruments] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [instrument, setInstrument] = useState(DEFAULT_INSTRUMENT_BY_SOURCE[venue]);
  // A venue switch invalidates the shown instrument: the previous one's symbol
  // belongs to the other exchange's vocabulary.
  const previousVenueRef = useRef(venue);
  useEffect(() => {
    if (previousVenueRef.current === venue) return;
    previousVenueRef.current = venue;
    setInstrument(DEFAULT_INSTRUMENT_BY_SOURCE[venue]);
  }, [venue]);
  const [loadedCandles, setLoadedCandles] = useState<Candlestick[]>([]);
  const [status, setStatus] = useState('加载 K 线');
  const [showCandidates, setShowCandidates] = useState(false);
  // Entry-candle reference line position in CSS px; null = not loaded / off-scale.
  const [entryX, setEntryX] = useState<number | null>(null);

  useEffect(() => {
    // The list must be named in the venue's own vocabulary, and it must be the
    // venue whose candles this panel reads — a Binance symbol offered to the
    // OKX-backed panel (or to the candidate chain) loads nothing at all.
    fetch(`/api/free-replay/instruments?source=${venue}`)
      .then((response) => response.json())
      .then((data: InstrumentResponse) => setInstruments(Array.isArray(data.instruments) ? data.instruments : []))
      .catch(() => setInstruments([]));
  }, [venue]);

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

  // Trade review: the anchor is the trade's entry, so a new trade re-loads the
  // window. Replay: the anchor is the cursor, which moves on every reveal —
  // folding it into the key would re-download the whole window each step, so
  // the key covers only the instrument and the timeframe, and the moving anchor
  // is read through `entryTimeRef` at load time. The venue belongs in the key
  // because it decides which exchange the cached bars came from.
  const anchorKey = `${venue}:${isReplay ? `${instrument}:${timeframe}` : `${instrument}:${timeframe}:${entryTime}`}`;

  useEffect(() => {
    const key = anchorKey;
    const anchor = entryTimeRef.current;
    activeKeyRef.current = key;
    loadedCandlesRef.current = [];
    loadingRef.current = { earlier: false, later: false };
    lastLoadRangeRef.current = { earlier: null, later: null };
    lastPrefetchAnchorRef.current = null;
    suppressAutoLoadRef.current = true;
    setStatus('加载 K 线');
    setEntryX(null);
    setLoadedCandles([]);
    let cancelled = false;
    const params = new URLSearchParams({ instrument, timeframe, entryTime: anchor, mode: 'initial', source: requestSource });
    fetchCandles(params)
      .then((candles) => {
        if (cancelled || activeKeyRef.current !== key) return;
        const merged = mergeCandles(candles);
        loadedCandlesRef.current = merged;
        setLoadedCandles(merged);
        setStatus(merged.length ? '' : '没有拿到 K 线');
        const series = seriesRef.current;
        const chart = chartApiRef.current;
        if (!series || !chart) return;
        renderCandles(series, trimmedCandles(merged, cursorTimeRef.current));
        const range = entryVisibleRange(anchor, timeframe, grid);
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
      .catch((error) => {
        if (!cancelled) setStatus(error instanceof ServerCandleError ? error.message : 'K 线加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, [anchorKey, instrument, timeframe]);

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
      // Replay mode never loads on a right-drag: the region right of the cursor
      // is not-yet-revealed, so scrolling into it must stay blank rather than
      // pull the future in. Later candlesticks arrive via the cursor prefetch
      // below instead.
      if (isReplay) return;
      if (shouldLoadLater(visible, loadedRange, threshold) && !isSameVisibleRange(lastLoadRangeRef.current.later, visible)) {
        lastLoadRangeRef.current.later = visible;
        void loadMore('later');
      }
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(handler);
    return () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
  }, [timeframe, instrument, anchorKey, isReplay]);

  // Replay mode: keep later candlesticks loaded but hidden, refetching as the
  // cursor approaches the loaded edge. Mirrors the main replay chart — the
  // merged set must reach React state too, or the "already fetched" guard pins
  // the edge and the panel runs dry a window after the cursor passes it.
  useEffect(() => {
    if (!isReplay || cursorTime == null || !loadedCandles.length) return;
    const last = loadedCandles[loadedCandles.length - 1];
    if (!last || loadingRef.current.later || lastPrefetchAnchorRef.current === last.timestamp) return;
    if (!shouldPrefetchFutureCandles(loadedCandles, cursorTime, 20)) return;
    const key = activeKeyRef.current;
    loadingRef.current.later = true;
    lastPrefetchAnchorRef.current = last.timestamp;
    const params = new URLSearchParams({
      instrument,
      timeframe,
      entryTime: entryTimeRef.current,
      mode: 'later',
      anchor: String(last.timestamp),
      source: requestSource,
    });
    // A prefetch is background work, not a user-triggered load: it must not
    // claim the status line, which belongs to visible navigation.
    fetchCandles(params)
      .then((candles) => {
        if (activeKeyRef.current !== key || !candles.length) return;
        const merged = mergeCandles([...loadedCandlesRef.current, ...candles]);
        loadedCandlesRef.current = merged;
        setLoadedCandles(merged);
      })
      .catch((error) => {
        // Clear the anchor so the next cursor step retries this position.
        lastPrefetchAnchorRef.current = null;
        setStatus(error instanceof ServerCandleError ? error.message : 'K 线加载失败');
      })
      .finally(() => {
        loadingRef.current.later = false;
      });
  }, [isReplay, cursorTime, loadedCandles, instrument, timeframe]);

  // Replay mode: re-render as the cursor moves. Reveal adds a candlestick where
  // it stands, rewind takes it away; the viewport is left alone either way.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !isReplay) return;
    renderCandles(series, trimmedCandles(loadedCandlesRef.current, cursorTime));
  }, [isReplay, cursorTime, loadedCandles]);

  // `autoSize` only re-lays-out the canvas; it fires no logical-range event, so a
  // panel resize needs its own trigger to keep the marker aligned.
  useEffect(() => {
    const wrap = chartWrapRef.current;
    if (!wrap || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => recomputeEntryX());
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [timeframe, instrument, anchorKey, cursorTime]);

  function recomputeEntryX() {
    const chart = chartApiRef.current;
    if (!chart) return;
    const time = markerTimeForEvent(entryTimeRef.current, timeframe, loadedCandlesRef.current, grid);
    const coordinate = chart.timeScale().timeToCoordinate(time);
    setEntryX(coordinate == null ? null : coordinate);
  }

  async function loadMore(direction: LoadDirection) {
    const key = activeKeyRef.current;
    if (activeKeyRef.current !== key || loadingRef.current[direction] || !loadedCandlesRef.current.length) return;
    loadingRef.current[direction] = true;
    setStatus(direction === 'earlier' ? '加载更早 K 线' : '加载更晚 K 线');
    const candles = loadedCandlesRef.current;
    const anchor = direction === 'earlier' ? candles[0].timestamp : candles[candles.length - 1].timestamp;
    const params = new URLSearchParams({ instrument, timeframe, entryTime: entryTimeRef.current, mode: direction, anchor: String(anchor), source: requestSource });
    try {
      const next = await fetchCandles(params);
      if (activeKeyRef.current !== key) return;
      if (!next.length) {
        setStatus('');
        return;
      }
      const chart = chartApiRef.current;
      const series = seriesRef.current;
      const visible = chart ? currentVisibleRange(chart) : null;
      loadedCandlesRef.current = mergeCandles([...loadedCandlesRef.current, ...next]);
      setLoadedCandles(loadedCandlesRef.current);
      if (!series || !chart) return;
      suppressAutoLoadRef.current = true;
      renderCandles(series, trimmedCandles(loadedCandlesRef.current, cursorTimeRef.current));
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
    } catch (error) {
      setStatus(error instanceof ServerCandleError ? error.message : 'K 线加载失败');
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

/**
 * Replay mode shows nothing past the cursor; trade review has no cursor and
 * shows everything it loaded. In replay the parent passes the cursor as
 * `entryTime`, so `entryVisibleRange` already centers the opening viewport on
 * the revealed history.
 */
function trimmedCandles(candles: Candlestick[], cursorTime: number | undefined): Candlestick[] {
  return cursorTime == null ? candles : visibleCandlesForFreeReplay(candles, cursorTime);
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
