import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { Candlestick } from '../domain/candlestick';
import type { ReviewTimeframe } from '../domain/trade';
import type { FreeReplayReviewStatus, FreeReplaySession, FreeReplaySessionPayload, FreeReplayStart } from '../domain/free-replay-session';
import { freeReplayCursorTimeForProgress, freeReplayCursorTimeForStart, freeReplayCursorTimeForTimeframeSwitch } from './chart-time';
import { LEGACY_REPLAY_CANDLE_SOURCE, nextFreeReplayProgress, previousFreeReplayProgress, replayCandleGrid, replayCandleSource, replayRequestInstrument } from './free-replay-chart';
import { chartMarketContext } from './chart-market-context';
import { hasAutomaticOrders, loadPartialExecutionCandles, needsPartialExecution, processExecutionCandles } from './free-replay-order-execution';
import {
  currentCursorCandle,
  initialPaperTradingSession,
  normalizePaperTradingSession,
  processRevealedCandle,
  type PaperTradingSession,
} from './free-replay-paper-trading';

export type FreeReplaySessionLifecycleOptions = {
  /** Whether the reviewer is currently in the Free Replay workflow. */
  active: boolean;
  /** Cursor-only Dataset supply. Focus candles must never enter this input. */
  cursorCandles: Candlestick[];
  /** No further Cursor advance is available: retry the future Candlestick load. */
  onFutureRetry: () => void;
  /** Start/restore: clear Focus and both chart-facing candle arrays. */
  onResetView: () => void;
  /** Cursor commands and active-session deletion clear only the focused order. */
  onClearFocus: () => void;
  /** Successful server delete: prune this session's Paper Round client state. */
  onSessionDeleted: (instrument: string, startTime: string) => void;
};

export type FreeReplaySessionLifecycleResult = {
  freeReplay: FreeReplayStart | null;
  paperTrading: PaperTradingSession;
  /**
   * 11/10：冻结感知的 Paper Trading 更新入口 —— `ended` 态下 no-op，
   * 避免每个交易回调各自设防；受信任的内部迁移走私有 raw setter。
   */
  setPaperTrading: Dispatch<SetStateAction<PaperTradingSession>>;
  /** 11/10 结束/恢复复盘：`ended` = 只读冻结态，`active` = 可操作态。 */
  reviewStatus: FreeReplayReviewStatus;
  endReview: () => void;
  resumeReview: () => void;
  timeframe: ReviewTimeframe;
  /** Trade Review uses the shared timeframe without Replay cursor remapping. */
  setTimeframe: Dispatch<SetStateAction<ReviewTimeframe>>;
  sessions: FreeReplaySession[];
  start: (next: FreeReplayStart) => void;
  restore: (payload: FreeReplaySessionPayload) => void;
  remove: (instrument: string, startTime: string) => Promise<void>;
  /** Transitional coarse candles load execution-only child candles. */
  revealPending: boolean;
  /** Loading/incomplete-data failure; the reveal was not committed. */
  executionError: string;
  revealNext: () => void;
  rewind: () => void;
  switchTimeframe: (next: ReviewTimeframe) => void;
};

type LifecycleCallbacks = Pick<
  FreeReplaySessionLifecycleOptions,
  'onFutureRetry' | 'onResetView' | 'onClearFocus' | 'onSessionDeleted'
>;

