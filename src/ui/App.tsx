import { CandlestickSeries, ColorType, createChart, createSeriesMarkers, CrosshairMode, PriceScaleMode, type IChartApi, type ISeriesApi, type ISeriesMarkersPluginApi, type LogicalRange, type MouseEventParams, type SeriesMarker, type Time, type UTCTimestamp } from 'lightweight-charts';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CircleDollarSign, Eraser, Eye, EyeOff, Magnet, MapPin, Minus, MoveUpRight, RefreshCcw, Scale, Search, Star } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Candlestick, CandleSourceId } from '../domain/candlestick';
import type { ScanResponse } from '../domain/coin-scan';
import { DEFAULT_MARKET_DATA_SOURCE, type MarketDataSource, type ScanScope } from '../domain/scan-scope';
import type { ChartDrawing, ChartPoint } from '../domain/drawing';
import type { TradeReview } from '../domain/review';
import type { ReviewedTrade, ReviewQueueOptions, SortField } from '../domain/review-queue';
import { reviewTimeframes, type ReviewTimeframe } from '../domain/trade';
import { isSameVisibleRange, shouldLoadLater, type VisibleTimeRange } from './chart-autoload';
import { visibleRangeForAnchor, type NavigationAnchor, type NumericVisibleRange } from './chart-navigation-anchor';
import { formatChartPrice } from './chart-price';
import { applyChartPriceScaleMode, resetChartPriceScale, type ChartPriceScaleMode } from './chart-scale';
import { entryVisibleRange, formatChartTime, freeReplayCursorTimeForProgress, freeReplayCursorTimeForStart, freeReplayCursorTimeForTimeframeSwitch, timeframeMs, timeframeTimeForPoint } from './chart-time';
import { cursorAnchoredLogicalRange, cursorAnchoredTimeRange, visibleBarCountForLogicalRange, visibleBarCountForWidth } from './chart-time-scale';
import { fetchCandles, ServerCandleError } from './candle-fetch';
import { candlestickAtTime, formatCandlestickPrice, formatHoverPricePercentage, hoverPricePercentage } from './candlestick-readout';
import { CoinScanPanel, CoinScanResults, type ScanResult } from './CoinScanPanel';
import { nextMagnetMode, type MagnetMode } from './drawing-snap';
import { useChartDrawings } from './chart-drawing';
import { HeatScanResults } from './HeatScanResults';
import { BoxScanResults } from './BoxScanResults';
import { BitgetControlBar } from './BitgetControlBar';
import { FreeReplayPanel, type FreeReplaySession, type FreeReplaySessionPayload, type FreeReplayStart } from './FreeReplayPanel';
import { LeaderCoinPanel } from './LeaderCoinPanel';
import { MarketHeatPanel } from './MarketHeatPanel';
import { OtherCoinChart } from './OtherCoinChart';
import { nextFreeReplayProgress, previousFreeReplayProgress, shouldBackfillFreeReplayHistory, shouldPrefetchFutureCandles, visibleCandlesForFreeReplay, replayCandleGrid, replayCandleSource, LEGACY_REPLAY_CANDLE_SOURCE } from './free-replay-chart';
import {
  availableMargin,
  cancelPendingOrder,
  cancelStopLoss,
  closeMarket,
  currentCursorCandle,
  initialPaperTradingSession,
  normalizePaperTradingSession,
  openMarket,
  paperTradeMarkers,
  paperTradingStats,
  placeEntryLimit,
  placeExitLimit,
  placeStopLoss,
  processRevealedCandle,
  startPaperTrading,
  type PaperDirection,
  type PaperLeg,
  type PaperOrder,
  type PaperStats,
  type PaperTrade,
  type PaperTradingSettings,
  type PaperTradingSession,
} from './free-replay-paper-trading';
import { ReviewEditor, type ReviewModule, type SavedReviewPayload } from './ReviewEditor';
import { firstUnreviewedTrade, reviewProgress } from './review-progress';
import { TradeMarkerPrimitive } from './trade-marker-primitive';
import { allTradeChartPoints, tradeChartPoints, type MarkerPoint } from './trade-markers';
import { createTradeMarkerTooltip, type TradeMarkerTooltip, type TooltipData } from './trade-marker-tooltip';

type TradeResponse = {
  trades: ReviewedTrade[];
  instruments: string[];
  tags: string[];
  /** How many trades carry each tag. Drives the "N 笔" hint in the tag dropdown. */
  tagCounts: Record<string, number>;
  /** Present on the Bitget source; false until keys are configured. */
  configured?: boolean;
};



/** Response of `POST /api/tags/rename` and `POST /api/tags/delete` (module-scoped). */
type TagMutationResponse = {
  affected: number;
  tags: string[];
  tagCounts: Record<string, number>;
};

/** A global tag edit: rename when `to` is a name, delete when `to` is null. */
type TagMutation = { from: string; to: string | null };

/** Applies a global tag edit to one trade's review. Dedupes for the merge case. */
function rewriteTradeTags(trade: ReviewedTrade, from: string, to: string | null): ReviewedTrade {
  if (!trade.review) return trade;
  const tags = to === null
    ? trade.review.tags.filter((tag) => tag !== from)
    : trade.review.tags.map((tag) => (tag === from ? to : tag));
  return { ...trade, review: { ...trade.review, tags: [...new Set(tags)] } };
}

const sortLabels: Record<SortField, string> = {
  entryTime: '时间',
  returnRate: '收益率',
  profit: '收益',
  holdingMinutes: '持仓',
};

type DrawingDragTarget = 'body' | 'start' | 'end';
type ReviewMode = 'trade' | 'bitget' | 'freeReplay' | 'scan';

/**
 * Per-review-mode data-source binding: which queue endpoint and which exchange's
 * candlesticks a mode reviews against. The two review modes share the queue
 * workspace; registering a new mode/source here is the only wiring needed
 * (trades + candles), the chart components stay source-agnostic.
 */
type ReviewModeBinding = { endpoint: string; candleSource: CandleSourceId };
const reviewModeBindings: Partial<Record<ReviewMode, ReviewModeBinding>> = {
  trade: { endpoint: '/api/trades', candleSource: 'okx' },
  // 10/21: the Bitget positions are charted against BITGET's candles. The
  // position's entry price comes from Bitget, so the candles must too — a
  // Binance chart of a Bitget position puts the entry price on a different
  // price scale (PEPE: Bitget 0.000005 vs Binance's 1000PEPE 0.0045).
  bitget: { endpoint: '/api/bitget/trades', candleSource: 'bitget' },
};

/** Both review modes share the same queue/detail workspace, only the data source differs. */
function isTradeReviewMode(mode: ReviewMode): boolean {
  return Boolean(reviewModeBindings[mode]);
}

function reviewModeNavLabel(mode: ReviewMode): string {
  return mode === 'trade' ? '交' : mode === 'bitget' ? '个' : '回';
}

function reviewModeTitle(mode: ReviewMode): string {
  return mode === 'trade' ? '交割单复盘' : mode === 'bitget' ? '个人交割单复盘' : mode === 'scan' ? '选品' : '回溯复盘';
}

function tradeReviewEndpoint(mode: ReviewMode): string {
  return reviewModeBindings[mode]?.endpoint ?? '/api/trades';
}

function reviewCandleSource(mode: ReviewMode): CandleSourceId {
  return reviewModeBindings[mode]?.candleSource ?? 'okx';
}

const SIDEBAR_CONFIG_KEY = 'sidebar-config';
const LEADER_COINS_KEY = 'leader-coins';
// 手动降权的选品标的(人工判断日线结构不适合做多),独立于龙头币标记。
const SCAN_DEMOTED_KEY = 'scan-demoted';
const DEFAULT_SIDEBAR_WIDTH = 390;
const MIN_SIDEBAR_WIDTH = 280;
const COLLAPSED_SIDEBAR_WIDTH = 40;
const NARROW_LAYOUT_QUERY = '(max-width: 920px)';

type SidebarConfig = {
  width: number;
  collapsed: boolean;
  filterCollapsed: boolean;
};

type SidebarDrag = {
  pointerId: number;
  startX: number;
  startWidth: number;
  moved: boolean;
};

function clampSidebarWidth(width: number): number {
  const maxWidth = typeof window === 'undefined' ? DEFAULT_SIDEBAR_WIDTH : Math.floor(window.innerWidth * 0.7);
  return Math.min(Math.max(width, MIN_SIDEBAR_WIDTH), Math.max(MIN_SIDEBAR_WIDTH, maxWidth));
}

function loadSidebarConfig(): SidebarConfig {
  const fallback = { width: DEFAULT_SIDEBAR_WIDTH, collapsed: false, filterCollapsed: false };
  if (typeof window === 'undefined') return fallback;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SIDEBAR_CONFIG_KEY) ?? 'null') as Partial<SidebarConfig> | null;
    return {
      width: clampSidebarWidth(typeof parsed?.width === 'number' ? parsed.width : fallback.width),
      collapsed: typeof parsed?.collapsed === 'boolean' ? parsed.collapsed : fallback.collapsed,
      filterCollapsed: typeof parsed?.filterCollapsed === 'boolean' ? parsed.filterCollapsed : fallback.filterCollapsed,
    };
  } catch {
    return fallback;
  }
}

