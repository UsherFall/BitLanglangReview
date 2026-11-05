import { describe, expect, it, vi } from 'vitest';
import type { Candlestick } from '../src/domain/candlestick';
import type { ReviewTimeframe } from '../src/domain/trade';
import { ServerCandleError } from '../src/ui/candle-fetch';
import {
  FreeReplayDataset,
  type FreeReplayDatasetRangeInput,
  type FreeReplayDatasetSnapshot,
} from '../src/ui/free-replay-dataset';

type PendingRequest = {
  params: URLSearchParams;
  resolve: (candles: Candlestick[]) => void;
  reject: (error: unknown) => void;
};

/** Deferred fake Candle Loader: the test resolves/rejects each request by hand. */
function deferredLoader() {
  const requests: PendingRequest[] = [];
  const loader = (params: URLSearchParams) =>
    new Promise<Candlestick[]>((resolve, reject) => {
      requests.push({ params, resolve, reject });
    });
  return { loader, requests };
}

const BASE_MS = Date.parse('2024-05-21T02:00:00.000Z');
const STEP_MS = 5 * 60_000;

function candle(index: number, close = 100): Candlestick {
  return {
    instrument: 'BTCUSDT',
    timeframe: '5m',
    timestamp: BASE_MS + index * STEP_MS,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1,
  };
}

function series(from: number, count: number, close = 100): Candlestick[] {
  return Array.from({ length: count }, (_, offset) => candle(from + offset, close + offset));
}

