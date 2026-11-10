// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Candlestick } from '../src/domain/candlestick';
import type { FreeReplaySession, FreeReplaySessionPayload, FreeReplayStart } from '../src/ui/FreeReplayPanel';
import { initialPaperTradingSession, placeEntryLimit, startPaperTrading } from '../src/ui/free-replay-paper-trading';
import {
  useFreeReplaySessionLifecycle,
  type FreeReplaySessionLifecycleOptions,
} from '../src/ui/use-free-replay-session-lifecycle';

const START_MS = Date.parse('2024-05-21T09:55:00+08:00');
const START = START_MS / 1000;

function makeStart(overrides: Partial<FreeReplayStart> = {}): FreeReplayStart {
  return {
    instrument: 'BTCUSDT',
    startTime: '2024-05-21 10:00',
    dataAnchorTime: '2024-05-21 10:00',
    startCursorTime: START,
    startProgressTime: START,
    progressTime: START,
    cursorTime: START,
    candleSource: 'bitget',
    ...overrides,
  };
}

function makeSession(overrides: Partial<FreeReplaySession> = {}): FreeReplaySession {
  return {
    ...makeStart(),
    dataAnchorTime: '2024-05-21 10:00',
    startProgressTime: START,
    progressTime: START + 600,
    cursorTime: START + 300,
    timeframe: '15m',
    paperTrading: {
      ...initialPaperTradingSession(),
      active: true,
      startedAtCursorTime: START,
      nextId: 8,
    },
    reviewStatus: 'active',
    updatedAt: '2024-05-21T12:00:00+08:00',
    ...overrides,
  };
}

function makeCandle(iso: string): Candlestick {
  return {
    instrument: 'BTCUSDT',
    timeframe: '5m',
    timestamp: Date.parse(iso),
    open: 100,
    high: 110,
    low: 90,
    close: 105,
    volume: 1,
  };
}

type FetchMock = Mock<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>;

function putCalls(fetchMock: FetchMock) {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT');
}

function putBodies(fetchMock: FetchMock): FreeReplaySessionPayload[] {
  return putCalls(fetchMock).map(([, init]) => JSON.parse(String(init?.body)) as FreeReplaySessionPayload);
}