/** Reads a localStorage key holding a JSON string array, tolerating absent/corrupt values. */
function loadStoredStringList(key: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function isNarrowLayout(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(NARROW_LAYOUT_QUERY).matches;
}

function upsertSession(sessions: FreeReplaySession[], saved: FreeReplaySession): FreeReplaySession[] {
  return [...sessions.filter((session) => !(session.instrument === saved.instrument && session.startTime === saved.startTime)), saved]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function sessionKey(instrument: string, startTime: string): string {
  return `${instrument}:${startTime}`;
}

export function App() {
  const [filters, setFilters] = useState<ReviewQueueOptions>({ sortField: 'entryTime', sortDirection: 'asc' });
  const [data, setData] = useState<TradeResponse>({ trades: [], instruments: [], tags: [], tagCounts: {} });
  const [selectedId, setSelectedId] = useState<string>('');
  const selectedTradeRowRef = useRef<HTMLDivElement | null>(null);
  const sidebarDragRef = useRef<SidebarDrag | null>(null);
  const [timeframe, setTimeframe] = useState<ReviewTimeframe>('5m');
  const [otherCoinOpen, setOtherCoinOpen] = useState(false);
  const [leaderCoinOpen, setLeaderCoinOpen] = useState(false);
  const [heatOpen, setHeatOpen] = useState(false);
  const [leaderCoins, setLeaderCoins] = useState<string[]>(() => loadStoredStringList(LEADER_COINS_KEY));
  const [demotedCoins, setDemotedCoins] = useState<string[]>(() => loadStoredStringList(SCAN_DEMOTED_KEY));
  const [reviewMode, setReviewMode] = useState<ReviewMode>('trade');
  /**
   * The instrument the 选品 list asked to draw on ("去画线"). The scan list has
   * no chart of its own — the levels are drawn in the review chart's 其他币
   * panel — so this is how the request crosses from the scan module into the
   * chart module. `null` = no pending request.
   */
  const [drawTarget, setDrawTarget] = useState<string | null>(null);
  /** The timeframe the level drawer draws on (the user's levels are per-level). */
  const [drawTimeframe, setDrawTimeframe] = useState<ReviewTimeframe>('1D');

  /**
   * Open the level drawer for one instrument. The 选品 list has no chart, so
   * this switches the draw panel to the instrument the user picked.
   */
  function openLevelDrawer(instrument: string) {
    setDrawTimeframe('1D');
    setDrawTarget(instrument);
  }
  const [sidebarConfig, setSidebarConfig] = useState<SidebarConfig>(() => loadSidebarConfig());
  const [freeReplay, setFreeReplay] = useState<FreeReplayStart | null>(null);
  const [freeReplayCandles, setFreeReplayCandles] = useState<Candlestick[]>([]);
  const [paperTrading, setPaperTrading] = useState<PaperTradingSession>(() => initialPaperTradingSession());
  // 10/29: 焦点单（点已完成交易行锚定开仓点）。token 递增使重复点同一行重新归位；
  // 步进/开平仓/点持仓行清除（详见 design.md 的解除条款）。临时状态，不进会话存盘。
  const [orderFocus, setOrderFocus] = useState<{ id: string; timeMs: number; token: number } | null>(null);
  // 10/30: 回到光标令牌 —— 开平仓提交/点持仓行时递增，图表据此把视口跳回光标
  // （步进不走这里，10/28 舒适区契约不变）。
  const [cursorReturnToken, setCursorReturnToken] = useState(0);
  const [freeReplaySessions, setFreeReplaySessions] = useState<FreeReplaySession[]>([]);
  // Bumped when a reveal has no further candlestick to show, so the chart
  // retries the future fetch instead of ignoring the click silently.
  const [futureRetryToken, setFutureRetryToken] = useState(0);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  // 选品 sub-module (加密 / 股票). Held here so the parameter panel and the result
  // panel always describe the same scan; switching clears the stale result.
  const [scanScope, setScanScope] = useState<ScanScope>('crypto');
  /**
   * The venue the 选品 scan runs against (10/21). The level drawer draws
   * on a chart, and that chart must come from the SAME venue: the line's
   * price and the scan's candles then share one price basis.
   */
  const [scanSource, setScanSource] = useState<MarketDataSource>(DEFAULT_MARKET_DATA_SOURCE);
  // Bumped by the Bitget sync bar so the trade queue refetches after a sync.
  const [tradeRefreshToken, setTradeRefreshToken] = useState(0);
  const pendingSaveRef = useRef<FreeReplaySessionPayload | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  // Keys of sessions deleted since the last matching save. Guards against an
  // already in-flight auto-save PUT response resurrecting a deleted row in the
  // local list (stale freeReplaySessions).
  const deletedSessionKeysRef = useRef<Set<string>>(new Set());

  function addLeaderCoin(instrument: string) {
    const next = instrument.trim();
    if (!next) return;
    setLeaderCoins((current) => current.includes(next) ? current : [...current, next]);
  }

  function removeLeaderCoin(instrument: string) {
    setLeaderCoins((current) => current.filter((item) => item !== instrument));
  }

  function toggleLeaderCoin(instrument: string) {
    setLeaderCoins((current) => current.includes(instrument) ? current.filter((item) => item !== instrument) : [...current, instrument]);
  }

  function toggleDemotedCoin(instrument: string) {
    setDemotedCoins((current) => current.includes(instrument) ? current.filter((item) => item !== instrument) : [...current, instrument]);
  }

  // Tag list and per-tag counts are module-scoped (xlsx universe vs `bg-`),
  // so every save/tag route names the module it is acting on.
  const reviewModule: ReviewModule = reviewMode === 'bitget' ? 'bitget' : 'trade';
  const selectedTrade = data.trades.find((trade) => trade.id === selectedId) ?? data.trades[0] ?? null;
  const progress = reviewProgress(data.trades, selectedTrade?.id ?? '');
  const nextUnreviewedTrade = firstUnreviewedTrade(data.trades);
  const sidebarGridWidth = sidebarConfig.collapsed ? `${COLLAPSED_SIDEBAR_WIDTH}px` : `${sidebarConfig.width}px`;
  const shellStyle = { '--sidebar-grid-width': sidebarGridWidth } as CSSProperties;

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_CONFIG_KEY, JSON.stringify(sidebarConfig));
  }, [sidebarConfig]);

  useEffect(() => {
    window.localStorage.setItem(LEADER_COINS_KEY, JSON.stringify(leaderCoins));
  }, [leaderCoins]);

  useEffect(() => {
    window.localStorage.setItem(SCAN_DEMOTED_KEY, JSON.stringify(demotedCoins));
  }, [demotedCoins]);

  // 市场热度 per-trade computation costs a whole-pool candle fetch (~80 req)
  // for each NEW anchor, so it must not auto-follow queue navigation while open:
  // close it when the selected trade changes so a reading is only computed when
  // the reviewer clicks 热度 for the current trade.
  useEffect(() => {
    setHeatOpen(false);
  }, [selectedId]);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(NARROW_LAYOUT_QUERY);
    const expandOnNarrow = () => {
      if (query.matches) setSidebarConfig((current) => ({ ...current, collapsed: false }));
    };
    expandOnNarrow();
    query.addEventListener('change', expandOnNarrow);
    return () => query.removeEventListener('change', expandOnNarrow);
  }, []);

  useEffect(() => {
    if (!isTradeReviewMode(reviewMode)) return;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }
    fetch(`${tradeReviewEndpoint(reviewMode)}?${params}`)
      .then((response) => response.json())
      .then((next: TradeResponse) => {
        setData(next);
        setSelectedId((current) => (next.trades.some((trade) => trade.id === current) ? current : next.trades[0]?.id ?? ''));
      });
  }, [filters, reviewMode, tradeRefreshToken]);

  useEffect(() => {
    fetch('/api/free-replay/sessions')
      .then((response) => response.json())
      .then(({ sessions }: { sessions?: FreeReplaySession[] }) => setFreeReplaySessions(sessions ?? []));
  }, []);

  // Trailing-debounced auto-save: any reveal, rewind, timeframe switch, or
  // paper trading change persists the active Free Replay session.
  useEffect(() => {
    if (reviewMode !== 'freeReplay' || !freeReplay) {
      // Leaving Free Replay (or stopping it) flushes any still-pending save so
      // a quick mode switch does not drop the latest action.
      const pending = pendingSaveRef.current;
      if (pending) {
        pendingSaveRef.current = null;
        if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        void persistFreeReplaySession(pending);
      }
      return;
    }
    const payload: FreeReplaySessionPayload = {
      instrument: freeReplay.instrument,
      startTime: freeReplay.startTime,
      dataAnchorTime: freeReplay.dataAnchorTime,
      startCursorTime: freeReplay.startCursorTime,
      startProgressTime: freeReplay.startProgressTime,
      progressTime: freeReplay.progressTime,
      cursorTime: freeReplay.cursorTime,
      timeframe,
      paperTrading,
    };
    pendingSaveRef.current = payload;
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void persistFreeReplaySession(payload);
    }, 500);
    return () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    };
  }, [freeReplay, paperTrading, timeframe, reviewMode]);

  useEffect(() => {
    const flush = () => {
      const payload = pendingSaveRef.current;
      if (!payload) return;
      fetch('/api/free-replay/sessions', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      });
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  function requestTradeRefresh() {
    setTradeRefreshToken((token) => token + 1);
  }

  /**
   * Patches the saved review in place AND replaces the module-scoped tag list
   * and per-tag counts with the server's recomputed values, so a tag added or
   * removed by the save shows its real "N 笔" immediately (a locally merged list
   * could not drop a tag that just lost its last trade).
   */
  function handleReviewSaved({ review, tags, tagCounts }: SavedReviewPayload) {
    setData((current) => ({
      ...current,
      tags,
      tagCounts,
      trades: current.trades.map((trade) => (trade.id === review.tradeId ? { ...trade, review } : trade)),
    }));
  }

  /**
   * Renames (`to`) or deletes (`to === null`) a tag for EVERY trade — tag names
   * are global across both review modules. The server responds with the MODULE-
   * scoped tag list/counts for the active review mode (`module` param), so the
   * local snapshot patches synchronously without a refetch. The editor patches
   * its own draft tags, so it is left alone here — remounting it would throw
   * away an unsaved note.
   */
  async function mutateTag({ from, to }: TagMutation): Promise<void> {
    const response = await fetch(to === null ? '/api/tags/delete' : '/api/tags/rename', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(to === null ? { tag: from, module: reviewModule } : { from, to, module: reviewModule }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? '标签操作失败');
    }
    const result = (await response.json()) as TagMutationResponse;
    setData((current) => ({
      ...current,
      tags: result.tags,
      tagCounts: result.tagCounts,
      trades: current.trades.map((trade) => rewriteTradeTags(trade, from, to)),
    }));
    setFilters((current) => (current.tag === from ? { ...current, tag: to ?? undefined } : current));
  }

  async function toggleStarred(trade: ReviewedTrade) {
    const nextStarred = !(trade.review?.starred ?? false);
    const nextReview: TradeReview = {
      tradeId: trade.id,
      tags: trade.review?.tags ?? [],
      note: trade.review?.note ?? '',
      starred: nextStarred,
      updatedAt: trade.review?.updatedAt ?? new Date().toISOString(),
    };

    setData((current) => ({
      ...current,
      trades: current.trades.map((item) => (item.id === trade.id ? { ...item, review: nextReview } : item)),
    }));

    try {
      const saved = (await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tradeId: trade.id, tags: nextReview.tags, note: nextReview.note, starred: nextStarred, module: reviewModule }),
      }).then((response) => response.json())) as SavedReviewPayload;
      handleReviewSaved(saved);
    } catch {
      setData((current) => ({
        ...current,
        trades: current.trades.map((item) => (item.id === trade.id ? { ...item, review: trade.review } : item)),
      }));
    }
  }

  /**
   * 10/29 焦点单：点已完成交易行把视口锚到该仓位回合的开仓点。
   * 锚点时间用 positionOpenTime（与图上「开」标记一致）；token 递增让重复
   * 点同一行也能重新归位。
   */
  function focusPaperOrder(trade: PaperTrade) {
    setOrderFocus((current) => ({ id: trade.id, timeMs: trade.positionOpenTime, token: (current?.token ?? 0) + 1 }));
  }

  /**
   * 10/30 回到光标：清焦点单并把视口跳回光标（开平仓提交、点持仓行）。
   * 步进不走这里 —— 10/28 舒适区契约不变。
   */
  function returnFreeReplayViewToCursor() {
    setOrderFocus(null);
    setCursorReturnToken((token) => token + 1);
  }

  function revealNextFreeReplayCandle() {
    if (!freeReplay) return;
    setOrderFocus(null);
    const nextReplay = nextFreeReplayProgress(freeReplayCandles, freeReplay.cursorTime, freeReplay.progressTime, timeframe);
    if (nextReplay.cursorTime !== freeReplay.cursorTime) {
      const revealedCandle = currentCursorCandle(freeReplayCandles, nextReplay.cursorTime);
      if (revealedCandle) setPaperTrading((current) => processRevealedCandle(current, revealedCandle, nextReplay.progressTime));
    } else {
      setFutureRetryToken((token) => token + 1);
    }
    setFreeReplay({ ...freeReplay, ...nextReplay });
  }

  function rewindFreeReplayCandle() {
    if (!freeReplay) return;
    setOrderFocus(null);
    const progressTime = Math.max(previousFreeReplayProgress(freeReplay.cursorTime), freeReplay.startProgressTime);
    setFreeReplay({
      ...freeReplay,
      progressTime,
      cursorTime: freeReplayCursorTimeForProgress(progressTime, timeframe, replayCandleGrid(freeReplay)),
    });
  }

  function switchFreeReplayTimeframe(nextTimeframe: ReviewTimeframe) {
    setTimeframe(nextTimeframe);
    setFreeReplay((current) => current ? {
      ...current,
      dataAnchorTime: new Date(current.progressTime * 1000).toISOString(),
      startCursorTime: freeReplayCursorTimeForStart(current.startTime, nextTimeframe, replayCandleGrid(current)),
      cursorTime: freeReplayCursorTimeForTimeframeSwitch(current.progressTime, nextTimeframe, replayCandleGrid(current)),
    } : current);
  }

  async function persistFreeReplaySession(payload: FreeReplaySessionPayload) {
    const key = sessionKey(payload.instrument, payload.startTime);
    if (deletedSessionKeysRef.current.has(key)) return;
    const saved = (await fetch('/api/free-replay/sessions', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).then((response) => response.json())) as FreeReplaySession;
    if (deletedSessionKeysRef.current.has(key)) return;
    setFreeReplaySessions((current) => upsertSession(current, saved));
  }

  function restoreFreeReplaySession(payload: FreeReplaySessionPayload) {
    // Flush the outgoing session's still-pending save before switching so its
    // last reveal/rewind/paper-trading action is not dropped by the debounce.
    const pending = pendingSaveRef.current;
    if (pending) {
      pendingSaveRef.current = null;
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      void persistFreeReplaySession(pending);
    }
    setFreeReplay({
      instrument: payload.instrument,
      // 10/21: a session recorded before the move has no `candleSource` and
      // keeps replaying against Binance; a new one replays against its own.
      candleSource: payload.candleSource ?? LEGACY_REPLAY_CANDLE_SOURCE,
      startTime: payload.startTime,
      // Anchor the data window on the restored cursor rather than the session
      // start: a replay that advanced past the initial window would otherwise
      // load candlesticks that all sit before the cursor.
      dataAnchorTime: new Date(payload.cursorTime * 1000).toISOString(),
      startCursorTime: payload.startCursorTime,
      startProgressTime: payload.startProgressTime,
      progressTime: payload.progressTime,
      cursorTime: payload.cursorTime,
    });
    setTimeframe(payload.timeframe);
    setPaperTrading(normalizePaperTradingSession(payload.paperTrading));
    setOrderFocus(null);
    setFreeReplayCandles([]);
  }

  function handleFreeReplayStart(next: FreeReplayStart) {
    const existing = freeReplaySessions.find((session) => session.instrument === next.instrument && session.startTime === next.startTime);
    if (existing) {
      restoreFreeReplaySession(existing);
      return;
    }
    // A deleted key can be legitimately re-created by a fresh start; clear the
    // deleted marker so the auto-save PUT for the new session is not dropped.
    deletedSessionKeysRef.current.delete(sessionKey(next.instrument, next.startTime));
    setFreeReplay(next);
    setOrderFocus(null);
    setFreeReplayCandles([]);
    setPaperTrading(initialPaperTradingSession());
  }

  async function handleDeleteSession(instrument: string, startTime: string) {
    const key = sessionKey(instrument, startTime);
    // Mark the key as deleted before the DELETE resolves so an in-flight PUT
    // response for the same session cannot resurrect it in the local list.
    deletedSessionKeysRef.current.add(key);
    if (pendingSaveRef.current && pendingSaveRef.current.instrument === instrument && pendingSaveRef.current.startTime === startTime) {
      // Deleting the session that is currently being auto-saved: cancel the
      // pending PUT so the deleted row is not resurrected.
      pendingSaveRef.current = null;
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    try {
      await fetch(`/api/free-replay/sessions?${new URLSearchParams({ instrument, startTime })}`, { method: 'DELETE' });
    } catch (error) {
      deletedSessionKeysRef.current.delete(key);
      throw error;
    }
    setFreeReplaySessions((current) => current.filter((session) => !(session.instrument === instrument && session.startTime === startTime)));
    if (freeReplay && freeReplay.instrument === instrument && freeReplay.startTime === startTime) {
      setFreeReplay(null);
      setOrderFocus(null);
      setPaperTrading(initialPaperTradingSession());
    }
  }

  function setFilterCollapsed(filterCollapsed: boolean) {
    setSidebarConfig((current) => ({ ...current, filterCollapsed }));
  }

  function setSidebarCollapsed(collapsed: boolean) {
    if (isNarrowLayout()) return;
    setSidebarConfig((current) => ({ ...current, collapsed }));
  }

  function handleSidebarResizePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (isNarrowLayout()) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    sidebarDragRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: sidebarConfig.width, moved: false };
    document.body.classList.add('sidebar-resizing');
  }

  function handleSidebarResizePointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = sidebarDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = event.clientX - drag.startX;
    if (Math.abs(delta) > 3) drag.moved = true;
    if (!drag.moved) return;
    const nextWidth = clampSidebarWidth(drag.startWidth + delta);
    setSidebarConfig((current) => ({ ...current, collapsed: false, width: nextWidth }));
  }

  function handleSidebarResizePointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = sidebarDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    sidebarDragRef.current = null;
    document.body.classList.remove('sidebar-resizing');
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (!drag.moved) setSidebarCollapsed(!sidebarConfig.collapsed);
  }

  function handleSidebarResizePointerCancel(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = sidebarDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    sidebarDragRef.current = null;
    document.body.classList.remove('sidebar-resizing');
    event.currentTarget.releasePointerCapture(event.pointerId);
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
  }, [reviewMode, freeReplay, freeReplayCandles, timeframe]);

  useEffect(() => {
    selectedTradeRowRef.current?.scrollIntoView({ block: 'center' });
  }, [selectedId]);

  // The other-coin panel is rendered inside each mode's own workspace, so a
  // stale `true` would reopen it as a stray panel in the next mode. The order
  // focus belongs to the replay session too.
  useEffect(() => {
    setOtherCoinOpen(false);
    setOrderFocus(null);
  }, [reviewMode]);

  const freeReplayCurrentCandle = freeReplay ? currentCursorCandle(freeReplayCandles, freeReplay.cursorTime) : null;
  const paperStats = paperTradingStats(paperTrading, freeReplayCurrentCandle);
  const paperMarkers = freeReplay ? paperTradeMarkers(paperTrading.trades, timeframe, freeReplayCandles).filter((marker) => Number(marker.time) <= freeReplay.cursorTime) : [];

  return (
    <main className="app-shell" style={shellStyle}>
      <aside className={`sidebar ${sidebarConfig.collapsed ? 'collapsed' : ''}`}>
        {sidebarConfig.collapsed ? (
          <div className="sidebar-rail">
            <button type="button" className="sidebar-expand" aria-label="展开侧边栏" title="展开侧边栏" onClick={() => setSidebarCollapsed(false)}>
              <ChevronRight size={18} />
            </button>
            <span className="sidebar-mode-label" title={reviewModeTitle(reviewMode)}>{reviewModeNavLabel(reviewMode)}</span>
          </div>
        ) : (
          <>
        <div className="sidebar-header">
          <button type="button" className="sidebar-collapse" aria-label="收起侧边栏" title="收起侧边栏" onClick={() => setSidebarCollapsed(true)}>
            <ChevronLeft size={16} />
          </button>
        </div>
        <div className="mode-switch">
          <button className={reviewMode === 'trade' ? 'selected' : ''} onClick={() => setReviewMode('trade')}>交割单复盘</button>
          <button className={reviewMode === 'bitget' ? 'selected' : ''} onClick={() => setReviewMode('bitget')}>个人交割单复盘</button>
          <button className={reviewMode === 'freeReplay' ? 'selected' : ''} onClick={() => setReviewMode('freeReplay')}>回溯复盘</button>
          <button className={reviewMode === 'scan' ? 'selected' : ''} onClick={() => setReviewMode('scan')}>选品</button>
        </div>
        {isTradeReviewMode(reviewMode) ? (
          <>
        {reviewMode === 'bitget' && <BitgetControlBar onDataChanged={requestTradeRefresh} />}
        <div className={`toolbar ${sidebarConfig.filterCollapsed ? 'filter-collapsed' : ''}`}>
          <button type="button" className="toolbar-header" aria-expanded={!sidebarConfig.filterCollapsed} onClick={() => setFilterCollapsed(!sidebarConfig.filterCollapsed)}>
            <span>筛选</span>
            <ChevronDown size={16} className="toolbar-chevron" />
          </button>
          <div className="toolbar-body">
            <div className="toolbar-body-inner">
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
              <select value={filters.starred ?? ''} onChange={(event) => setFilters({ ...filters, starred: event.target.value as ReviewQueueOptions['starred'] || undefined })}>
                <option value="">收藏状态</option>
                <option value="yes">已收藏</option>
                <option value="no">未收藏</option>
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
          </div>
        </div>
        <div className="review-progress" aria-label="复盘进度">
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
            <div key={trade.id} ref={trade.id === selectedTrade?.id ? selectedTradeRowRef : null} className={`trade-row ${trade.id === selectedTrade?.id ? 'active' : ''}`}>
              <div className="star-cell">
                <button
                  type="button"
                  aria-label={trade.review?.starred ? '取消收藏' : '收藏'}
                  title={trade.review?.starred ? '取消收藏' : '收藏'}
                  className={`star-toggle ${trade.review?.starred ? 'active' : ''}`}
                  onClick={() => { void toggleStarred(trade); }}
                >
                  <Star size={16} fill={trade.review?.starred ? 'currentColor' : 'none'} />
                </button>
              </div>
              <button type="button" className="trade-row-main" onClick={() => setSelectedId(trade.id)}>
                <span className="time">{trade.entryTime.slice(0, 16).replace('T', ' ')}</span>
                <strong>{trade.instrument}</strong>
                <span className={trade.direction === '多' ? 'long' : 'short'}>{trade.direction}</span>
                <span className="trade-meta">{positionMoneyLabel(trade)} · 平仓 {trade.exitTime.slice(5, 16).replace('T', ' ')}</span>
                <span className={trade.profit >= 0 ? 'profit' : 'loss'}>{formatPercent(trade.returnRate)} / {trade.profit.toFixed(2)}</span>
                <span className="tags">{trade.review?.tags.join(' · ') || '未标记'}</span>
              </button>
            </div>
          ))}
        </div>
          </>
        ) : reviewMode === 'scan' ? (
          <CoinScanPanel
            scope={scanScope}
            onScopeChange={(next) => {
              // A result belongs to the scope it was scanned in; never show it
              // under the other sub-module.
              setScanResult(null);
              setScanScope(next);
            }}
            onScanned={setScanResult}
            onSourceChange={setScanSource}
          />
        ) : <FreeReplayPanel timeframe={timeframe} sessions={freeReplaySessions} activeReplay={freeReplay} onStart={handleFreeReplayStart} onReveal={revealNextFreeReplayCandle} onRewind={rewindFreeReplayCandle} onRestore={restoreFreeReplaySession} onDelete={handleDeleteSession} />}
          </>
        )}
      </aside>
      <button
        type="button"
        className="resize-handle"
        aria-label={sidebarConfig.collapsed ? '展开侧边栏' : '调整或收起侧边栏'}
        title={sidebarConfig.collapsed ? '展开侧边栏' : '拖拽调整宽度，点击收起'}
        onPointerDown={handleSidebarResizePointerDown}
        onPointerMove={handleSidebarResizePointerMove}
        onPointerUp={handleSidebarResizePointerUp}
        onPointerCancel={handleSidebarResizePointerCancel}
      >
        {sidebarConfig.collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>
      <section className="workspace">
        {reviewMode === 'freeReplay' ? freeReplay ? (
          <>
            <header className="detail-header">
              <div>
                <h1>{freeReplay.instrument}</h1>
                <p>回溯复盘 {freeReplay.startTime}</p>
              </div>
              <div className="timeframes">
                {reviewTimeframes.map((item) => <button key={item} className={item === timeframe ? 'selected' : ''} onClick={() => switchFreeReplayTimeframe(item)}>{item}</button>)}
                <button type="button" className={otherCoinOpen ? 'selected' : ''} onClick={() => setOtherCoinOpen((current) => !current)}>其他币</button>
              </div>
            </header>
            <div className="free-replay-workspace">
              <FreeReplayChart replay={freeReplay} timeframe={timeframe} paperMarkers={paperMarkers} futureRetryToken={futureRetryToken} focusRequest={orderFocus ? { timeMs: orderFocus.timeMs, token: orderFocus.token } : null} cursorRequest={cursorReturnToken} onCandlesLoaded={setFreeReplayCandles} />
              <FreeReplayPaperTradingPanel
                session={paperTrading}
                stats={paperStats}
                currentCandle={freeReplayCurrentCandle}
                focusedOrderId={orderFocus?.id ?? null}
                onFocusOrder={focusPaperOrder}
                onReturnToCursor={returnFreeReplayViewToCursor}
                onStart={() => setPaperTrading((current) => startPaperTrading(current, freeReplay.progressTime))}
                onReset={() => setPaperTrading(initialPaperTradingSession())}
                onMarketOpen={(settings) => { if (!freeReplayCurrentCandle) return; returnFreeReplayViewToCursor(); setPaperTrading((current) => openMarket(current, freeReplayCurrentCandle, settings, freeReplay.progressTime)); }}
                onLimitOpen={(limitPrice, settings) => { returnFreeReplayViewToCursor(); setPaperTrading((current) => placeEntryLimit(current, limitPrice, settings, freeReplay.progressTime)); }}
                onCloseRatio={(closeRatioPercent) => { if (!freeReplayCurrentCandle) return; returnFreeReplayViewToCursor(); setPaperTrading((current) => closeMarket(current, freeReplayCurrentCandle, freeReplay.progressTime, closeRatioPercent)); }}
                onLimitClose={(limitPrice, quantity) => { returnFreeReplayViewToCursor(); setPaperTrading((current) => placeExitLimit(current, limitPrice, quantity, freeReplay.progressTime)); }}
                onCancelOrder={(kind) => setPaperTrading((current) => cancelPendingOrder(current, kind))}
                onSetStopLoss={(legId, stopPrice) => freeReplayCurrentCandle && setPaperTrading((current) => placeStopLoss(current, legId, stopPrice, freeReplayCurrentCandle.close, freeReplay.progressTime))}
                onCancelStopLoss={(legId) => setPaperTrading((current) => cancelStopLoss(current, legId))}
              />
            </div>
            {otherCoinOpen && (
              // The other-coin panel follows the replay cursor and hides the
              // future, so it needs the cursor time as its anchor. ISO(UTC)
              // because the server parses this string as an instant.
              <div className="chart-float-stack free-replay-float-stack">
                <OtherCoinChart
                  entryTime={new Date(freeReplay.cursorTime * 1000).toISOString()}
                  timeframe={timeframe}
                  cursorTime={freeReplay.cursorTime}
                  onClose={() => setOtherCoinOpen(false)}
                />
              </div>
            )}
          </>
        ) : (
          <div className="empty-state">选择交易对和开始时间，开始回溯复盘</div>
        ) : reviewMode === 'scan' ? (
          <>
            {scanResult && scanResult.method === 'heat' ? (
              <HeatScanResults result={scanResult.data} label={scanResult.anchorLabel} />
            ) : scanResult && scanResult.method === 'box' ? (
              <BoxScanResults result={scanResult.data} />
            ) : (
              <CoinScanResults
                result={scanResult ? scanResult.data : null}
                leaderCoins={leaderCoins}
                onToggleLeaderCoin={toggleLeaderCoin}
                demotedCoins={demotedCoins}
                onToggleDemotedCoin={toggleDemotedCoin}
                onDrawLevel={openLevelDrawer}
              />
            )}
            {drawTarget && (
              // 选品页没有自己的图，所以画线在一个浮层里做：OtherCoinChart 自己拉
              // K 线、不依赖某一笔交易，锚点取"现在"——画的是当下这条线。
              <div className="chart-float-stack level-drawer-stack">
                <div className="level-drawer">
                  <div className="level-drawer-head">
                    <b>{drawTarget}</b>
                    <div className="timeframes">
                      {reviewTimeframes.map((item) => (
                        <button
                          key={item}
                          type="button"
                          className={item === drawTimeframe ? 'selected' : ''}
                          onClick={() => setDrawTimeframe(item)}
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                    <button type="button" className="level-drawer-close" onClick={() => setDrawTarget(null)}>关闭</button>
                  </div>
                  <OtherCoinChart
                    entryTime={new Date().toISOString()}
                    timeframe={drawTimeframe}
                    candleSource={scanSource}
                    initialInstrument={drawTarget}
                    drawable
                    // 扫描板的线：只有这里画的线进「距线」测量（10/26 板隔离）。
                    board="scan"
                    onClose={() => setDrawTarget(null)}
                  />
                </div>
              </div>
            )}
          </>
        ) : selectedTrade ? (
          <>
            <header className="detail-header">
              <div>
                <h1>{selectedTrade.instrument}</h1>
                <p>{selectedTrade.entryTime.slice(0, 16).replace('T', ' ')} 到 {selectedTrade.exitTime.slice(0, 16).replace('T', ' ')}</p>
              </div>
              <div className="timeframes">
                {reviewTimeframes.map((item) => <button key={item} className={item === timeframe ? 'selected' : ''} onClick={() => setTimeframe(item)}>{item}</button>)}
                <button type="button" className={otherCoinOpen ? 'selected' : ''} onClick={() => setOtherCoinOpen((current) => !current)}>其他币</button>
                <button type="button" className={leaderCoinOpen ? 'selected' : ''} onClick={() => setLeaderCoinOpen((current) => !current)}>龙头</button>
                <button type="button" className={heatOpen ? 'selected' : ''} onClick={() => setHeatOpen((current) => !current)}>热度</button>
              </div>
            </header>
            <TradeChart trade={selectedTrade} timeframe={timeframe} candleSource={reviewCandleSource(reviewMode)} tradesEndpoint={tradeReviewEndpoint(reviewMode)} />
            {(otherCoinOpen || leaderCoinOpen || heatOpen) && (
              <div className="chart-float-stack">
                {otherCoinOpen && <OtherCoinChart entryTime={selectedTrade.entryTime} timeframe={timeframe} candleSource={reviewCandleSource(reviewMode)} onClose={() => setOtherCoinOpen(false)} />}
                {leaderCoinOpen && <LeaderCoinPanel coins={leaderCoins} onAdd={addLeaderCoin} onRemove={removeLeaderCoin} onClose={() => setLeaderCoinOpen(false)} candleSource={reviewCandleSource(reviewMode)} />}
                {heatOpen && <MarketHeatPanel instrument={selectedTrade.instrument} entryTime={selectedTrade.entryTime} onClose={() => setHeatOpen(false)} />}
              </div>
            )}
            <div className="review-panel">
              <div className="metrics">
                <Metric label="方向" value={selectedTrade.direction} />
                <Metric label="开仓" value={selectedTrade.entryPrice.toString()} />
                <Metric label="平仓" value={selectedTrade.exitPrice.toString()} />
                <Metric label="收益率" value={formatPercent(selectedTrade.returnRate)} tone={nullableProfitTone(selectedTrade.returnRate)} />
                <Metric label="收益" value={`${selectedTrade.profit.toFixed(2)} USDT`} tone={selectedTrade.profit >= 0 ? 'good' : 'bad'} />
                <Metric label="持仓" value={`${selectedTrade.holdingMinutes} 分钟`} />
              </div>
              <ReviewEditor
                trade={selectedTrade}
                module={reviewModule}
                availableTags={data.tags}
                tagCounts={data.tagCounts}
                onMutateTag={mutateTag}
                onSaved={handleReviewSaved}
              />
            </div>
          </>
        ) : <div className="empty-state">{reviewMode === 'bitget' ? (data.configured ? '暂无 Bitget 历史仓位，请在左侧选择时间范围并同步' : '尚未配置 Bitget API key，请在左侧完成配置后同步') : '没有匹配的交易'}</div>}
      </section>
    </main>
  );
}

function FreeReplayPaperTradingPanel({
  session,
  stats,
  currentCandle,
  onStart,
  onReset,
  onMarketOpen,
  onLimitOpen,
  onCloseRatio,
  onLimitClose,
  onCancelOrder,
  onSetStopLoss,
  onCancelStopLoss,
  focusedOrderId,
  onFocusOrder,
  onReturnToCursor,
}: {
  session: PaperTradingSession;
  stats: PaperStats;
  currentCandle: Candlestick | null;
  onStart: () => void;
  onReset: () => void;
  onMarketOpen: (settings: PaperTradingSettings) => void;
  onLimitOpen: (limitPrice: number, settings: PaperTradingSettings) => void;
  onCloseRatio: (closeRatioPercent: number) => void;
  onLimitClose: (limitPrice: number, quantity: number) => void;
  onCancelOrder: (kind: 'entry' | 'exit') => void;
  onSetStopLoss: (legId: string, stopPrice: number) => void;
  onCancelStopLoss: (legId: string) => void;
  /** The anchored order row (10/29 order-focus jump); null = cursor-follow. */
  focusedOrderId: string | null;
  onFocusOrder: (trade: PaperTrade) => void;
  onReturnToCursor: () => void;
}) {
  const [panelTab, setPanelTab] = useState<'trade' | 'orders'>('trade');
  const [direction, setDirection] = useState<PaperDirection>('long');
  const [positionRatioPercent, setPositionRatioPercent] = useState(100);
  const [leverage, setLeverage] = useState(1);
  const [closeRatioPercent, setCloseRatioPercent] = useState(100);
  const [entryLimit, setEntryLimit] = useState('');
  const [exitLimit, setExitLimit] = useState('');
  const settings = { direction, positionRatioPercent, leverage };
  const available = availableMargin(session);
  const position = session.position;
  const entryLimitPrice = Number(entryLimit);
  const exitLimitPrice = Number(exitLimit);
  const currentPrice = currentCandle?.close;
  const positionQuantity = position?.quantity ?? 0;
  const exitQuantity = positionQuantity * closeRatioPercent / 100;
  const canOpenMarket = session.active && !session.position && !!currentCandle;
  const canAddMarket = session.active && !!position && available > 0 && !!currentCandle;
  const canSubmitEntryLimit = session.active && !session.position && Number.isFinite(entryLimitPrice) && entryLimitPrice > 0;
  const canSubmitAddLimit = session.active && !!position && available > 0 && Number.isFinite(entryLimitPrice) && entryLimitPrice > 0;
  const canSubmitExitLimit = session.active && !!position
    && Number.isFinite(exitLimitPrice) && exitLimitPrice > 0
    && exitQuantity > 0 && exitQuantity <= positionQuantity + 1e-9;
  // Each market/limit close submission consumes the chosen 平仓比例 once, then
  // the control resets to 100% so a later close is a real full close instead
  // of silently repeating an earlier 25/50/75% choice.
  const submitMarketClose = () => { onCloseRatio(closeRatioPercent); setCloseRatioPercent(100); };
  const submitLimitClose = () => { onLimitClose(exitLimitPrice, exitQuantity); setCloseRatioPercent(100); };
  const orderCount = (position ? 1 : 0) + (session.pendingEntry ? 1 : 0) + (session.pendingExit ? 1 : 0) + session.trades.length;

  return (
    <aside className="paper-trading-panel" aria-label="模拟交易面板">
      <div className="paper-panel-header">
        <div>
          <h2>模拟交易</h2>
          <p>本金 1000 USDT</p>
        </div>
        <button type="button" aria-label="重置模拟交易" onClick={onReset}>重置</button>
      </div>

      <div className="paper-stats">
        <Metric label="已实现" value={formatSignedUsdt(stats.realizedPnl)} tone={profitTone(stats.realizedPnl)} />
        <Metric label="总收益率" value={formatPercent(stats.totalReturnRate)} tone={profitTone(stats.totalReturnRate)} />
        <Metric label="胜率" value={stats.winRate === null ? '-' : formatPercent(stats.winRate)} />
        <Metric label="盈亏比" value={stats.profitLossRatio === null ? '-' : stats.profitLossRatio.toFixed(2)} />
      </div>

      <div className="paper-tabs" role="tablist" aria-label="模拟交易面板分页">
        <button type="button" role="tab" aria-selected={panelTab === 'trade'} className={panelTab === 'trade' ? 'selected' : ''} onClick={() => setPanelTab('trade')}>操作</button>
        <button type="button" role="tab" aria-selected={panelTab === 'orders'} className={panelTab === 'orders' ? 'selected' : ''} onClick={() => setPanelTab('orders')}>单子{orderCount ? ` (${orderCount})` : ''}</button>
      </div>

      {panelTab === 'trade' ? (
      <div className="paper-tab-body">
      {!session.active ? (
        <button type="button" aria-label="开始模拟交易" className="save-button paper-primary" onClick={onStart}>开始模拟</button>
      ) : (
        <>
          <div className="paper-section">
            <span className="paper-section-title">参数</span>
            <div className="segmented-control" aria-label="方向">
              <button type="button" className={direction === 'long' ? 'selected' : ''} disabled={!!position} onClick={() => setDirection('long')}>多</button>
              <button type="button" className={direction === 'short' ? 'selected' : ''} disabled={!!position} onClick={() => setDirection('short')}>空</button>
            </div>
            <PresetNumberInput label="仓位比例" ariaLabel="仓位比例" value={positionRatioPercent} min={1} max={100} suffix="%" presets={[10, 25, 50, 100]} onChange={setPositionRatioPercent} />
            <PresetNumberInput label="杠杆" ariaLabel="杠杆" value={leverage} min={1} max={125} suffix="x" presets={[1, 2, 3, 5, 10, 20]} onChange={setLeverage} />
          </div>

          {!position ? (
            <div className="paper-section">
              <span className="paper-section-title">开仓</span>
              <button type="button" aria-label="市价开仓" className="save-button paper-primary" disabled={!canOpenMarket} onClick={() => onMarketOpen(settings)}>市价开仓</button>
              <label>
                限价开仓
                <input aria-label="限价开仓价格" inputMode="decimal" value={entryLimit} onChange={(event) => setEntryLimit(event.target.value)} />
              </label>
              <button type="button" aria-label="提交限价开仓" disabled={!canSubmitEntryLimit} onClick={() => onLimitOpen(entryLimitPrice, settings)}>提交限价开仓</button>
              {session.pendingEntry && <PendingOrderView label="待开仓" price={session.pendingEntry.limitPrice} cancelLabel="取消限价开仓" onCancel={() => onCancelOrder('entry')} />}
            </div>
          ) : (
            <>
              <div className="paper-section">
                <span className="paper-section-title">持仓</span>
                <div className="position-summary">
                  <span>{formatPaperDirection(position.direction)}</span>
                  <span>均价 {position.entryPrice}</span>
                  <span>数量 {position.quantity.toFixed(4)}</span>
                  <span>保证金 {position.margin.toFixed(2)}</span>
                  <span>可用 {available.toFixed(2)}</span>
                  <span className={profitTone(stats.floatingPnl ?? 0) ?? ''}>浮盈 {stats.floatingPnl === null ? '-' : formatSignedUsdt(stats.floatingPnl)}</span>
                </div>
              </div>
              <div className="paper-section">
                <span className="paper-section-title">加仓</span>
                <button type="button" aria-label="市价加仓" className="save-button paper-primary" disabled={!canAddMarket} onClick={() => onMarketOpen(settings)}>市价加仓</button>
                <label>
                  限价加仓
                  <input aria-label="限价加仓价格" inputMode="decimal" value={entryLimit} onChange={(event) => setEntryLimit(event.target.value)} />
                </label>
                <button type="button" aria-label="提交限价加仓" disabled={!canSubmitAddLimit} onClick={() => onLimitOpen(entryLimitPrice, settings)}>提交限价加仓</button>
                {session.pendingEntry && <PendingOrderView label="待加仓" price={session.pendingEntry.limitPrice} cancelLabel="取消限价加仓" onCancel={() => onCancelOrder('entry')} />}
              </div>
              <div className="paper-section">
                <span className="paper-section-title">平仓</span>
                <PresetNumberInput label="平仓比例" ariaLabel="平仓比例" value={closeRatioPercent} min={1} max={100} suffix="%" presets={[25, 50, 75, 100]} onChange={setCloseRatioPercent} />
                <span className="paper-help-text">平仓比例用于市价平仓或固化限价止盈数量；选 100 即全平，提交后复位 100%</span>
                <button type="button" aria-label="市价平仓" className="save-button paper-primary" disabled={!currentCandle} onClick={submitMarketClose}>市价平仓</button>
                <label>
                  限价平仓
                  <input aria-label="限价平仓价格" inputMode="decimal" value={exitLimit} onChange={(event) => setExitLimit(event.target.value)} />
                </label>
                <button type="button" aria-label="提交限价平仓" disabled={!canSubmitExitLimit} onClick={submitLimitClose}>提交限价平仓</button>
                {session.pendingExit && <PendingOrderView label="待平仓" price={session.pendingExit.limitPrice} cancelLabel="取消限价平仓" onCancel={() => onCancelOrder('exit')} />}
              </div>
              <div className="paper-section">
                <span className="paper-section-title">逐仓止损</span>
                <p className="paper-help-text">每个开仓批次（仓）一个止损，数量自动为该仓剩余数量</p>
                {position.legs.map((leg, index) => (
                  <LegStopRow
                    key={leg.id}
                    leg={leg}
                    index={index}
                    currentPrice={currentPrice}
                    direction={position.direction}
                    onSetStopLoss={onSetStopLoss}
                    onCancelStopLoss={onCancelStopLoss}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
      </div>
      ) : (
      <div className="paper-tab-body paper-order-list">
        {position && (
          // 点击当前持仓 = 回到光标（10/29 焦点单解除条款之一）。
          <button type="button" className="paper-position-row" title="回到光标" onClick={onReturnToCursor}>
            <span className="paper-section-title">持仓中 · 点击回到光标</span>
            <span>{formatPaperDirection(position.direction)}</span>
            <span>均价 {position.entryPrice}</span>
            <span>数量 {position.quantity.toFixed(4)}</span>
            <span className={profitTone(stats.floatingPnl ?? 0) ?? ''}>浮盈 {stats.floatingPnl === null ? '-' : formatSignedUsdt(stats.floatingPnl)}</span>
            <span className="paper-order-time">开 {formatPaperTime(position.originTime)}</span>
          </button>
        )}
        {session.pendingEntry && <div className="paper-pending-row">待开仓 {session.pendingEntry.limitPrice}</div>}
        {session.pendingExit && <div className="paper-pending-row">待平仓 {session.pendingExit.limitPrice}</div>}
        {session.trades.map((trade) => (
          <button
            key={`${trade.id}:${trade.exitTime}`}
            type="button"
            className={`paper-trade-row ${focusedOrderId === trade.id ? 'active' : ''}`}
            title="跳到开仓点"
            onClick={() => onFocusOrder(trade)}
          >
            <span>{formatPaperDirection(trade.direction)}</span>
            <span>{trade.entryPrice} → {trade.exitPrice}</span>
            <strong className={profitTone(trade.pnl) ?? ''}>{formatSignedUsdt(trade.pnl)}</strong>
            <span>{formatPercent(trade.returnRate)}</span>
            <span className="paper-order-time">开 {formatPaperTime(trade.positionOpenTime)}</span>
          </button>
        ))}
        {!position && !session.pendingEntry && !session.pendingExit && !session.trades.length && <p className="paper-help-text">暂无单子</p>}
      </div>
      )}
    </aside>
  );
}

function PresetNumberInput({ label, ariaLabel, value, min, max, suffix, presets, onChange }: { label: string; ariaLabel: string; value: number; min: number; max: number; suffix: string; presets: number[]; onChange: (value: number) => void }) {
  return (
    <div className="preset-input">
      <label>
        {label}
        <input aria-label={ariaLabel} type="number" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      </label>
      <div className="preset-buttons">
        {presets.map((preset) => <button key={preset} type="button" className={value === preset ? 'selected' : ''} onClick={() => onChange(preset)}>{preset}{suffix}</button>)}
      </div>
    </div>
  );
}

function PendingOrderView({ label, price, cancelLabel, onCancel }: { label: string; price: number; cancelLabel: string; onCancel: () => void }) {
  return <div className="pending-order"><span>{label} {price}</span><button type="button" aria-label={cancelLabel} onClick={onCancel}>取消</button></div>;
}

function LegStopRow({ leg, index, currentPrice, direction, onSetStopLoss, onCancelStopLoss }: {
  leg: PaperLeg;
  index: number;
  currentPrice: number | undefined;
  direction: PaperDirection;
  onSetStopLoss: (legId: string, stopPrice: number) => void;
  onCancelStopLoss: (legId: string) => void;
}) {
  const [price, setPrice] = useState(leg.stopPrice !== undefined ? String(leg.stopPrice) : '');
  useEffect(() => {
    setPrice(leg.stopPrice !== undefined ? String(leg.stopPrice) : '');
  }, [leg.stopPrice]);
  const priceNumber = Number(price);
  const canSet = currentPrice !== undefined
    && Number.isFinite(priceNumber) && priceNumber > 0
    && isValidStopLossDirection(direction, priceNumber, currentPrice);
  const hasStop = leg.stopPrice !== undefined;
  const hint = currentPrice !== undefined ? stopLossDirectionHint(direction, currentPrice) : '';
  return (
    <div className="leg-stop-row">
      <div className="leg-stop-meta">
        <strong>仓 {index + 1}</strong>
        <span>开 {leg.entryPrice}</span>
        <span>量 {leg.quantity.toFixed(4)}</span>
      </div>
      <div className="leg-stop-control">
        <input aria-label={`仓${index + 1} 止损价`} inputMode="decimal" placeholder={hasStop ? undefined : hint} value={price} onChange={(event) => setPrice(event.target.value)} />
        <button
          type="button"
          aria-label={`${hasStop ? '改' : '设'}仓${index + 1}止损`}
          disabled={!canSet}
          onClick={() => { onSetStopLoss(leg.id, priceNumber); setPrice(String(priceNumber)); }}
        >
          {hasStop ? '改价' : '设止损'}
        </button>
        {hasStop && (
          <button type="button" aria-label={`删除仓${index + 1}止损`} onClick={() => onCancelStopLoss(leg.id)}>删除</button>
        )}
      </div>
    </div>
  );
}

function isValidStopLossDirection(direction: PaperDirection, stopPrice: number, currentPrice: number): boolean {
  if (!Number.isFinite(stopPrice) || stopPrice <= 0) return false;
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return false;
  return direction === 'long' ? stopPrice < currentPrice : stopPrice > currentPrice;
}

function stopLossDirectionHint(direction: PaperDirection, currentPrice: number): string {
  return direction === 'long' ? `低于当前价 ${currentPrice}` : `高于当前价 ${currentPrice}`;
}

function FreeReplayChart({ replay, timeframe, paperMarkers, futureRetryToken, focusRequest, cursorRequest, onCandlesLoaded }: { replay: FreeReplayStart; timeframe: ReviewTimeframe; paperMarkers: SeriesMarker<UTCTimestamp>[]; futureRetryToken: number; focusRequest: { timeMs: number; token: number } | null; cursorRequest: number; onCandlesLoaded: (candles: Candlestick[]) => void }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const loadingFutureRef = useRef(false);
  const lastFutureLoadAnchorRef = useRef<number | null>(null);
  const loadingEarlierRef = useRef(false);
  const lastLoadEarlierRangeRef = useRef<VisibleTimeRange | null>(null);
  const initializedRangeKeyRef = useRef('');
  const suppressAutoLoadRef = useRef(false);
  const pointerRef = useRef<{ inside: boolean; x: number; y: number }>({ inside: false, x: 0, y: 0 });
  const loadedCandlesRef = useRef<Candlestick[]>([]);
  const cursorFollowRangeKeyRef = useRef('');
  // 10/29 焦点单定位：去重键 `rangeKey:token`。开仓点在已加载窗口之外时只取
  // 一次以开仓点为中心的 initial 窗口（focusWindowKeyRef）；取过仍不覆盖就贴
  // 已加载最早边缘定位 —— 与交割单复盘同模式，一次到位，绝不逐页追。
  const appliedFocusKeyRef = useRef('');
  const focusWindowKeyRef = useRef('');
  const loadingFocusWindowRef = useRef(false);
  // 10/30 回到光标请求的去重键。
  const appliedCursorKeyRef = useRef('');
  const pendingSwitchVisibleBarsRef = useRef<number | null>(null);
  const historyBackfillVisibleBarsRef = useRef<number | null>(null);
  const historyBackfillKeyRef = useRef('');
  const previousRangeKeyRef = useRef('');
  const [loadedCandles, setLoadedCandles] = useState<Candlestick[]>([]);
  const [renderedCandles, setRenderedCandles] = useState<Candlestick[]>([]);
  const [status, setStatus] = useState('加载 K 线');
  const [priceScaleMode, setPriceScaleMode] = useState<ChartPriceScaleMode>(PriceScaleMode.Logarithmic);
  const [hoverPercentage, setHoverPercentage] = useState<number | null>(null);
  const [markersVisible, setMarkersVisible] = useState(true);
  // Free Replay keeps later candlesticks loaded (prefetch for the next reveal) but
  // hidden until the cursor reaches them. The magnet must only see the revealed
  // ones: otherwise a point drawn in the blank right padding would snap to a
  // future candle's OHLC and leak its levels.
  const magnetCandles = visibleCandlesForFreeReplay(renderedCandles, replay.cursorTime);
  // The drawing layer (10/21): the tool row, the overlay, the drag handling and
  // the persistence now live in `chart-drawing.tsx`, shared with the trade-review
  // chart and the 选品 level drawer.
  const drawings = useChartDrawings({
    instrument: replay.instrument,
    // 回溯复盘是复盘工作流 —— 它的线不进扫描的距线测量（10/26 板隔离）。
    board: 'review',
    timeframe,
    tradeId: null,
    chartApiRef,
    seriesRef,
    candles: renderedCandles,
    snapCandles: magnetCandles,
    toolbarExtra: (
      <>
        <button type="button" title="重置价格刻度" aria-label="重置价格刻度" onClick={resetPriceScale}><RefreshCcw size={16} /></button>
        <button type="button" className={priceScaleMode === PriceScaleMode.Logarithmic ? 'selected' : ''} title="对数价格刻度" aria-label="切换对数价格刻度" aria-pressed={priceScaleMode === PriceScaleMode.Logarithmic} onClick={toggleLogPriceScale}><Scale size={16} /></button>
        <button type="button" className={!markersVisible ? 'selected' : ''} title={markersVisible ? '隐藏开平仓标记' : '显示开平仓标记'} aria-label={markersVisible ? '隐藏开平仓标记' : '显示开平仓标记'} aria-pressed={!markersVisible} onClick={() => setMarkersVisible((current) => !current)}>{markersVisible ? <Eye size={16} /> : <EyeOff size={16} />}</button>
      </>
    ),
  });

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
    markersRef.current = createSeriesMarkers(series, []);
    resetChartPriceScale(chart);
    const refreshOverlay = () => drawings.bumpOverlay();
    chart.timeScale().subscribeVisibleTimeRangeChange(refreshOverlay);
    return () => chart.remove();
  }, []);

  useEffect(() => {
    const chart = chartApiRef.current;
    if (!chart) return;
    applyChartPriceScaleMode(chart, priceScaleMode);
  }, [priceScaleMode]);

  useEffect(() => {
    const rangeKey = `${replay.instrument}:${replay.startTime}:${timeframe}`;
    const chart = chartApiRef.current;
    const previousRangeKey = previousRangeKeyRef.current;
    if (previousRangeKey && previousRangeKey !== rangeKey && chart) {
      const visibleBars = visibleBarsForChart(chart, chartRef.current);
      pendingSwitchVisibleBarsRef.current = visibleBars;
      historyBackfillVisibleBarsRef.current = visibleBars;
    } else {
      pendingSwitchVisibleBarsRef.current = null;
      historyBackfillVisibleBarsRef.current = null;
    }
    historyBackfillKeyRef.current = '';
    previousRangeKeyRef.current = rangeKey;
    if (chart) resetChartPriceScale(chart);
    setPriceScaleMode(PriceScaleMode.Logarithmic);
    setStatus('加载 K 线');
    setHoverPercentage(null);
    lastFutureLoadAnchorRef.current = null;
    lastLoadEarlierRangeRef.current = null;
    initializedRangeKeyRef.current = '';
    focusWindowKeyRef.current = '';
    appliedFocusKeyRef.current = '';
    const params = new URLSearchParams({ instrument: replay.instrument, timeframe, entryTime: replay.dataAnchorTime, mode: 'initial', source: replayCandleSource(replay) });
    fetchCandles(params)
      .then((candles) => {
        const merged = mergeCandles(candles);
        updateLoadedCandles(merged);
        setRenderedCandles(merged);
        setStatus(merged.length ? '' : '没有 K 线');
      })
      .catch((error) => setStatus(error instanceof ServerCandleError ? error.message : 'K 线加载失败'));
  }, [replay.instrument, replay.startTime, replay.dataAnchorTime, timeframe]);

  useEffect(() => {
    if (!pointerRef.current.inside) return;
    updateHoverPercentage(pointerRef.current.y);
  }, [replay.cursorTime, renderedCandles]);

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartApiRef.current;
    if (!series || !chart) return;
    const visibleCandles = visibleCandlesForFreeReplay(renderedCandles, replay.cursorTime);
    const step = timeframeMs(timeframe) / 1000;
    const visibleBars = pendingSwitchVisibleBarsRef.current ?? visibleBarsForChart(chart, chartRef.current);
    const range = cursorAnchoredTimeRange(replay.cursorTime, step, visibleBars);
    series.setData(chartDataWithWhitespace(visibleCandles, [range.from * 1000, range.to * 1000]));
    markersRef.current?.setMarkers(markersVisible ? paperMarkers : []);
    const rangeKey = `${replay.instrument}:${replay.startTime}:${timeframe}`;
    if (visibleCandles.length && initializedRangeKeyRef.current !== rangeKey) {
      initializedRangeKeyRef.current = rangeKey;
      pendingSwitchVisibleBarsRef.current = null;
      // 10/29: 有焦点单时跳过光标锚定 —— 首次定位让给下方的焦点 effect（它声明
      // 在后，同一 commit 随后执行；开仓点未加载时它先取开仓点窗口，数据到了再定位）。
      if (!focusRequest) anchorViewportToCursor(range as { from: UTCTimestamp; to: UTCTimestamp });
    }
  }, [renderedCandles, replay.cursorTime, replay.instrument, replay.startTime, timeframe, paperMarkers, markersVisible]);

  useEffect(() => {
    if (!loadedCandlesRef.current.length) return;
    setRenderedCandles(loadedCandlesRef.current);
  }, [replay.cursorTime]);

  useEffect(() => {
    const visibleBars = historyBackfillVisibleBarsRef.current;
    if (!visibleBars || loadingEarlierRef.current || !loadedCandles.length) return;
    if (loadedCandles[0].timeframe !== timeframe) return;
    if (!shouldBackfillFreeReplayHistory(loadedCandles, replay.cursorTime, visibleBars)) {
      historyBackfillVisibleBarsRef.current = null;
      historyBackfillKeyRef.current = '';
      return;
    }
    const first = loadedCandles[0].timestamp;
    const key = `${replay.instrument}:${replay.startTime}:${timeframe}:${visibleBars}:${first}`;
    if (historyBackfillKeyRef.current === key) return;
    historyBackfillKeyRef.current = key;
    void loadEarlierFreeReplayCandles();
  }, [loadedCandles, renderedCandles, replay.cursorTime, replay.instrument, replay.startTime, timeframe]);

  // Cursor follow effect: keep the reveal cursor VISIBLE — nothing more.
  //
  // The cursor used to be re-anchored 10 steps from the right edge on EVERY
  // step, which yanked a viewport the user had panned or zoomed (10/28
  // complaint: 点下一根/上一根时画面被来回拉). Now the viewport moves only when
  // the cursor leaves a comfort zone of 10 steps at either edge, and then by
  // the minimum amount: forward keeps the old invariant (cursor 10 steps from
  // the right edge), backward mirrors it on the left. `series.setData` never
  // moves the viewport here — `chartDataWithWhitespace` keeps a constant
  // 200-bar pad at both ends, so the time scale's base index does not change
  // between steps.
  useEffect(() => {
    const chart = chartApiRef.current;
    if (!chart) return;
    const rangeKey = `${replay.instrument}:${replay.startTime}:${timeframe}`;
    if (initializedRangeKeyRef.current !== rangeKey || cursorFollowRangeKeyRef.current !== rangeKey) {
      cursorFollowRangeKeyRef.current = rangeKey;
      return;
    }
    const visible = currentFreeReplayVisibleRange(chart);
    if (!visible) return;
    const step = timeframeMs(timeframe) / 1000;
    const pad = step * 10;
    const cursor = replay.cursorTime;
    // Comfort zone: the cursor is well inside the view — leave the viewport
    // (position AND zoom) exactly as the user left it.
    if (cursor + pad <= visible.to && cursor - pad >= visible.from) return;
    const span = visible.to - visible.from;
    const followsForward = cursor + pad > visible.to;
    suppressAutoLoadRef.current = true;
    chart.timeScale().setVisibleRange(
      followsForward
        ? { from: (cursor - span + pad) as UTCTimestamp, to: (cursor + pad) as UTCTimestamp }
        : { from: (cursor - pad) as UTCTimestamp, to: (cursor - pad + span) as UTCTimestamp },
    );
    window.setTimeout(() => {
      suppressAutoLoadRef.current = false;
    }, 0);
  }, [replay.cursorTime, replay.instrument, replay.startTime, timeframe]);

  // 10/29 焦点单定位：点已完成交易行把视口锚到该仓位回合的开仓点（与交割单
  // 复盘选中交易同一窗口函数 entryVisibleRange，±150 根）。每个 rangeKey+token
  // 只定位一次，之后用户可自由平移缩放；切周期 rangeKey 变 → 同一 token 在新
  // 周期重新定位（焦点跨周期存活，App 在切周期时不清 orderFocus）。开仓点在
  // 已加载窗口之外时，取一次以开仓点为中心的 initial 窗口（交割单复盘模式）
  // 合并后定位；取过仍不覆盖则贴已加载最早边缘，不逐页追、不循环。只移动
  // 视口，渲染层 visibleCandlesForFreeReplay 保证不揭示未来 K 线。
  useEffect(() => {
    const chart = chartApiRef.current;
    if (!chart || !focusRequest) return;
    const rangeKey = `${replay.instrument}:${replay.startTime}:${timeframe}`;
    if (initializedRangeKeyRef.current !== rangeKey) return;
    const focusKey = `${rangeKey}:${focusRequest.token}`;
    if (appliedFocusKeyRef.current === focusKey) return;
    const first = loadedCandlesRef.current[0];
    // 切周期后的过渡 commit 里 loadedCandles 还是上一周期的数据：此时取窗会把
    // 新周期的窗口合进旧周期数组。等初始加载落地再动 —— 与历史回填 effect 同一
    // 道闸。
    if (!first || first.timeframe !== timeframe) return;
    let anchorMs = focusRequest.timeMs;
    if (focusRequest.timeMs < first.timestamp) {
      if (focusWindowKeyRef.current === focusKey) {
        // 本焦点已取过一次窗口仍未覆盖（ venue 历史不解或失败）：贴已加载最早边。
        anchorMs = first.timestamp;
      } else {
        focusWindowKeyRef.current = focusKey;
        void loadFocusWindowCandles(focusRequest.timeMs);
        return;
      }
    }
    appliedFocusKeyRef.current = focusKey;
    const range = entryVisibleRange(new Date(anchorMs).toISOString(), timeframe, replayCandleGrid(replay));
    suppressAutoLoadRef.current = true;
    chart.timeScale().setVisibleRange(range as { from: UTCTimestamp; to: UTCTimestamp });
    window.setTimeout(() => {
      suppressAutoLoadRef.current = false;
    }, 0);
  }, [focusRequest, loadedCandles, renderedCandles, replay.instrument, replay.startTime, timeframe]);

  // 10/30 回到光标：开平仓提交/点持仓行后，视口主动跳回光标（光标右侧留 10
  // 根缓冲，与初始锚定同一函数）。每个令牌只消费一次 —— 切周期不重新消费，
 // 否则会把切周期后的焦点锚定拽回光标。步进不经此 —— 舒适区契约（10/28）不变。
  useEffect(() => {
    const chart = chartApiRef.current;
    if (!chart || !cursorRequest) return;
    const rangeKey = `${replay.instrument}:${replay.startTime}:${timeframe}`;
    if (initializedRangeKeyRef.current !== rangeKey) return;
    if (appliedCursorKeyRef.current === String(cursorRequest)) return;
    appliedCursorKeyRef.current = String(cursorRequest);
    const step = timeframeMs(timeframe) / 1000;
    const visibleBars = pendingSwitchVisibleBarsRef.current ?? visibleBarsForChart(chart, chartRef.current);
    anchorViewportToCursor(cursorAnchoredTimeRange(replay.cursorTime, step, visibleBars) as { from: UTCTimestamp; to: UTCTimestamp });
  }, [cursorRequest, loadedCandles, replay.cursorTime, replay.instrument, replay.startTime, timeframe]);

  useEffect(() => {
    const chart = chartApiRef.current;
    if (!chart) return;
    const handler = (range: LogicalRange | null) => {
      if (suppressAutoLoadRef.current) return;
      const series = seriesRef.current;
      if (!series || !range || loadedCandles.length < 2) return;
      const logicalRange = { from: Number(range.from), to: Number(range.to) };
      if (!Number.isFinite(logicalRange.from) || !Number.isFinite(logicalRange.to)) return;
      if (shouldLoadEarlierByLogicalRange(series, logicalRange) && !isSameVisibleRange(lastLoadEarlierRangeRef.current, logicalRange)) {
        lastLoadEarlierRangeRef.current = logicalRange;
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
      source: replayCandleSource(replay),
    });
    fetchCandles(params)
      .then((candles) => {
        if (!candles.length) return;
        const merged = mergeCandles([...loadedCandlesRef.current, ...candles]);
        loadedCandlesRef.current = merged;
        // Must reach the loaded state too: it drives the anchor guard above, so
        // skipping it pins `last` to the initial window and lets a session
        // prefetch later candlesticks exactly once. Rendered candlesticks stay
        // on the cursor-change effect so prefetched candles remain hidden until
        // they are revealed.
        setLoadedCandles(merged);
        onCandlesLoaded(merged);
      })
      .catch((error) => {
        // Clear the anchor so the next trigger can retry it; keeping it would
        // block any further attempt for this anchor for the whole session.
        lastFutureLoadAnchorRef.current = null;
        setStatus(error instanceof ServerCandleError ? error.message : '后续 K 线加载失败');
      })
      .finally(() => {
        loadingFutureRef.current = false;
      });
  }, [loadedCandles, replay.cursorTime, replay.instrument, replay.startTime, timeframe, futureRetryToken]);

  async function loadEarlierFreeReplayCandles() {
    const chart = chartApiRef.current;
    if (loadingEarlierRef.current || !chart || !loadedCandles.length) return;
    loadingEarlierRef.current = true;
    setStatus('加载更早 K 线');
    const anchor = loadedCandles[0].timestamp;
    const params = new URLSearchParams({
      instrument: replay.instrument,
      timeframe,
      entryTime: replay.startTime,
      mode: 'earlier',
      anchor: String(anchor),
      // 10/30: 会话自带的 venue 必须跟随每一个翻页请求 —— 硬编码会把旧会话
      // （binance-only）的翻页数据混进 Bitget 的价，违反 10/21 契约。
      source: replayCandleSource(replay),
    });
    try {
      const candles = await fetchCandles(params);
      if (candles.length) {
        const merged = mergeCandles([...loadedCandlesRef.current, ...candles]);
        loadedCandlesRef.current = merged;
        setLoadedCandles(merged);
        setRenderedCandles(merged);
        onCandlesLoaded(merged);
      }
      setStatus('');
    } catch (error) {
      setStatus(error instanceof ServerCandleError ? error.message : '更早 K 线加载失败');
    } finally {
      loadingEarlierRef.current = false;
    }
  }

  /**
   * 10/30 焦点单取窗：以开仓点为中心发一次 mode=initial 请求（±150 根，交割单
   * 复盘同一模式），合并进已加载数据。渲染层按光标过滤，不会揭示未来 K 线。
   * 只每个 focusKey 发一次；失败或空窗口时由调用方的贴边逻辑兜底。
   */
  async function loadFocusWindowCandles(timeMs: number) {
    if (loadingFocusWindowRef.current) return;
    loadingFocusWindowRef.current = true;
    setStatus('加载开仓点 K 线');
    const params = new URLSearchParams({
      instrument: replay.instrument,
      timeframe,
      entryTime: new Date(timeMs).toISOString(),
      mode: 'initial',
      source: replayCandleSource(replay),
    });
    try {
      const candles = await fetchCandles(params);
      if (candles.length) {
        const merged = mergeCandles([...loadedCandlesRef.current, ...candles]);
        loadedCandlesRef.current = merged;
        setLoadedCandles(merged);
        setRenderedCandles(merged);
        onCandlesLoaded(merged);
      }
      setStatus('');
    } catch (error) {
      setStatus(error instanceof ServerCandleError ? error.message : '开仓点 K 线加载失败');
    } finally {
      loadingFocusWindowRef.current = false;
    }
  }

  /** 光标锚定视口：光标右侧留 10 根缓冲（初始锚定与「回到光标」共用）。 */
  function anchorViewportToCursor(fallbackRange: { from: UTCTimestamp; to: UTCTimestamp }) {
    const chart = chartApiRef.current;
    if (!chart) return;
    const visibleBars = pendingSwitchVisibleBarsRef.current ?? visibleBarsForChart(chart, chartRef.current);
    suppressAutoLoadRef.current = true;
    const cursorIndex = chart.timeScale().timeToIndex(replay.cursorTime as UTCTimestamp, true);
    if (cursorIndex != null) {
      chart.timeScale().setVisibleLogicalRange(cursorAnchoredLogicalRange(Number(cursorIndex), visibleBars));
    } else {
      chart.timeScale().setVisibleRange(fallbackRange);
    }
    window.setTimeout(() => {
      suppressAutoLoadRef.current = false;
    }, 0);
  }

  function updateLoadedCandles(candles: Candlestick[]) {
    loadedCandlesRef.current = candles;
    setLoadedCandles(candles);
    onCandlesLoaded(candles);
  }

  function currentFreeReplayVisibleRange(chart: IChartApi): NumericVisibleRange | null {
    const visible = chart.timeScale().getVisibleRange();
    if (!visible) return null;
    const from = Number(visible.from);
    const to = Number(visible.to);
    return Number.isFinite(from) && Number.isFinite(to) && to > from ? { from, to } : null;
  }

  function resetPriceScale() {
    const chart = chartApiRef.current;
    if (!chart) return;
    setPriceScaleMode(PriceScaleMode.Logarithmic);
    resetChartPriceScale(chart);
  }

  function toggleLogPriceScale() {
    setPriceScaleMode((current) => current === PriceScaleMode.Logarithmic ? PriceScaleMode.Normal : PriceScaleMode.Logarithmic);
  }

  function updateHoverPercentage(clientY: number) {
    const series = seriesRef.current;
    const rect = chartRef.current?.getBoundingClientRect();
    const baseline = currentCursorCandle(loadedCandlesRef.current, replay.cursorTime)?.close;
    if (!series || !rect) {
      setHoverPercentage(null);
      return;
    }
    const pointerPrice = series.coordinateToPrice(clientY - rect.top);
    setHoverPercentage(hoverPricePercentage(pointerPrice, baseline));
  }

  return (
    <div className="chart-wrap" onPointerMove={(event) => { pointerRef.current = { inside: true, x: event.clientX, y: event.clientY }; updateHoverPercentage(event.clientY); }} onPointerLeave={() => { pointerRef.current.inside = false; setHoverPercentage(null); }}>
      {drawings.toolbar}
      {hoverPercentage !== null && <div className="hover-price-percentage">{formatHoverPricePercentage(hoverPercentage)}</div>}
      <div ref={chartRef} className="chart" />
      {drawings.overlay}
      {status && <div className="chart-status">{status}</div>}
    </div>
  );
}

function TradeChart({ trade, timeframe, candleSource, tradesEndpoint }: { trade: ReviewedTrade; timeframe: ReviewTimeframe; candleSource: CandleSourceId; tradesEndpoint: string }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const markerPrimitiveRef = useRef<TradeMarkerPrimitive | null>(null);
  const markerTooltipRef = useRef<TradeMarkerTooltip | null>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const candlesRef = useRef<Candlestick[]>([]);
  const renderedCandlesRef = useRef<Candlestick[]>([]);
  const loadingRef = useRef<{ earlier: boolean; later: boolean }>({ earlier: false, later: false });
  const lastLoadRangeRef = useRef<{ earlier: VisibleTimeRange | null; later: VisibleTimeRange | null }>({ earlier: null, later: null });
  const pointerRef = useRef<{ inside: boolean; x: number; y: number }>({ inside: false, x: 0, y: 0 });
  const pendingRenderRef = useRef(false);
  const idleTimerRef = useRef<number | null>(null);
  const latestAnchorRef = useRef<NavigationAnchor | null>(null);
  const activeKeyRef = useRef('');
  const suppressAutoLoadRef = useRef(false);
  const markersVisibleRef = useRef(true);
  const [status, setStatus] = useState('加载 K 线');
  const [priceScaleMode, setPriceScaleMode] = useState<ChartPriceScaleMode>(PriceScaleMode.Logarithmic);
  const [activeCandle, setActiveCandle] = useState<Candlestick | null>(null);
  const [markersVisible, setMarkersVisible] = useState(true);
  const [showAllMarkers, setShowAllMarkers] = useState(false);
  const [showPointPrices, setShowPointPrices] = useState(false);
  const [allTrades, setAllTrades] = useState<ReviewedTrade[]>([]);
  const showAllMarkersRef = useRef(false);
  const allTradesRef = useRef<ReviewedTrade[]>([]);
  /** Kept in a ref so the crosshair handler (bound once) reads the live trade. */
  const tradeRef = useRef(trade);
  // The drawing layer (10/21) — shared with the free-replay chart and the 选品
  // level drawer. The trade's candles live in a ref (the chart re-renders for
  // other reasons), so the hook is handed the ref.
  const drawings = useChartDrawings({
    instrument: trade.instrument,
    // 交割单复盘是复盘工作流 —— 它的线不进扫描的距线测量（10/26 板隔离）。
    board: 'review',
    timeframe,
    tradeId: trade.id,
    chartApiRef,
    seriesRef,
    candles: renderedCandlesRef,
    toolbarExtra: (
      <>
        <button type="button" title="重置价格刻度" aria-label="重置价格刻度" onClick={resetPriceScale}><RefreshCcw size={16} /></button>
        <button type="button" className={priceScaleMode === PriceScaleMode.Logarithmic ? 'selected' : ''} title="对数价格刻度" aria-label="切换对数价格刻度" aria-pressed={priceScaleMode === PriceScaleMode.Logarithmic} onClick={toggleLogPriceScale}><Scale size={16} /></button>
        <button type="button" className={showAllMarkers ? 'selected' : ''} title={showAllMarkers ? '隐藏全部开平仓' : '显示全部开平仓'} aria-label={showAllMarkers ? '隐藏全部开平仓' : '显示全部开平仓'} aria-pressed={showAllMarkers} onClick={() => setShowAllMarkers((current) => !current)}><MapPin size={16} /></button>
        <button type="button" className={showPointPrices ? 'selected' : ''} title={showPointPrices ? '隐藏点位价格' : '显示点位价格'} aria-label={showPointPrices ? '隐藏点位价格' : '显示点位价格'} aria-pressed={showPointPrices} onClick={() => setShowPointPrices((current) => !current)}><CircleDollarSign size={16} /></button>
        {!showAllMarkers ? (
          <button type="button" className={!markersVisible ? 'selected' : ''} title={markersVisible ? '隐藏开平仓标记' : '显示开平仓标记'} aria-label={markersVisible ? '隐藏开平仓标记' : '显示开平仓标记'} aria-pressed={!markersVisible} onClick={() => setMarkersVisible((current) => !current)}>{markersVisible ? <Eye size={16} /> : <EyeOff size={16} />}</button>
        ) : null}
      </>
    ),
  });

  useEffect(() => {
    markersVisibleRef.current = markersVisible;
  }, [markersVisible]);

  useEffect(() => {
    showAllMarkersRef.current = showAllMarkers;
  }, [showAllMarkers]);

  useEffect(() => {
    allTradesRef.current = allTrades;
  }, [allTrades]);

  useEffect(() => {
    tradeRef.current = trade;
  }, [trade]);

  useEffect(() => {
    markerPrimitiveRef.current?.setShowText(showPointPrices);
  }, [showPointPrices]);

  useEffect(() => {
    if (!showAllMarkers) return;
    let cancelled = false;
    fetch(`${tradesEndpoint}?${new URLSearchParams({ instrument: trade.instrument })}`)
      .then((response) => response.json())
      .then(({ trades: next }: { trades: ReviewedTrade[] }) => {
        if (!cancelled) setAllTrades(next);
      })
      .catch(() => {
        if (!cancelled) setAllTrades([]);
      });
    return () => {
      cancelled = true;
    };
  }, [showAllMarkers, trade.instrument, tradesEndpoint]);

  useEffect(() => {
    const container = chartRef.current;
    if (!container) return;
    const chart = createChart(container, {
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
    const markerPrimitive = new TradeMarkerPrimitive([], []);
    series.attachPrimitive(markerPrimitive);
    markerPrimitiveRef.current = markerPrimitive;
    const tooltip = createTradeMarkerTooltip(container);
    markerTooltipRef.current = tooltip;
    resetChartPriceScale(chart);
    const refreshOverlay = () => drawings.bumpOverlay();
    const updateActiveCandle = (param: MouseEventParams) => {
      setActiveCandle(candlestickAtTime(renderedCandlesRef.current, param.time));
      const hit = param.point ? markerPrimitive.findPointAt(param.point.x, param.point.y) : null;
      if (!hit || !param.point) {
        tooltip.hide();
        return;
      }
      tooltip.show(tooltipDataFor(hit, tradeRef.current), { x: param.point.x, y: param.point.y });
    };
    chart.timeScale().subscribeVisibleTimeRangeChange(refreshOverlay);
    chart.subscribeCrosshairMove(updateActiveCandle);
    return () => {
      chart.unsubscribeCrosshairMove(updateActiveCandle);
      tooltip.destroy();
      markerTooltipRef.current = null;
      markerPrimitiveRef.current = null;
      chart.remove();
    };
  }, []);

  useEffect(() => {
    const chart = chartApiRef.current;
    if (!chart) return;
    applyChartPriceScaleMode(chart, priceScaleMode);
  }, [priceScaleMode]);

  useEffect(() => {
    setStatus('加载 K 线');
    const key = `${trade.id}:${timeframe}`;
    const chart = chartApiRef.current;
    if (chart) resetChartPriceScale(chart);
    setPriceScaleMode(PriceScaleMode.Logarithmic);
    activeKeyRef.current = key;
    candlesRef.current = [];
    renderedCandlesRef.current = [];
    setActiveCandle(null);
    loadingRef.current = { earlier: false, later: false };
    lastLoadRangeRef.current = { earlier: null, later: null };
    pendingRenderRef.current = false;
    latestAnchorRef.current = null;
    if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
    const params = new URLSearchParams({ instrument: trade.instrument, timeframe, entryTime: trade.entryTime, mode: 'initial', source: candleSource });
    fetchCandles(params)
      .then((candles) =>
        extendCandlesForLateActions(candles, {
          instrument: trade.instrument,
          timeframe,
          entryTime: trade.entryTime,
          source: candleSource,
          latestTimeMs: latestTradeTimeMs(trade),
        }),
      )
      .then((candles) => {
        if (activeKeyRef.current !== key) return;
        const series = seriesRef.current;
        const chart = chartApiRef.current;
        if (!series || !chart) return;
        candlesRef.current = mergeCandles(candles);
        renderedCandlesRef.current = candlesRef.current;
        const entryRange = entryVisibleRange(trade.entryTime, timeframe);
        latestAnchorRef.current = { time: (entryRange.from + entryRange.to) / 2, ratio: 0.5 };
        suppressAutoLoadRef.current = true;
        renderCandles(timeframe, candlesRef.current, series, markerPrimitiveRef.current, showAllMarkersRef.current || markersVisibleRef.current, currentMarkerPoints());
        chart.timeScale().setVisibleRange(entryRange as { from: UTCTimestamp; to: UTCTimestamp });
        window.setTimeout(() => {
          suppressAutoLoadRef.current = false;
        }, 0);
        setStatus(candles.length ? '' : '没有拿到 K 线');
      })
      .catch((error) => setStatus(error instanceof ServerCandleError ? error.message : 'K 线加载失败'));
  }, [trade.id, timeframe]);

  function currentMarkerPoints(): MarkerPoint[] {
    if (showAllMarkersRef.current) {
      const sameInstrumentTrades = allTradesRef.current.filter((item) => item.instrument === trade.instrument);
      return allTradeChartPoints(sameInstrumentTrades, trade.id, timeframe, renderedCandlesRef.current);
    }
    return tradeChartPoints(trade, timeframe, renderedCandlesRef.current);
  }

  useEffect(() => {
    const series = seriesRef.current;
    const primitive = markerPrimitiveRef.current;
    if (!series || !primitive) return;
    if (showAllMarkers) {
      if (!renderedCandlesRef.current.length) return;
      suppressAutoLoadRef.current = true;
      renderCandles(timeframe, renderedCandlesRef.current, series, primitive, true, currentMarkerPoints());
      window.setTimeout(() => {
        suppressAutoLoadRef.current = false;
      }, 0);
      return;
    }
    if (renderedCandlesRef.current.length) {
      suppressAutoLoadRef.current = true;
      renderCandles(timeframe, renderedCandlesRef.current, series, primitive, markersVisible, currentMarkerPoints());
      window.setTimeout(() => {
        suppressAutoLoadRef.current = false;
      }, 0);
    } else {
      primitive.setPoints(markersVisible ? currentMarkerPoints() : [], renderedCandlesRef.current);
    }
  }, [showAllMarkers, markersVisible, trade.id, timeframe, allTrades]);

  useEffect(() => {
    const chart = chartApiRef.current;
    if (!chart) return;
    const handler = (range: LogicalRange | null) => {
      if (suppressAutoLoadRef.current) return;
      const series = seriesRef.current;
      const visible = chart.timeScale().getVisibleRange();
      if (!series || !range || !visible || candlesRef.current.length < 2) return;
      latestAnchorRef.current = captureNavigationAnchor(chart) ?? latestAnchorRef.current;
      const first = candlesRef.current[0].timestamp / 1000;
      const last = candlesRef.current[candlesRef.current.length - 1].timestamp / 1000;
      const visibleRange = { from: Number(visible.from), to: Number(visible.to) };
      const span = Number(visible.to) - Number(visible.from);
      const threshold = Math.max(span * 0.35, inferCandleStep(candlesRef.current) / 1000 * 20);
      const logicalRange = { from: Number(range.from), to: Number(range.to) };
      if (shouldLoadEarlierByLogicalRange(series, logicalRange) && !isSameVisibleRange(lastLoadRangeRef.current.earlier, logicalRange)) {
        lastLoadRangeRef.current.earlier = logicalRange;
        void loadMore('earlier');
      }
      if (shouldLoadLater(visibleRange, { first, last }, threshold) && !isSameVisibleRange(lastLoadRangeRef.current.later, visibleRange)) {
        schedulePendingRender();
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
      if (event.key === 'Escape') {
        drawings.setSelectedDrawingId('');
        return;
      }
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
    renderCandles(timeframe, renderedCandlesRef.current, series, markerPrimitiveRef.current, showAllMarkersRef.current || markersVisibleRef.current, currentMarkerPoints());
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
    if (pointerRef.current.inside && rect && rect.width > 0 && pointerRef.current.y >= rect.top && pointerRef.current.y <= rect.bottom) {
      const timeScale = chart.timeScale();
      const scaleWidth = timeScale.width();
      // The time axis is narrower than the chart: the right price axis takes
      // its own column. Coordinate→time conversion runs in the time-scale's
      // pixel space, so the anchor ratio must be relative to that width too —
      // otherwise the reconstructed range in `visibleRangeForAnchor` is
      // shifted by the price-axis width on every restore.
      if (scaleWidth > 0) {
        const x = Math.min(Math.max(pointerRef.current.x - rect.left, 0), scaleWidth);
        const time = timeScale.coordinateToTime(x);
        if (typeof time === 'number') return { time, ratio: x / scaleWidth };
      }
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
      source: candleSource,
    });
    try {
      const candles = await fetchCandles(params);
      if (candles.length) {
        candlesRef.current = mergeCandles([...candlesRef.current, ...candles]);
        if (direction === 'earlier') {
          const series = seriesRef.current;
          const chart = chartApiRef.current;
          if (!series || !chart) return;
          const visible = currentVisibleRange(chart);
          const anchor = latestAnchorRef.current ?? captureNavigationAnchor(chart);
          renderedCandlesRef.current = candlesRef.current;
          suppressAutoLoadRef.current = true;
          renderCandles(timeframe, renderedCandlesRef.current, series, markerPrimitiveRef.current, showAllMarkersRef.current || markersVisibleRef.current, currentMarkerPoints());
          if (visible && anchor) {
            chart.timeScale().setVisibleRange(visibleRangeForAnchor(anchor, visible.to - visible.from) as { from: UTCTimestamp; to: UTCTimestamp });
          }
          window.setTimeout(() => {
            suppressAutoLoadRef.current = false;
          }, 0);
        } else {
          pendingRenderRef.current = true;
          schedulePendingRender();
        }
      }
      setStatus('');
    } catch (error) {
      setStatus(error instanceof ServerCandleError ? error.message : 'K 线加载失败');
    } finally {
      loadingRef.current[direction] = false;
    }
  }

  function resetPriceScale() {
    const chart = chartApiRef.current;
    if (!chart) return;
    setPriceScaleMode(PriceScaleMode.Logarithmic);
    resetChartPriceScale(chart);
  }

  function toggleLogPriceScale() {
    setPriceScaleMode((current) => current === PriceScaleMode.Logarithmic ? PriceScaleMode.Normal : PriceScaleMode.Logarithmic);
  }

  return (
    <div className="chart-wrap" onPointerMove={(event) => { pointerRef.current = { inside: true, x: event.clientX, y: event.clientY }; }} onPointerLeave={() => { pointerRef.current.inside = false; setActiveCandle(null); }}>
      {drawings.toolbar}
      <CandlestickReadout candle={activeCandle} timeframe={timeframe} />
      <div ref={chartRef} className="chart" />
      {drawings.overlay}
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

function visibleBarsForChart(chart: IChartApi, element: HTMLElement | null): number {
  const timeScale = chart.timeScale();
  const logicalRange = typeof timeScale.getVisibleLogicalRange === 'function' ? timeScale.getVisibleLogicalRange() : null;
  const width = element?.getBoundingClientRect().width;
  const barSpacing = timeScale.options().barSpacing;
  const fallback = visibleBarCountForWidth(width, barSpacing);
  return visibleBarCountForLogicalRange(logicalRange, fallback);
}

function shouldLoadEarlierByLogicalRange(series: ISeriesApi<'Candlestick'>, range: NumericVisibleRange, threshold = 50): boolean {
  const barsInfo = series.barsInLogicalRange(range);
  return barsInfo !== null && barsInfo.barsBefore < threshold;
}

function pointToScreen(point: ChartPoint, chart: IChartApi, series: ISeriesApi<'Candlestick'>): { x: number; y: number } | null {
  const x = chart.timeScale().timeToCoordinate(point.time as UTCTimestamp);
  const y = series.priceToCoordinate(point.price);
  return x == null || y == null ? null : { x, y };
}

function renderCandles(timeframe: ReviewTimeframe, candles: Candlestick[], series: ISeriesApi<'Candlestick'>, primitive: TradeMarkerPrimitive | null, markersVisible: boolean, nextPoints: MarkerPoint[]) {
  // No time-axis padding for points: a point is only produced when a loaded
  // candlestick already contains its time (`tradeChartPoints` drops the rest),
  // so every point already sits on a real candle. Padding with anything else —
  // e.g. a raw fill timestamp that is not one of the candles' times — inserts
  // an extra slot between two candles and shoves the later one out of place.
  series.setData(chartDataWithWhitespace(candles));
  primitive?.setPoints(markersVisible ? nextPoints : [], candles);
}

/** The latest moment this trade touches: its exit and every action. */
function latestTradeTimeMs(trade: ReviewedTrade): number | null {
  const times = [Date.parse(trade.exitTime), ...(trade.points ?? []).map((point) => point.timeMs)].filter((value) => Number.isFinite(value));
  return times.length ? Math.max(...times) : null;
}

/**
 * The initial candle window spans 150 bars either side of the entry. A round
 * that runs longer than that (overnight holds, later adds) leaves its later
 * actions without a candlestick to anchor to, so they cannot be drawn. Pull one
 * extra window after what was loaded; anything beyond that arrives through the
 * normal scroll-loading.
 */
async function extendCandlesForLateActions(
  candles: Candlestick[],
  input: { instrument: string; timeframe: ReviewTimeframe; entryTime: string; source: CandleSourceId; latestTimeMs: number | null },
): Promise<Candlestick[]> {
  const lastLoaded = candles[candles.length - 1]?.timestamp;
  if (input.latestTimeMs === null || lastLoaded === undefined || input.latestTimeMs <= lastLoaded) return candles;
  try {
    const extra = await fetchCandles(
      new URLSearchParams({
        instrument: input.instrument,
        timeframe: input.timeframe,
        entryTime: input.entryTime,
        mode: 'later',
        anchor: String(lastLoaded),
        source: input.source,
      }),
    );
    return extra.length ? mergeCandles([...candles, ...extra]) : candles;
  } catch {
    // Supplementary window: a failure here must not sink the primary load.
    return candles;
  }
}

/** Hover-card payload: per-action detail when the source has orders, else the
 * round's own entry/exit figures. */
function tooltipDataFor(point: MarkerPoint, trade: ReviewedTrade): TooltipData {
  if (point.detail) {
    return {
      kind: point.detail.kind,
      direction: point.direction,
      timeMs: point.detail.timeMs,
      price: point.detail.price,
      qty: point.detail.qty,
      fee: point.detail.fee,
      profit: point.detail.profit,
      source: point.detail.source,
      leverage: point.detail.leverage,
    };
  }
  return {
    kind: point.kind,
    direction: point.direction,
    timeMs: point.timeMs,
    price: point.price,
    qty: trade.size,
    fee: null,
    profit: point.kind === 'close' ? trade.profit : null,
    source: '',
    leverage: trade.leverage,
  };
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

function formatPercent(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(2)}%`;
}

function formatSignedUsdt(value: number): string {
  const normalized = Object.is(value, -0) ? 0 : value;
  const sign = normalized > 0 ? '+' : '';
  return `${sign}${normalized.toFixed(2)} USDT`;
}

function formatUsdtAmount(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)} USDT`;
}

function formatPaperDirection(direction: PaperDirection): string {
  return direction === 'long' ? '多' : '空';
}

/** 单子行的开仓时间（北京时间 MM-DD HH:mm）。 */
function formatPaperTime(timeMs: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(timeMs));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return `${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

function profitTone(value: number): 'good' | 'bad' | undefined {
  if (value > 0) return 'good';
  if (value < 0) return 'bad';
  return undefined;
}

/** Tone for nullable rate/amount fields: null carries no tone. */
function nullableProfitTone(value: number | null): 'good' | 'bad' | undefined {
  return value === null ? undefined : profitTone(value);
}

function formatLeverage(value: number | null): string {
  if (value === null) return '—';
  return `${Number.isInteger(value) ? value.toString() : value.toFixed(2)}x`;
}

/**
 * 行内"仓位金额"段: 有 margin 的源(xlsx)显示杠杆+保证金(现状); 无 margin 的
 * Bitget 个人源显示可算的开仓名义价值(turnover), 不伪造保证金。
 */
function positionMoneyLabel(trade: ReviewedTrade): string {
  return trade.margin !== null
    ? `${formatLeverage(trade.leverage)} · 保证金 ${formatUsdtAmount(trade.margin)}`
    : `名义价值 ${formatUsdtAmount(trade.turnover)}`;
}
