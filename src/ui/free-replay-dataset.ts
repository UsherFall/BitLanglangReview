import type { Candlestick, ChartCandleSource } from '../domain/candlestick';
import type { ReviewTimeframe } from '../domain/trade';
import { fetchCandles, ServerCandleError } from './candle-fetch';
import { mergeCandles, shouldPrefetchFutureCandles } from './free-replay-chart';

/**
 * Loads one `/api/candles` window. Production passes `fetchCandles`; tests pass
 * a deferred fake so response order is controllable.
 */
export type CandleLoader = (params: URLSearchParams) => Promise<Candlestick[]>;

export type FreeReplayDatasetRangeInput = {
  /** Session identity: instrument + start time + timeframe + recorded source. */
  rangeKey: string;
  /** Already translated to the requested source's vocabulary. */
  instrument: string;
  timeframe: ReviewTimeframe;
  /** `replay.startTime`: the `entryTime` of Earlier / Later / Prefetch. */
  startTime: string;
  /** Cursor initial anchor (`replay.dataAnchorTime`). */
  dataAnchorTime: string;
  requestSource: ChartCandleSource;
};

export type FreeReplayDatasetSnapshot = {
  /** The ONLY array App may receive as `freeReplayCandles` (current price, P&L). */
  cursorCandles: Candlestick[];
  /** The loaded owner: Focus while focused, otherwise Cursor. */
  activeCandles: Candlestick[];
  /** The ONLY array the chart renders / publishes as the active dataset. */
  renderedCandles: Candlestick[];
  /** Range identity of `renderedCandles`; the first-anchor guard reads it. */
  renderedRangeKey: string;
  focusActive: boolean;
  /** `rangeKey:token` of the current (or last) Focus request. */
  focusKey: string;
  /** Whether that Focus window installed or failed; `null` while pending. */
  focusSettled: 'installed' | 'failed' | null;
  status: string;
  /** Append-type data arrived during a drag and is not rendered yet. */
  pendingRender: boolean;
  /**
   * Current-generation in-flight flags. The chart keeps its own trigger keys,
   * but must be able to skip consuming a key while the same operation is still
   * in flight (history backfill / gap healing).
   */
  loading: {
    initial: boolean;
    earlier: boolean;
    later: boolean;
    future: boolean;
    window: boolean;
  };
};

type Owner = 'cursor' | 'focus';

/**
 * Owns Free Replay's Cursor / Focus / Active / Rendered datasets and every
 * Candlestick load. Framework-free: no React, DOM, lightweight-charts or
 * Session Store knowledge.
 *
 * Two rules this Module exists to enforce:
 * - Cursor and Focus are separate contiguous windows and never merge.
 * - Every async completion validates the range generation it started in
 *   (Focus additionally validates its focusKey); stale results have no effect.
 */
export class FreeReplayDataset {
  private readonly loader: CandleLoader;
  private readonly listeners = new Set<(snapshot: FreeReplayDatasetSnapshot) => void>();
  private snapshot: FreeReplayDatasetSnapshot;

  private disposed = false;
  /** Monotonic range identity. Bumped by every `syncRange`. */
  private generation = 0;
  private rangeKey = '';
  private instrument = '';
  private timeframe: ReviewTimeframe = '5m';
  private startTime = '';
  private dataAnchorTime = '';
  private requestSource: ChartCandleSource = 'bitget';

  private cursor: Candlestick[] = [];
  private cursorRangeKey = '';
  private focus: Candlestick[] = [];
  private focusActive = false;
  private focusKey = '';
  private focusSettled: 'installed' | 'failed' | null = null;
  private active: Candlestick[] = [];
  private activeRangeKey = '';
  private rendered: Candlestick[] = [];
  private renderedRangeKey = '';
  private status = '加载 K 线';
  private pendingRender = false;

  private initialGen: number | null = null;
  private earlierGen: number | null = null;
  private laterGen: number | null = null;
  private futureGen: number | null = null;
  private windowGen: number | null = null;
  private lastFutureAnchor: number | null = null;

  private pointerDown = false;

  constructor(loader: CandleLoader = fetchCandles) {
    this.loader = loader;
    this.snapshot = this.buildSnapshot();
  }