function stubSessionFetch(sessions: FreeReplaySession[] = []): FetchMock {
  const fetchMock: FetchMock = vi.fn(async (input, init) => {
    const url = String(input);
    if (!url.startsWith('/api/free-replay/sessions')) throw new Error(`Unexpected fetch: ${url}`);
    if (init?.method === 'PUT') {
      const payload = JSON.parse(String(init.body)) as FreeReplaySessionPayload;
      return Response.json({ ...payload, updatedAt: '2024-05-21T12:00:00+08:00' });
    }
    if (init?.method === 'DELETE') return Response.json({ ok: true });
    return Response.json({ sessions });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function setup(options: { sessions?: FreeReplaySession[]; cursorCandles?: Candlestick[] } = {}) {
  const fetchMock = stubSessionFetch(options.sessions ?? []);
  const callbacks = {
    onFutureRetry: vi.fn(),
    onResetView: vi.fn(),
    onClearFocus: vi.fn(),
    onSessionDeleted: vi.fn(),
  };
  const initialProps: FreeReplaySessionLifecycleOptions = {
    active: true,
    cursorCandles: options.cursorCandles ?? [],
    ...callbacks,
  };
  const view = renderHook((props: FreeReplaySessionLifecycleOptions) => useFreeReplaySessionLifecycle(props), { initialProps });
  return { ...view, fetchMock, callbacks, initialProps };
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('useFreeReplaySessionLifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('loads history and restores the saved cursor, timeframe, source and Paper Trading state', async () => {
    const saved = makeSession({ candleSource: 'okx' });
    const { result, callbacks } = setup({ sessions: [saved] });
    await settle();
    expect(result.current.sessions).toEqual([saved]);

    act(() => result.current.restore(saved));

    expect(result.current.freeReplay).toMatchObject({
      instrument: saved.instrument,
      candleSource: 'okx',
      cursorTime: saved.cursorTime,
      progressTime: saved.progressTime,
      dataAnchorTime: new Date(saved.cursorTime * 1000).toISOString(),
    });
    expect(result.current.timeframe).toBe('15m');
    expect(result.current.paperTrading).toMatchObject({ active: true, startedAtCursorTime: START, nextId: 8 });
    expect(callbacks.onResetView).toHaveBeenCalledTimes(1);
  });

  it('resumes an existing start key and resets Paper Trading for a fresh start', async () => {
    const saved = makeSession();
    const { result, callbacks } = setup({ sessions: [saved] });
    await settle();

    act(() => result.current.start(makeStart({ cursorTime: START - 300 })));
    expect(result.current.freeReplay?.cursorTime).toBe(saved.cursorTime);
    expect(result.current.timeframe).toBe('15m');
    expect(result.current.paperTrading.active).toBe(true);

    const fresh = makeStart({ startTime: '2024-05-22 10:00', dataAnchorTime: '2024-05-22 10:00' });
    act(() => result.current.start(fresh));
    expect(result.current.freeReplay).toEqual(fresh);
    expect(result.current.paperTrading.active).toBe(false);
    expect(callbacks.onResetView).toHaveBeenCalledTimes(2);
  });

  it('writes the full trailing auto-save payload after 500ms', async () => {
    const { result, fetchMock } = setup();
    act(() => result.current.start(makeStart()));

    await advance(499);
    expect(putCalls(fetchMock)).toHaveLength(0);
    await advance(1);

    expect(putBodies(fetchMock)).toHaveLength(1);
    expect(putBodies(fetchMock)[0]).toMatchObject({
      instrument: 'BTCUSDT',
      candleSource: 'bitget',
      startTime: '2024-05-21 10:00',
      cursorTime: START,
      progressTime: START,
      timeframe: '5m',
      paperTrading: { active: false },
      reviewStatus: 'active',
    });
  });

  it('flushes pending saves on mode exit and pagehide without dropping keepalive', async () => {
    const first = setup();
    act(() => first.result.current.start(makeStart()));
    act(() => first.result.current.endReview());
    first.rerender({ ...first.initialProps, active: false });
    await settle();
    expect(putBodies(first.fetchMock)).toHaveLength(1);
    expect(putBodies(first.fetchMock)[0]?.reviewStatus).toBe('ended');
    expect(putCalls(first.fetchMock)[0]?.[1]?.keepalive).not.toBe(true);

    const second = setup();
    act(() => second.result.current.start(makeStart()));
    act(() => second.result.current.endReview());
    act(() => window.dispatchEvent(new Event('pagehide')));
    expect(putCalls(second.fetchMock)).toHaveLength(1);
    expect(putBodies(second.fetchMock)[0]?.reviewStatus).toBe('ended');
    expect(putCalls(second.fetchMock)[0]?.[1]?.keepalive).toBe(true);
  });

  it('flushes the outgoing pending session before restoring another one', async () => {
    const saved = makeSession({ instrument: 'ETHUSDT' });
    const { result, fetchMock } = setup({ sessions: [saved] });
    await settle();
    act(() => result.current.start(makeStart()));

    act(() => result.current.restore(saved));

    expect(putBodies(fetchMock)).toHaveLength(1);
    expect(putBodies(fetchMock)[0]?.instrument).toBe('BTCUSDT');
    expect(result.current.freeReplay?.instrument).toBe('ETHUSDT');
  });

  it('does not resurrect a deleted session from stale PUT and permits a fresh recreate', async () => {
    const saved = makeSession();
    const pendingPuts: Array<{ body: FreeReplaySessionPayload; resolve: () => void }> = [];
    const fetchMock: FetchMock = vi.fn(async (input, init) => {
      const url = String(input);
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as FreeReplaySessionPayload;
        return new Promise<Response>((resolve) => {
          pendingPuts.push({
            body,
            resolve: () => resolve(Response.json({ ...body, updatedAt: '2024-05-21T12:00:00+08:00' })),
          });
        });
      }
      if (init?.method === 'DELETE') return Response.json({ ok: true });
      return Response.json({ sessions: [saved] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const callbacks = { onFutureRetry: vi.fn(), onResetView: vi.fn(), onClearFocus: vi.fn(), onSessionDeleted: vi.fn() };
    const { result } = renderHook(() => useFreeReplaySessionLifecycle({ active: true, cursorCandles: [], ...callbacks }));
    await settle();

    act(() => result.current.restore(saved));
    await advance(500);
    expect(pendingPuts).toHaveLength(1);

    await act(async () => {
      await result.current.remove(saved.instrument, saved.startTime);
    });
    expect(result.current.freeReplay).toBeNull();
    expect(result.current.sessions).toEqual([]);
    expect(callbacks.onSessionDeleted).toHaveBeenCalledWith(saved.instrument, saved.startTime);

    await act(async () => {
      pendingPuts[0]?.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.sessions).toEqual([]);

    act(() => result.current.start(makeStart()));
    await advance(500);
    expect(pendingPuts).toHaveLength(2);
    await act(async () => {
      pendingPuts[1]?.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.sessions.map((session) => session.instrument)).toEqual(['BTCUSDT']);
  });

  it('reveals into Paper Trading, retries at the edge, guards rewind and remaps timeframe', async () => {
    const candles = [
      makeCandle('2024-05-21T09:55:00+08:00'),
      makeCandle('2024-05-21T10:00:00+08:00'),
    ];
    const { result, callbacks } = setup({ cursorCandles: candles });
    act(() => result.current.start(makeStart()));
    act(() => {
      result.current.setPaperTrading((current) => placeEntryLimit(
        startPaperTrading(current, START),
        105,
        { direction: 'long', positionRatioPercent: 100, leverage: 1 },
        START,
      ));
    });

    act(() => result.current.revealNext());
    expect(result.current.freeReplay?.cursorTime).toBe(candles[1]!.timestamp / 1000);
    expect(result.current.paperTrading.position).not.toBeNull();
    expect(callbacks.onClearFocus).toHaveBeenCalledTimes(1);

    act(() => result.current.revealNext());
    expect(callbacks.onFutureRetry).toHaveBeenCalledTimes(1);

    const cursorBeforeGuardedRewind = result.current.freeReplay?.cursorTime;
    act(() => result.current.rewind());
    expect(result.current.freeReplay?.cursorTime).toBe(cursorBeforeGuardedRewind);

    act(() => result.current.setPaperTrading(initialPaperTradingSession()));
    act(() => result.current.rewind());
    expect(result.current.freeReplay?.cursorTime).toBe(START);

    const progressBeforeSwitch = result.current.freeReplay?.progressTime;
    act(() => result.current.switchTimeframe('15m'));
    expect(result.current.timeframe).toBe('15m');
    expect(result.current.freeReplay?.dataAnchorTime).toBe(new Date(progressBeforeSwitch! * 1000).toISOString());
  });

  it('freezes Paper updates and cursor commands without changing the scene, then resumes in place', async () => {
    const saved = makeSession();
    const candles = [
      makeCandle('2024-05-21T09:55:00+08:00'),
      makeCandle('2024-05-21T10:00:00+08:00'),
    ];
    const { result, callbacks } = setup({ sessions: [saved], cursorCandles: candles });
    await settle();
    act(() => result.current.restore(saved));
    const frozenReplay = result.current.freeReplay;
    const frozenPaper = result.current.paperTrading;

    act(() => result.current.endReview());

    expect(result.current.reviewStatus).toBe('ended');
    expect(result.current.freeReplay).toBe(frozenReplay);
    expect(result.current.paperTrading).toBe(frozenPaper);
    expect(result.current.sessions[0]?.reviewStatus).toBe('ended');

    act(() => {
      result.current.setPaperTrading(initialPaperTradingSession());
      result.current.setPaperTrading((current) => ({ ...current, nextId: 999 }));
      result.current.revealNext();
      result.current.rewind();
    });
    expect(result.current.freeReplay).toBe(frozenReplay);
    expect(result.current.paperTrading).toBe(frozenPaper);
    expect(callbacks.onClearFocus).not.toHaveBeenCalled();
    expect(callbacks.onFutureRetry).not.toHaveBeenCalled();

    const progressBeforeSwitch = result.current.freeReplay?.progressTime;
    act(() => result.current.switchTimeframe('1H'));
    expect(result.current.freeReplay?.progressTime).toBe(progressBeforeSwitch);
    expect(result.current.paperTrading).toBe(frozenPaper);
    expect(callbacks.onClearFocus).toHaveBeenCalledTimes(1);

    act(() => result.current.resumeReview());
    expect(result.current.reviewStatus).toBe('active');
    expect(result.current.paperTrading).toBe(frozenPaper);
    act(() => result.current.setPaperTrading((current) => ({ ...current, nextId: 999 })));
    expect(result.current.paperTrading.nextId).toBe(999);
  });

  it('persists ended/active transitions and does not let same-key restores bypass the freeze', async () => {
    const saved = makeSession({ reviewStatus: 'ended' });
    const { result, fetchMock } = setup({ sessions: [saved] });
    await settle();
    act(() => result.current.restore(saved));
    expect(result.current.reviewStatus).toBe('ended');
    const frozenReplay = result.current.freeReplay;
    const frozenPaper = result.current.paperTrading;

    act(() => result.current.restore({
      ...saved,
      reviewStatus: 'active',
      progressTime: saved.progressTime + 3600,
      cursorTime: saved.cursorTime + 3600,
      paperTrading: initialPaperTradingSession(),
    }));
    expect(result.current.reviewStatus).toBe('ended');
    expect(result.current.freeReplay).toBe(frozenReplay);
    expect(result.current.paperTrading).toBe(frozenPaper);
    act(() => result.current.start(makeStart()));
    expect(result.current.reviewStatus).toBe('ended');
    expect(result.current.freeReplay).toBe(frozenReplay);
    expect(result.current.paperTrading).toBe(frozenPaper);

    act(() => result.current.resumeReview());
    expect(result.current.reviewStatus).toBe('active');
    expect(result.current.sessions[0]?.reviewStatus).toBe('active');
    act(() => result.current.restore({ ...saved, reviewStatus: 'ended' }));
    expect(result.current.reviewStatus).toBe('active');

    await advance(500);
    expect(putBodies(fetchMock).at(-1)?.reviewStatus).toBe('active');
    act(() => result.current.endReview());
    await advance(500);
    expect(putBodies(fetchMock).at(-1)?.reviewStatus).toBe('ended');

    const legacy = makeSession({ instrument: 'ETHUSDT', startTime: '2024-05-22 10:00' });
    delete (legacy as Partial<FreeReplaySession>).reviewStatus;
    act(() => result.current.restore(legacy));
    expect(result.current.reviewStatus).toBe('active');
  });

  it('keeps the locally latest ended status when switching sessions before the trailing PUT resolves', async () => {
    const first = makeSession();
    const second = makeSession({ instrument: 'ETHUSDT', startTime: '2024-05-22 10:00' });
    const { result } = setup({ sessions: [first, second] });
    await settle();
    act(() => result.current.restore(first));
    act(() => result.current.endReview());
    expect(result.current.sessions.find((row) => row.instrument === first.instrument)?.reviewStatus).toBe('ended');

    act(() => result.current.restore(second));
    expect(result.current.reviewStatus).toBe('active');
    const latestFirst = result.current.sessions.find((row) => row.instrument === first.instrument)!;
    act(() => result.current.restore(latestFirst));
    expect(result.current.reviewStatus).toBe('ended');
  });
});
