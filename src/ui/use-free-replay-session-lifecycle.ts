import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { Candlestick } from '../domain/candlestick';
import type { ReviewTimeframe } from '../domain/trade';
import type { FreeReplaySession, FreeReplaySessionPayload, FreeReplayStart } from '../domain/free-replay-session';
import { freeReplayCursorTimeForProgress, freeReplayCursorTimeForStart, freeReplayCursorTimeForTimeframeSwitch } from './chart-time';
import { LEGACY_REPLAY_CANDLE_SOURCE, nextFreeReplayProgress, previousFreeReplayProgress, replayCandleGrid } from './free-replay-chart';
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
  /** Existing Paper Trading commands keep their functional state updates. */
  setPaperTrading: Dispatch<SetStateAction<PaperTradingSession>>;
  timeframe: ReviewTimeframe;
  /** Trade Review uses the shared timeframe without Replay cursor remapping. */
  setTimeframe: Dispatch<SetStateAction<ReviewTimeframe>>;
  sessions: FreeReplaySession[];
  start: (next: FreeReplayStart) => void;
  restore: (payload: FreeReplaySessionPayload) => void;
  remove: (instrument: string, startTime: string) => Promise<void>;
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
  const [paperTrading, setPaperTrading] = useState<PaperTradingSession>(() => initialPaperTradingSession());
  const [timeframe, setTimeframe] = useState<ReviewTimeframe>('5m');
  const [sessions, setSessions] = useState<FreeReplaySession[]>([]);
  const pendingSaveRef = useRef<FreeReplaySessionPayload | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const deletedSessionKeysRef = useRef<Set<string>>(new Set());
  const callbacksRef = useRef<LifecycleCallbacks>({ onFutureRetry, onResetView, onClearFocus, onSessionDeleted });
  callbacksRef.current = { onFutureRetry, onResetView, onClearFocus, onSessionDeleted };

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
  }, [freeReplay, paperTrading, timeframe, active]);

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

  function restore(payload: FreeReplaySessionPayload): void {
    // Do not drop the outgoing Session's final reveal/trading action.
    flushPendingSave();
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
    setPaperTrading(normalizePaperTradingSession(payload.paperTrading));
    callbacksRef.current.onResetView();
  }

  function start(next: FreeReplayStart): void {
    const existing = sessions.find((session) => session.instrument === next.instrument && session.startTime === next.startTime);
    if (existing) {
      restore(existing);
      return;
    }
    deletedSessionKeysRef.current.delete(sessionKey(next.instrument, next.startTime));
    setFreeReplay(next);
    setPaperTrading(initialPaperTradingSession());
    callbacksRef.current.onResetView();
  }

  async function remove(instrument: string, startTime: string): Promise<void> {
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
      setPaperTrading(initialPaperTradingSession());
      callbacksRef.current.onClearFocus();
    }
  }

  function revealNext(): void {
    if (!freeReplay) return;
    callbacksRef.current.onClearFocus();
    const nextReplay = nextFreeReplayProgress(cursorCandles, freeReplay.cursorTime, freeReplay.progressTime, timeframe);
    if (nextReplay.cursorTime !== freeReplay.cursorTime) {
      const revealedCandle = currentCursorCandle(cursorCandles, nextReplay.cursorTime);
      if (revealedCandle) setPaperTrading((current) => processRevealedCandle(current, revealedCandle, nextReplay.progressTime));
    } else {
      callbacksRef.current.onFutureRetry();
    }
    setFreeReplay({ ...freeReplay, ...nextReplay });
  }

  function rewind(): void {
    if (!freeReplay || paperTrading.active) return;
    callbacksRef.current.onClearFocus();
    const progressTime = Math.max(previousFreeReplayProgress(freeReplay.cursorTime), freeReplay.startProgressTime);
    setFreeReplay({
      ...freeReplay,
      progressTime,
      cursorTime: freeReplayCursorTimeForProgress(progressTime, timeframe, replayCandleGrid(freeReplay)),
    });
  }

  function switchTimeframe(nextTimeframe: ReviewTimeframe): void {
    setTimeframe(nextTimeframe);
    callbacksRef.current.onClearFocus();
    setFreeReplay((current) => current ? {
      ...current,
      dataAnchorTime: new Date(current.progressTime * 1000).toISOString(),
      startCursorTime: freeReplayCursorTimeForStart(current.startTime, nextTimeframe, replayCandleGrid(current)),
      cursorTime: freeReplayCursorTimeForTimeframeSwitch(current.progressTime, nextTimeframe, replayCandleGrid(current)),
    } : current);
  }

  return {
    freeReplay,
    paperTrading,
    setPaperTrading,
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