function rangeInput(overrides: Partial<FreeReplayDatasetRangeInput> = {}): FreeReplayDatasetRangeInput {
  return {
    rangeKey: 'BTCUSDT:2024-05-21 10:00:5m:bitget',
    instrument: 'BTCUSDT',
    timeframe: '5m' as ReviewTimeframe,
    startTime: '2024-05-21 10:00',
    dataAnchorTime: '2024-05-21T02:00:00.000Z',
    requestSource: 'bitget',
    ...overrides,
  };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function param(request: PendingRequest, key: string): string | null {
  return request.params.get(key);
}

describe('FreeReplayDataset', () => {
  it('publishes the initial Cursor window as Cursor, Active and Rendered', async () => {
    const { loader, requests } = deferredLoader();
    const dataset = new FreeReplayDataset(loader);
    const events: FreeReplayDatasetSnapshot[] = [];
    dataset.subscribe((snapshot) => events.push(snapshot));

    const loading = dataset.syncRange(rangeInput());
    expect(requests).toHaveLength(1);
    expect(param(requests[0], 'mode')).toBe('initial');
    expect(param(requests[0], 'entryTime')).toBe('2024-05-21T02:00:00.000Z');
    expect(param(requests[0], 'instrument')).toBe('BTCUSDT');
    expect(param(requests[0], 'timeframe')).toBe('5m');
    expect(param(requests[0], 'source')).toBe('bitget');

    const candles = series(0, 3);
    requests[0].resolve(candles);
    await loading;

    const snapshot = dataset.getSnapshot();
    expect(snapshot.cursorCandles).toEqual(candles);
    expect(snapshot.activeCandles).toBe(snapshot.cursorCandles);
    expect(snapshot.renderedCandles).toBe(snapshot.cursorCandles);
    expect(snapshot.renderedRangeKey).toBe(rangeInput().rangeKey);
    expect(snapshot.status).toBe('');
    expect(events.length).toBeGreaterThan(0);
  });

  it('discards a stale range initial success, error and empty response', async () => {
    const { loader, requests } = deferredLoader();
    const dataset = new FreeReplayDataset(loader);

    void dataset.syncRange(rangeInput({ rangeKey: 'A' }));
    void dataset.syncRange(rangeInput({ rangeKey: 'B', dataAnchorTime: '2024-05-21T03:00:00.000Z' }));
    expect(requests).toHaveLength(2);

    const bCandles = series(10, 2, 200);
    requests[1].resolve(bCandles);
    await flush();
    const afterB = dataset.getSnapshot();
    expect(afterB.cursorCandles).toEqual(bCandles);
    expect(afterB.renderedRangeKey).toBe('B');

    // A's late success must not alter B.
    requests[0].resolve(series(20, 5, 300));
    await flush();
    expect(dataset.getSnapshot()).toBe(afterB);

    // A's late SAME-generation error path is covered by focus tests; here the
    // generation guard must also ignore an empty A response.
    const { loader: loader2, requests: requests2 } = deferredLoader();
    const dataset2 = new FreeReplayDataset(loader2);
    void dataset2.syncRange(rangeInput({ rangeKey: 'A' }));
    void dataset2.syncRange(rangeInput({ rangeKey: 'B' }));
    requests2[1].resolve(series(10, 1, 200));
    await flush();
    const stable = dataset2.getSnapshot();
    requests2[0].resolve([]);
    await flush();
    expect(dataset2.getSnapshot()).toBe(stable);
    expect(stable.status).toBe('');
  });

  it('routes a stale range initial error away from the current status', async () => {
    const { loader, requests } = deferredLoader();
    const dataset = new FreeReplayDataset(loader);

    void dataset.syncRange(rangeInput({ rangeKey: 'A' }));
    void dataset.syncRange(rangeInput({ rangeKey: 'B' }));
    requests[1].resolve(series(0, 2));
    await flush();
    requests[0].reject(new ServerCandleError('A failed'));
    await flush();

    expect(dataset.getSnapshot().status).toBe('');
  });

  it('only installs the current focusKey when Focus A and B overlap in one range', async () => {
    const { loader, requests } = deferredLoader();
    const dataset = new FreeReplayDataset(loader);

    void dataset.syncRange(rangeInput());
    const cursor = series(0, 3, 100);
    requests[0].resolve(cursor);
    await flush();

    void dataset.syncFocus({ timeMs: BASE_MS + STEP_MS * 10, token: 1 });
    expect(requests).toHaveLength(2);
    void dataset.syncFocus({ timeMs: BASE_MS - STEP_MS * 10, token: 2 });
    expect(requests).toHaveLength(3);
    const focusKeyB = dataset.getSnapshot().focusKey;

    const focusB = series(5, 2, 500);
    requests[2].resolve(focusB);
    await flush();
    const installed = dataset.getSnapshot();
    expect(installed.focusKey).toBe(focusKeyB);
    expect(installed.focusSettled).toBe('installed');
    expect(installed.activeCandles).toEqual(focusB);
    expect(installed.cursorCandles).toEqual(cursor);
    // Focus never merges with Cursor.
    expect(installed.activeCandles).not.toEqual(cursor);

    // A's late success must not overwrite B.
    requests[1].resolve(series(30, 4, 900));
    await flush();
    expect(dataset.getSnapshot()).toBe(installed);

    // A's late failure must not replace B's status either.
    const { loader: loader2, requests: requests2 } = deferredLoader();
    const dataset2 = new FreeReplayDataset(loader2);
    void dataset2.syncRange(rangeInput());
    requests2[0].resolve(series(0, 2));
    await flush();
    void dataset2.syncFocus({ timeMs: BASE_MS, token: 1 });
    void dataset2.syncFocus({ timeMs: BASE_MS + STEP_MS, token: 2 });
    requests2[2].resolve(series(5, 2, 500));
    await flush();
    const stable = dataset2.getSnapshot();
    requests2[1].reject(new ServerCandleError('A failed'));
    await flush();
    expect(dataset2.getSnapshot()).toBe(stable);
  });

  it('restores the matching Cursor without a request and reloads a mismatched one once', async () => {
    const { loader, requests } = deferredLoader();
    const dataset = new FreeReplayDataset(loader);

    void dataset.syncRange(rangeInput());
    const cursor = series(0, 3);
    requests[0].resolve(cursor);
    await flush();
    const cursorSnapshot = dataset.getSnapshot().activeCandles;

    void dataset.syncFocus({ timeMs: BASE_MS, token: 1 });
    requests[1].resolve(series(10, 2, 500));
    await flush();
    expect(dataset.getSnapshot().focusActive).toBe(true);

    void dataset.syncFocus(null);
    await flush();
    const restored = dataset.getSnapshot();
    expect(restored.focusActive).toBe(false);
    expect(restored.activeCandles).toBe(cursorSnapshot);
    expect(restored.renderedCandles).toBe(cursorSnapshot);
    // No new request: the Cursor window already belongs to this range.
    expect(requests).toHaveLength(2);

    // A Cursor that belongs to another range triggers the shared initial load,
    // and a concurrent range sync shares that same in-flight request.
    const { loader: loader2, requests: requests2 } = deferredLoader();
    const dataset2 = new FreeReplayDataset(loader2);
    void dataset2.syncRange(rangeInput({ rangeKey: 'A' }));
    requests2[0].resolve(series(0, 2));
    await flush();
    void dataset2.syncFocus({ timeMs: BASE_MS, token: 1 });
    requests2[1].resolve(series(10, 2, 500));
    await flush();
    // New range while focused: the focus exit must reload for B.
    void dataset2.syncRange(rangeInput({ rangeKey: 'B' }));
    void dataset2.syncFocus(null);
    expect(requests2).toHaveLength(3);
    requests2[2].resolve(series(0, 1, 700));
    await flush();
    const reloaded = dataset2.getSnapshot();
    expect(reloaded.focusActive).toBe(false);
    expect(reloaded.renderedRangeKey).toBe('B');
  });

  it('captures the Earlier/Later owner at invocation', async () => {
    const { loader, requests } = deferredLoader();
    const dataset = new FreeReplayDataset(loader);

    void dataset.syncRange(rangeInput());
    const cursor = series(10, 3);
    requests[0].resolve(cursor);
    await flush();

    // Start an Earlier while Cursor is active…
    void dataset.loadEarlier();
    const earlierRequest = requests[1];
    expect(param(earlierRequest, 'mode')).toBe('earlier');
    expect(param(earlierRequest, 'anchor')).toBe(String(cursor[0].timestamp));

    // …then enter Focus before it lands. The response belongs to Cursor, so it
    // must feed App Cursor only and never replace the Focus rendering.
    void dataset.syncFocus({ timeMs: BASE_MS, token: 1 });
    const focus = series(40, 2, 500);
    requests[2].resolve(focus);
    await flush();
    earlierRequest.resolve(series(0, 2, 50));
    await flush();

    const snapshot = dataset.getSnapshot();
    expect(snapshot.cursorCandles[0].timestamp).toBe(BASE_MS);
    expect(snapshot.activeCandles).toEqual(focus);
    expect(snapshot.renderedCandles).toEqual(focus);
  });

  it('discards page/prefetch/gap responses from an older range', async () => {
    const { loader, requests } = deferredLoader();
    const dataset = new FreeReplayDataset(loader);

    void dataset.syncRange(rangeInput({ rangeKey: 'A' }));
    requests[0].resolve(series(10, 3));
    await flush();

    void dataset.loadEarlier();
    void dataset.loadLater();
    void dataset.healGap({ from: BASE_MS, to: BASE_MS + STEP_MS });
    void dataset.prefetchFuture(BASE_MS / 1000 + 3600);
    expect(requests).toHaveLength(5);

    void dataset.syncRange(rangeInput({ rangeKey: 'B', timeframe: '15m' }));
    expect(requests).toHaveLength(6);
    const bCandles = series(0, 2, 800);
    requests[5].resolve(bCandles);
    await flush();
    const afterB = dataset.getSnapshot();

    requests[1].resolve(series(0, 1, 900));
    requests[2].resolve(series(1, 1, 910));
    requests[3].resolve(series(2, 1, 920));
    requests[4].resolve(series(3, 1, 930));
    await flush();
    expect(dataset.getSnapshot()).toBe(afterB);
    expect(afterB.renderedRangeKey).toBe('B');
  });

  it('keeps prefetched candles loaded but not rendered until Cursor sync, and retries a failure', async () => {
    const { loader, requests } = deferredLoader();
    const dataset = new FreeReplayDataset(loader);

    void dataset.syncRange(rangeInput());
    const cursor = series(0, 2);
    requests[0].resolve(cursor);
    await flush();
    const rendered = dataset.getSnapshot().renderedCandles;

    void dataset.prefetchFuture(BASE_MS / 1000 + STEP_MS / 1000 * 30);
    expect(requests).toHaveLength(2);
    expect(param(requests[1], 'mode')).toBe('later');
    expect(param(requests[1], 'anchor')).toBe(String(cursor[1].timestamp));
    requests[1].resolve(series(2, 2, 700));
    await flush();

    const prefetched = dataset.getSnapshot();
    expect(prefetched.cursorCandles).toHaveLength(4);
    expect(prefetched.renderedCandles).toBe(rendered);
    expect(prefetched.pendingRender).toBe(false);

    dataset.syncCursor(BASE_MS / 1000);
    expect(dataset.getSnapshot().renderedCandles).toEqual(prefetched.cursorCandles);

    // A failed prefetch releases the anchor guard so the next trigger retries.
    const { loader: loader2, requests: requests2 } = deferredLoader();
    const dataset2 = new FreeReplayDataset(loader2);
    void dataset2.syncRange(rangeInput());
    requests2[0].resolve(series(0, 2));
    await flush();
    void dataset2.prefetchFuture(BASE_MS / 1000 + 3600);
    requests2[1].reject(new Error('network'));
    await flush();
    expect(dataset2.getSnapshot().status).toBe('后续 K 线加载失败');
    void dataset2.prefetchFuture(BASE_MS / 1000 + 3600);
    expect(requests2).toHaveLength(3);
  });

  it('defers append-type publications while the pointer is down and flushes once', async () => {
    const { loader, requests } = deferredLoader();
    const dataset = new FreeReplayDataset(loader);

    void dataset.syncRange(rangeInput());
    requests[0].resolve(series(0, 3));
    await flush();
    const initialRendered = dataset.getSnapshot().renderedCandles;

    dataset.setPointerDown(true);
    void dataset.loadLater();
    requests[1].resolve(series(3, 2, 300));
    await flush();

    const duringDrag = dataset.getSnapshot();
    expect(duringDrag.activeCandles).toHaveLength(5);
    expect(duringDrag.renderedCandles).toBe(initialRendered);
    expect(duringDrag.pendingRender).toBe(true);

    dataset.flushDeferredRender();
    dataset.flushDeferredRender();
    const flushed = dataset.getSnapshot();
    expect(flushed.renderedCandles).toEqual(duringDrag.activeCandles);
    expect(flushed.pendingRender).toBe(false);
    expect(flushed.renderedRangeKey).toBe(rangeInput().rangeKey);

    // Non-drag gap healing publishes immediately.
    dataset.setPointerDown(false);
    void dataset.healGap({ from: BASE_MS, to: BASE_MS + STEP_MS * 5 });
    expect(requests).toHaveLength(3);
    expect(param(requests[2], 'mode')).toBe('initial');
    expect(param(requests[2], 'entryTime')).toBe(new Date(BASE_MS + STEP_MS * 2.5).toISOString());
    requests[2].resolve(series(1, 1, 999));
    await flush();
    expect(dataset.getSnapshot().renderedCandles).toEqual(dataset.getSnapshot().activeCandles);
    expect(dataset.getSnapshot().pendingRender).toBe(false);
  });

  it('settles an empty or failed Focus without replacing the Cursor window', async () => {
    const { loader, requests } = deferredLoader();
    const dataset = new FreeReplayDataset(loader);

    void dataset.syncRange(rangeInput());
    const cursor = series(0, 2);
    requests[0].resolve(cursor);
    await flush();
    const cursorSnapshot = dataset.getSnapshot().activeCandles;

    void dataset.syncFocus({ timeMs: BASE_MS, token: 1 });
    requests[1].resolve([]);
    await flush();
    const empty = dataset.getSnapshot();
    expect(empty.focusSettled).toBe('failed');
    expect(empty.status).toBe('');
    expect(empty.activeCandles).toBe(cursorSnapshot);
    expect(empty.renderedCandles).toBe(cursorSnapshot);

    void dataset.syncFocus({ timeMs: BASE_MS, token: 2 });
    requests[2].reject(new ServerCandleError('focus failed'));
    await flush();
    const failed = dataset.getSnapshot();
    expect(failed.focusSettled).toBe('failed');
    expect(failed.status).toBe('focus failed');
    expect(failed.activeCandles).toBe(cursorSnapshot);
  });

  it('ignores every completion after disposal', async () => {
    const { loader, requests } = deferredLoader();
    const dataset = new FreeReplayDataset(loader);
    const listener = vi.fn();
    dataset.subscribe(listener);

    void dataset.syncRange(rangeInput());
    void dataset.loadLater();
    dataset.dispose();
    const disposed = dataset.getSnapshot();
    listener.mockClear();

    requests[0].resolve(series(0, 2));
    requests[1]?.resolve(series(2, 2, 300));
    await flush();

    expect(listener).not.toHaveBeenCalled();
    expect(dataset.getSnapshot()).toBe(disposed);
  });

  it('preserves the request matrix for initial, focus, earlier, later, prefetch and gap', async () => {
    const { loader, requests } = deferredLoader();
    const dataset = new FreeReplayDataset(loader);

    void dataset.syncRange(rangeInput({ requestSource: 'binance-only', instrument: 'BTCUSDT' }));
    requests[0].resolve(series(0, 4));
    await flush();

    void dataset.loadEarlier();
    void dataset.loadLater();
    void dataset.prefetchFuture(BASE_MS / 1000 + 3600);
    void dataset.syncFocus({ timeMs: BASE_MS + STEP_MS * 12, token: 7 });

    void dataset.healGap({ from: BASE_MS, to: BASE_MS + STEP_MS });

    const byMode = requests.slice(1).map((request) => ({
      mode: param(request, 'mode'),
      entryTime: param(request, 'entryTime'),
      anchor: param(request, 'anchor'),
      instrument: param(request, 'instrument'),
      timeframe: param(request, 'timeframe'),
      source: param(request, 'source'),
    }));

    expect(byMode).toContainEqual({
      mode: 'earlier',
      entryTime: '2024-05-21 10:00',
      anchor: String(series(0, 1)[0].timestamp),
      instrument: 'BTCUSDT',
      timeframe: '5m',
      source: 'binance-only',
    });
    expect(byMode).toContainEqual({
      mode: 'later',
      entryTime: '2024-05-21 10:00',
      anchor: String(series(0, 4)[3].timestamp),
      instrument: 'BTCUSDT',
      timeframe: '5m',
      source: 'binance-only',
    });
    expect(byMode).toContainEqual({
      mode: 'initial',
      entryTime: new Date(BASE_MS + STEP_MS * 12).toISOString(),
      anchor: null,
      instrument: 'BTCUSDT',
      timeframe: '5m',
      source: 'binance-only',
    });
    expect(byMode).toContainEqual({
      mode: 'initial',
      entryTime: new Date(BASE_MS + STEP_MS / 2).toISOString(),
      anchor: null,
      instrument: 'BTCUSDT',
      timeframe: '5m',
      source: 'binance-only',
    });
  });

  it('keeps the snapshot object stable between transitions and notifies only on change', async () => {
    const { loader, requests } = deferredLoader();
    const dataset = new FreeReplayDataset(loader);
    const listener = vi.fn();
    dataset.subscribe(listener);

    const first = dataset.getSnapshot();
    expect(dataset.getSnapshot()).toBe(first);

    void dataset.syncRange(rangeInput());
    const second = dataset.getSnapshot();
    expect(second).not.toBe(first);
    expect(listener).toHaveBeenCalledTimes(1);

    // Repeating getSnapshot without a transition stays cached.
    expect(dataset.getSnapshot()).toBe(second);
    expect(listener).toHaveBeenCalledTimes(1);

    requests[0].resolve(series(0, 2));
    await flush();
    const third = dataset.getSnapshot();
    expect(third).not.toBe(second);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