function upsertSession(sessions: FreeReplaySession[], saved: FreeReplaySession): FreeReplaySession[] {
  return [...sessions.filter((session) => !(session.instrument === saved.instrument && session.startTime === saved.startTime)), saved]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function sessionKey(instrument: string, startTime: string): string {
  return `${instrument}:${startTime}`;
}

/**
 * Owns one reviewer's Free Replay Session lifecycle. Candlestick windows,
 * focused-order state and Paper Library stay outside this Module; the small
 * callback surface connects those concerns without duplicating their state.
 */
export function useFreeReplaySessionLifecycle({
  active,
  cursorCandles,
  onFutureRetry,
  onResetView,
  onClearFocus,
  onSessionDeleted,
}: FreeReplaySessionLifecycleOptions): FreeReplaySessionLifecycleResult {
  const [freeReplay, setFreeReplay] = useState<FreeReplayStart | null>(null);
  const [paperTrading, setPaperTradingState] = useState<PaperTradingSession>(() => initialPaperTradingSession());
  // 11/10 结束/恢复复盘：整个 Replay 的可逆只读状态。不复用 paperTrading.active
  //（它只表示“是否已开始模拟交易”）；无活跃回放时恒为 active。
  const [reviewStatus, setReviewStatus] = useState<FreeReplayReviewStatus>('active');
  const [revealPending, setRevealPending] = useState(false);
  const [executionError, setExecutionError] = useState('');
  const [timeframe, setTimeframe] = useState<ReviewTimeframe>('5m');
  const [sessions, setSessions] = useState<FreeReplaySession[]>([]);
  const pendingSaveRef = useRef<FreeReplaySessionPayload | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const deletedSessionKeysRef = useRef<Set<string>>(new Set());
  const revealOperationSequenceRef = useRef(0);
  const activeRevealOperationRef = useRef<number | null>(null);
  const replayActiveRef = useRef(active);
  replayActiveRef.current = active;
  const callbacksRef = useRef<LifecycleCallbacks>({ onFutureRetry, onResetView, onClearFocus, onSessionDeleted });
  callbacksRef.current = { onFutureRetry, onResetView, onClearFocus, onSessionDeleted };

  useEffect(() => {
    if (!active) invalidateReveal();
  }, [active]);

  useEffect(() => () => {
    revealOperationSequenceRef.current += 1;
    activeRevealOperationRef.current = null;
  }, []);

  useEffect(() => {
    fetch('/api/free-replay/sessions')
      .then((response) => response.json())
      .then(({ sessions: saved }: { sessions?: FreeReplaySession[] }) => setSessions(saved ?? []));
  }, []);

  // Trailing-debounced auto-save: reveal, rewind, timeframe and Paper Trading
  // changes persist the active Session. Leaving Replay flushes the last action.
  useEffect(() => {
    if (!active || !freeReplay) {
      flushPendingSave();
      return;
    }
    const payload: FreeReplaySessionPayload = {
      instrument: freeReplay.instrument,
      candleSource: freeReplay.candleSource,
      startTime: freeReplay.startTime,
      dataAnchorTime: freeReplay.dataAnchorTime,
      startCursorTime: freeReplay.startCursorTime,
      startProgressTime: freeReplay.startProgressTime,
      progressTime: freeReplay.progressTime,
      cursorTime: freeReplay.cursorTime,
      timeframe,
      paperTrading,
      reviewStatus,
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
  }, [freeReplay, paperTrading, timeframe, reviewStatus, active]);

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

  async function persistFreeReplaySession(payload: FreeReplaySessionPayload): Promise<void> {
    const key = sessionKey(payload.instrument, payload.startTime);
    if (deletedSessionKeysRef.current.has(key)) return;
    const saved = (await fetch('/api/free-replay/sessions', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).then((response) => response.json())) as FreeReplaySession;
    if (deletedSessionKeysRef.current.has(key)) return;
    setSessions((current) => upsertSession(current, saved));
  }

  function flushPendingSave(): void {
    const pending = pendingSaveRef.current;
    if (!pending) return;
    pendingSaveRef.current = null;
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    void persistFreeReplaySession(pending);
  }

  /** Invalidate before any scene/Paper command so a late child-candle load is inert. */
  function invalidateReveal(): void {
    revealOperationSequenceRef.current += 1;
    activeRevealOperationRef.current = null;
    setRevealPending(false);
    setExecutionError('');
  }

  function commitReveal(current: FreeReplayStart, nextReplay: { cursorTime: number; progressTime: number }, nextPaper: PaperTradingSession): void {
    callbacksRef.current.onClearFocus();
    setPaperTradingState(nextPaper);
    setFreeReplay({ ...current, ...nextReplay });
  }

  function revealPartial(current: FreeReplayStart, nextReplay: { cursorTime: number; progressTime: number }): void {
    const operation = revealOperationSequenceRef.current + 1;
    revealOperationSequenceRef.current = operation;
    activeRevealOperationRef.current = operation;
    setRevealPending(true);
    setExecutionError('');

    const source = replayCandleSource(current);
    const market = chartMarketContext(source);
    const instrument = replayRequestInstrument(current.instrument, market.requestSource);
    void loadPartialExecutionCandles({
      instrument,
      source,
      previousProgressTime: current.progressTime,
      nextProgressTime: nextReplay.progressTime,
      timeframe,
      grid: market.grid,
    }).then((candles) => {
      if (!replayActiveRef.current || activeRevealOperationRef.current !== operation) return;
      const nextPaper = processExecutionCandles(paperTrading, candles);
      if (!replayActiveRef.current || activeRevealOperationRef.current !== operation) return;
      activeRevealOperationRef.current = null;
      commitReveal(current, nextReplay, nextPaper);
      setRevealPending(false);
    }).catch((error: unknown) => {
      if (!replayActiveRef.current || activeRevealOperationRef.current !== operation) return;
      activeRevealOperationRef.current = null;
      setRevealPending(false);
      const reason = error instanceof Error ? error.message : '细周期成交数据加载失败';
      setExecutionError(`${reason}；未推进 K 线`);
    });
  }

  function restore(payload: FreeReplaySessionPayload): void {
    // Do not drop the outgoing Session's final reveal/trading action.
    flushPendingSave();
    const current = freeReplay;
    // 11/10：同 key 恢复（点当前会话历史行/相同开始键）不得绕过「恢复复盘」——
    // 状态以 lifecycle 当前值为准；只有恢复其他会话才读行上的保存状态。
    const sameActiveSession = current !== null
      && current.instrument === payload.instrument
      && current.startTime === payload.startTime;
    // ended 下同 key restore 完全 no-op：否则历史行/模拟单库里的旧保存值会
    // 暗中回滚游标或 Paper 现场。模拟单库仍会在 restore 返回后设置 Focus。
    if (sameActiveSession && reviewStatus === 'ended') return;
    invalidateReveal();
    setFreeReplay({
      instrument: payload.instrument,
      candleSource: payload.candleSource ?? LEGACY_REPLAY_CANDLE_SOURCE,
      startTime: payload.startTime,
      dataAnchorTime: new Date(payload.cursorTime * 1000).toISOString(),
      startCursorTime: payload.startCursorTime,
      startProgressTime: payload.startProgressTime,
      progressTime: payload.progressTime,
      cursorTime: payload.cursorTime,
    });
    setTimeframe(payload.timeframe);
    setPaperTradingState(normalizePaperTradingSession(payload.paperTrading));
    setReviewStatus(sameActiveSession ? reviewStatus : (payload.reviewStatus === 'ended' ? 'ended' : 'active'));
    callbacksRef.current.onResetView();
  }

  function start(next: FreeReplayStart): void {
    const existing = sessions.find((session) => session.instrument === next.instrument && session.startTime === next.startTime);
    if (existing) {
      restore(existing);
      return;
    }
    deletedSessionKeysRef.current.delete(sessionKey(next.instrument, next.startTime));
    invalidateReveal();
    setReviewStatus('active');
    setFreeReplay(next);
    setPaperTradingState(initialPaperTradingSession());
    callbacksRef.current.onResetView();
  }

  async function remove(instrument: string, startTime: string): Promise<void> {
    invalidateReveal();
    const key = sessionKey(instrument, startTime);
    // Mark before DELETE resolves so an in-flight PUT cannot resurrect the row.
    deletedSessionKeysRef.current.add(key);
    const pending = pendingSaveRef.current;
    if (pending && pending.instrument === instrument && pending.startTime === startTime) {
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
    callbacksRef.current.onSessionDeleted(instrument, startTime);
    setSessions((current) => current.filter((session) => !(session.instrument === instrument && session.startTime === startTime)));
    if (freeReplay && freeReplay.instrument === instrument && freeReplay.startTime === startTime) {
      setFreeReplay(null);
      setPaperTradingState(initialPaperTradingSession());
      // 11/10：删除当前会话后状态复位，下一个会话不继承 ended。
      setReviewStatus('active');
      callbacksRef.current.onClearFocus();
    }
  }

  /**
   * 11/10 结束复盘：只切状态，不动 freeReplay/paper/Focus/图表数组 —— 现场
   * 原样冻结。历史行同步改状态但不改 updatedAt/排序，避免 trailing PUT 未返回
   * 时旧行把过期状态灌回来。
   */
  function endReview(): void {
    if (!freeReplay || reviewStatus === 'ended') return;
    applyReviewStatus('ended');
  }

  /** 11/10 恢复复盘：同 endReview，只切状态；不揭示新 K 线、不自动成交。 */
  function resumeReview(): void {
    if (!freeReplay || reviewStatus === 'active') return;
    applyReviewStatus('active');
  }

  function applyReviewStatus(next: FreeReplayReviewStatus): void {
    const current = freeReplay;
    if (!current) return;
    invalidateReveal();
    setReviewStatus(next);
    setSessions((rows) => rows.map((row) => (
      row.instrument === current.instrument && row.startTime === current.startTime
        ? { ...row, reviewStatus: next }
        : row
    )));
  }

  function revealNext(): void {
    if (!freeReplay || reviewStatus === 'ended' || activeRevealOperationRef.current !== null) return;
    invalidateReveal();
    const nextReplay = nextFreeReplayProgress(cursorCandles, freeReplay.cursorTime, freeReplay.progressTime, timeframe);
    if (nextReplay.cursorTime === freeReplay.cursorTime) {
      callbacksRef.current.onClearFocus();
      callbacksRef.current.onFutureRetry();
      return;
    }
    const revealedCandle = currentCursorCandle(cursorCandles, nextReplay.cursorTime);
    if (revealedCandle && hasAutomaticOrders(paperTrading) && needsPartialExecution(revealedCandle, freeReplay.progressTime)) {
      revealPartial(freeReplay, nextReplay);
      return;
    }
    const nextPaper = revealedCandle
      ? processRevealedCandle(paperTrading, revealedCandle, nextReplay.progressTime)
      : paperTrading;
    commitReveal(freeReplay, nextReplay, nextPaper);
  }

  function rewind(): void {
    // 11/10：结束后回退同样冻结（与模拟交易锁叠加，两者都只锁游标不清焦点）。
    if (!freeReplay || reviewStatus === 'ended') return;
    // A pending coarse transition has not committed; rewind simply cancels it.
    if (activeRevealOperationRef.current !== null) {
      invalidateReveal();
      return;
    }
    if (paperTrading.active) return;
    invalidateReveal();
    callbacksRef.current.onClearFocus();
    const progressTime = Math.max(previousFreeReplayProgress(freeReplay.cursorTime), freeReplay.startProgressTime);
    setFreeReplay({
      ...freeReplay,
      progressTime,
      cursorTime: freeReplayCursorTimeForProgress(progressTime, timeframe, replayCandleGrid(freeReplay)),
    });
  }

  function switchTimeframe(nextTimeframe: ReviewTimeframe): void {
    invalidateReveal();
    setTimeframe(nextTimeframe);
    // 11/26：active / ended 都保留当前焦点单。同一 token 配上新的 rangeKey，
    // 图表会重新获取目标周期的开仓点窗口并定位；剪刀隐藏态也随 Focus 保留。
    // 没有 Focus 时仍走普通 Cursor 初始化与右缘定位。
    setFreeReplay((current) => current ? {
      ...current,
      dataAnchorTime: new Date(current.progressTime * 1000).toISOString(),
      startCursorTime: freeReplayCursorTimeForStart(current.startTime, nextTimeframe, replayCandleGrid(current)),
      cursorTime: freeReplayCursorTimeForTimeframeSwitch(current.progressTime, nextTimeframe, replayCandleGrid(current)),
    } : current);
  }

  // 11/10：冻结态下 App 的任何 Paper Trading 更新都是 no-op —— 守卫在命令入口
  // 而非散在各个回调里，未来新增的交易命令同样被覆盖。
  const setPaperTrading: Dispatch<SetStateAction<PaperTradingSession>> = (action) => {
    if (reviewStatus === 'ended') return;
    invalidateReveal();
    setPaperTradingState(action);
  };

  return {
    freeReplay,
    paperTrading,
    setPaperTrading,
    reviewStatus,
    endReview,
    resumeReview,
    revealPending,
    executionError,
    timeframe,
    setTimeframe,
    sessions,
    start,
    restore,
    remove,
    revealNext,
    rewind,
    switchTimeframe,
  };
}