  getSnapshot(): FreeReplayDatasetSnapshot {
    return this.snapshot;
  }

  subscribe(listener: (snapshot: FreeReplayDatasetSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Starts a new range: invalidates every older completion, resets range-local
   * dedupe/pending state, keeps the previous rendered window visible (no blank
   * flash) and starts the shared Cursor initial load.
   */
  async syncRange(input: FreeReplayDatasetRangeInput): Promise<void> {
    if (this.disposed) return;
    this.generation += 1;
    this.rangeKey = input.rangeKey;
    this.instrument = input.instrument;
    this.timeframe = input.timeframe;
    this.startTime = input.startTime;
    this.dataAnchorTime = input.dataAnchorTime;
    this.requestSource = input.requestSource;

    // Range-local keys only: the chart's viewport dedupe refs are out of scope.
    this.initialGen = null;
    this.earlierGen = null;
    this.laterGen = null;
    this.futureGen = null;
    this.windowGen = null;
    this.lastFutureAnchor = null;
    this.pendingRender = false;
    this.focusKey = '';
    this.focusSettled = null;
    this.status = '加载 K 线';
    this.emitIfChanged();

    await this.loadCursorInitial(this.generation);
  }

  /**
   * Focus enter / switch / exit. `null` restores the Cursor window as Active.
   * A new non-null request replaces the Focus window whole; same focusKey is a
   * no-op.
   */
  async syncFocus(request: { timeMs: number; token: number } | null): Promise<void> {
    if (this.disposed) return;
    if (!request) {
      await this.exitFocus();
      return;
    }
    const key = `${this.rangeKey}:${request.token}`;
    if (key === this.focusKey) return;

    this.focusKey = key;
    this.focusSettled = null;
    if (!this.focusActive) {
      // First focus: Cursor keeps growing in the background from here on.
      this.cursor = this.active;
      this.cursorRangeKey = this.rangeKey;
      this.focusActive = true;
    }
    const gen = this.generation;
    const rangeKey = this.rangeKey;
    this.status = '加载开仓点 K 线';
    this.emitIfChanged();

    try {
      const candles = await this.loader(this.request('initial', null, new Date(request.timeMs).toISOString()));
      if (!this.acceptsFocus(gen, key)) return;
      if (!candles.length) {
        this.focusSettled = 'failed';
        this.status = '';
        return;
      }
      const merged = mergeCandles(candles);
      this.focus = merged;
      this.focusSettled = 'installed';
      this.active = merged;
      this.activeRangeKey = rangeKey;
      this.rendered = merged;
      this.renderedRangeKey = rangeKey;
      this.status = '';
    } catch (error) {
      if (!this.acceptsFocus(gen, key)) return;
      this.focusSettled = 'failed';
      this.status = error instanceof ServerCandleError ? error.message : 'K 线加载失败';
    } finally {
      this.emitIfChanged();
    }
  }

  /** Publishes the current Active window as Rendered without fetching. */
  syncCursor(_cursorTime: number): void {
    if (this.disposed) return;
    if (!this.active.length) return;
    this.rendered = this.active;
    this.emitIfChanged();
  }

  async loadEarlier(): Promise<void> {
    if (this.disposed || this.earlierGen === this.generation) return;
    if (!this.active.length || this.activeRangeKey !== this.rangeKey) return;
    const owner: Owner = this.focusActive ? 'focus' : 'cursor';
    const gen = this.generation;
    const anchor = this.active[0].timestamp;
    this.earlierGen = gen;
    this.status = '加载更早 K 线';
    this.emitIfChanged();
    try {
      const candles = await this.loader(this.request('earlier', anchor));
      if (!this.isCurrent(gen)) return;
      if (candles.length) this.install(candles, owner, 'immediate');
      this.status = '';
    } catch (error) {
      if (!this.isCurrent(gen)) return;
      this.status = error instanceof ServerCandleError ? error.message : '更早 K 线加载失败';
    } finally {
      if (this.earlierGen === gen) this.earlierGen = null;
      this.emitIfChanged();
    }
  }

  async loadLater(): Promise<void> {
    if (this.disposed || this.laterGen === this.generation) return;
    if (!this.active.length || this.activeRangeKey !== this.rangeKey) return;
    const owner: Owner = this.focusActive ? 'focus' : 'cursor';
    const gen = this.generation;
    const anchor = this.active[this.active.length - 1].timestamp;
    this.laterGen = gen;
    this.status = '加载更晚 K 线';
    this.emitIfChanged();
    try {
      const candles = await this.loader(this.request('later', anchor));
      if (!this.isCurrent(gen)) return;
      // Append-type: the gesture is a drag, so it usually lands mid-drag and
      // must not call setData until pointerup.
      if (candles.length) this.install(candles, owner, 'defer');
      this.status = '';
    } catch (error) {
      if (!this.isCurrent(gen)) return;
      this.status = error instanceof ServerCandleError ? error.message : '更晚 K 线加载失败';
    } finally {
      if (this.laterGen === gen) this.laterGen = null;
      this.emitIfChanged();
    }
  }

  /**
   * Loads the next Cursor page ahead of the reveal, without rendering it.
   * `syncCursor` publishes it when the reveal reaches those candles.
   */
  async prefetchFuture(cursorTime: number): Promise<void> {
    if (this.disposed || this.focusActive || this.futureGen === this.generation) return;
    const last = this.cursor[this.cursor.length - 1];
    if (!last) return;
    if (this.cursorRangeKey !== this.rangeKey) return;
    if (this.lastFutureAnchor === last.timestamp) return;
    if (!shouldPrefetchFutureCandles(this.cursor, cursorTime, 20)) return;

    const gen = this.generation;
    this.futureGen = gen;
    this.lastFutureAnchor = last.timestamp;
    this.emitIfChanged();
    try {
      const candles = await this.loader(this.request('later', last.timestamp));
      if (!this.isCurrent(gen)) return;
      if (!candles.length) return;
      this.install(candles, 'cursor', 'loaded');
    } catch (error) {
      if (!this.isCurrent(gen)) return;
      // Release the anchor guard so a later cursor step / retry token can retry.
      this.lastFutureAnchor = null;
      this.status = error instanceof ServerCandleError ? error.message : '后续 K 线加载失败';
    } finally {
      if (this.futureGen === gen) this.futureGen = null;
      this.emitIfChanged();
    }
  }

  /** Heals one middle gap with a single centered `mode=initial` window. */
  async healGap(gap: { from: number; to: number }): Promise<void> {
    if (this.disposed || this.windowGen === this.generation) return;
    if (!this.active.length || this.activeRangeKey !== this.rangeKey) return;
    const owner: Owner = this.focusActive ? 'focus' : 'cursor';
    const gen = this.generation;
    this.windowGen = gen;
    this.status = '补齐缺口 K 线';
    this.emitIfChanged();
    try {
      const candles = await this.loader(
        this.request('initial', null, new Date((gap.from + gap.to) / 2).toISOString()),
      );
      if (!this.isCurrent(gen)) return;
      if (candles.length) this.install(candles, owner, 'defer');
      this.status = '';
    } catch (error) {
      if (!this.isCurrent(gen)) return;
      this.status = error instanceof ServerCandleError ? error.message : 'K 线加载失败';
    } finally {
      if (this.windowGen === gen) this.windowGen = null;
      this.emitIfChanged();
    }
  }

  /** Mirrors the chart's physical drag state (append-type installs defer). */
  setPointerDown(down: boolean): void {
    this.pointerDown = down;
  }

  /** Pointerup / cancel / blur: publish the latest Active once. */
  flushDeferredRender(): void {
    if (this.disposed || !this.pendingRender) return;
    this.pendingRender = false;
    this.rendered = this.active;
    this.emitIfChanged();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.pendingRender = false;
    this.focusActive = false;
    this.listeners.clear();
  }

  // -------------------------------------------------------------------------

  private async loadCursorInitial(gen: number): Promise<void> {
    if (this.initialGen === gen) return;
    this.initialGen = gen;
    const rangeKey = this.rangeKey;
    this.emitIfChanged();
    try {
      const candles = await this.loader(this.request('initial', null, this.dataAnchorTime));
      if (!this.isCurrent(gen)) return;
      const merged = mergeCandles(candles);
      this.cursor = merged;
      this.cursorRangeKey = rangeKey;
      if (this.focusActive) {
        // Focus owns the screen: only App Cursor is supplied.
      } else {
        this.active = merged;
        this.activeRangeKey = rangeKey;
        this.rendered = merged;
        this.renderedRangeKey = rangeKey;
      }
      this.status = merged.length ? '' : '没有 K 线';
    } catch (error) {
      if (!this.isCurrent(gen)) return;
      this.status = error instanceof ServerCandleError ? error.message : 'K 线加载失败';
    } finally {
      if (this.initialGen === gen) this.initialGen = null;
      this.emitIfChanged();
    }
  }

  private async exitFocus(): Promise<void> {
    if (!this.focusActive) return;
    this.focusActive = false;
    this.focus = [];
    this.focusKey = '';
    this.focusSettled = null;
    if (this.cursor.length && this.cursorRangeKey === this.rangeKey) {
      this.active = this.cursor;
      this.activeRangeKey = this.rangeKey;
      this.rendered = this.cursor;
      this.renderedRangeKey = this.rangeKey;
      this.status = '';
      this.emitIfChanged();
      return;
    }
    this.status = '加载 K 线';
    this.emitIfChanged();
    await this.loadCursorInitial(this.generation);
  }

  /**
   * Merges a response into its captured owner and publishes on the same rules
   * as before: only the active owner reaches Active/Rendered, deferred renders
   * wait for pointerup, `loaded` skips Rendered entirely.
   */
  private install(candles: Candlestick[], owner: Owner, mode: 'immediate' | 'defer' | 'loaded'): void {
    const merged = mergeCandles([...(owner === 'focus' ? this.focus : this.cursor), ...candles]);
    if (owner === 'focus') {
      this.focus = merged;
    } else {
      this.cursor = merged;
      this.cursorRangeKey = this.rangeKey;
    }

    const isActive = (owner === 'focus') === this.focusActive;
    if (!isActive) return;

    this.active = merged;
    this.activeRangeKey = this.rangeKey;
    if (mode === 'loaded') return;
    if (mode === 'defer' && this.pointerDown) {
      this.pendingRender = true;
      return;
    }
    this.rendered = merged;
    this.renderedRangeKey = this.rangeKey;
  }

  private request(mode: string, anchor: number | null, entryTime?: string): URLSearchParams {
    const params = new URLSearchParams({
      instrument: this.instrument,
      timeframe: this.timeframe,
      entryTime: entryTime ?? this.startTime,
      mode,
    });
    if (anchor !== null) params.set('anchor', String(anchor));
    params.set('source', this.requestSource);
    return params;
  }

  private isCurrent(gen: number): boolean {
    return !this.disposed && gen === this.generation;
  }

  private acceptsFocus(gen: number, key: string): boolean {
    return this.isCurrent(gen) && this.focusKey === key;
  }

  private buildSnapshot(): FreeReplayDatasetSnapshot {
    return {
      cursorCandles: this.cursor,
      activeCandles: this.active,
      renderedCandles: this.rendered,
      renderedRangeKey: this.renderedRangeKey,
      focusActive: this.focusActive,
      focusKey: this.focusKey,
      focusSettled: this.focusSettled,
      status: this.status,
      pendingRender: this.pendingRender,
      loading: {
        initial: this.initialGen === this.generation,
        earlier: this.earlierGen === this.generation,
        later: this.laterGen === this.generation,
        future: this.futureGen === this.generation,
        window: this.windowGen === this.generation,
      },
    };
  }

  private emitIfChanged(): void {
    if (this.disposed) return;
    const next = this.buildSnapshot();
    const previous = this.snapshot;
    const unchanged =
      next.cursorCandles === previous.cursorCandles &&
      next.activeCandles === previous.activeCandles &&
      next.renderedCandles === previous.renderedCandles &&
      next.renderedRangeKey === previous.renderedRangeKey &&
      next.focusActive === previous.focusActive &&
      next.focusKey === previous.focusKey &&
      next.focusSettled === previous.focusSettled &&
      next.status === previous.status &&
      next.pendingRender === previous.pendingRender &&
      next.loading.initial === previous.loading.initial &&
      next.loading.earlier === previous.loading.earlier &&
      next.loading.later === previous.loading.later &&
      next.loading.future === previous.loading.future &&
      next.loading.window === previous.loading.window;
    if (unchanged) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener(next);
  }
}
