# Free Replay Dataset

## Scope / Trigger

Read this before changing `src/ui/free-replay-dataset.ts`, or any `FreeReplayChart` effect that loads/selects candlesticks.

`FreeReplayDataset` is the single data owner for a mounted Free Replay chart:

- **Cursor** — the continuous window around the replay cursor. It is the only dataset App receives (`freeReplayCandles`) for the current price, P&L and open/close availability.
- **Focus** — one contiguous window around a focused order's entry. It never merges with Cursor.
- **Active** — Focus while focused, otherwise Cursor; every viewport gate reads it.
- **Rendered** — the only window the chart may draw and publish as `freeReplayActiveCandles`.

The chart keeps lightweight-charts, viewport math, gesture triggers, pointer state, drawing and markers. It must not keep a second mutable copy of any of the four windows.

## Signatures

```ts
type CandleLoader = (params: URLSearchParams) => Promise<Candlestick[]>;

class FreeReplayDataset {
  constructor(loader?: CandleLoader);          // production default: fetchCandles

  getSnapshot(): FreeReplayDatasetSnapshot;    // cached, immutable between transitions
  subscribe(listener: (snapshot) => void): () => void;

  syncRange(input: FreeReplayDatasetRangeInput): Promise<void>;
  syncFocus(request: { timeMs: number; token: number } | null): Promise<void>;
  syncCursor(cursorTime: number): void;

  loadEarlier(): Promise<void>;
  loadLater(): Promise<void>;
  prefetchFuture(cursorTime: number): Promise<void>;
  healGap(gap: { from: number; to: number }): Promise<void>;

  setPointerDown(down: boolean): void;
  flushDeferredRender(): void;
  dispose(): void;
}
```

Snapshot fields: `cursorCandles`, `activeCandles`, `renderedCandles`, `renderedRangeKey`, `focusActive`, `focusKey`, `focusSettled`, `status`, `pendingRender`, and `loading: { initial; earlier; later; future; window }`.

The chart mirrors the snapshot into React state through ONE mount-only subscription, and forwards `cursorCandles` / `renderedCandles` to App **inside that listener** (not in a later effect) so a reveal click cannot race the App state update.

## Contracts

1. **One owner.** Only `FreeReplayDataset` mutates the four windows. The chart may hold `renderedRangeKey`, `focusKey` and `focusSettled` for viewport gating, but reads them from the snapshot.
2. **Cursor-only App supply.** `cursorCandles` feeds App's price/P&L; `renderedCandles` feeds marker anchoring. A Focus window must never reach `freeReplayCandles`.
3. **Whole-window Focus.** Entering Focus issues one `mode=initial` and replaces Focus/Active/Rendered. Cursor keeps growing in the background and keeps feeding App.
4. **Focus exit.** If Cursor belongs to the current range it is restored with no request; otherwise the shared Cursor initial load runs (deduped with a range reset's in-flight request).
5. **Range generation.** `syncRange` increments a monotonically increasing generation and invalidates every older completion. Every async result checks its generation before touching data, status or listeners. Focus additionally checks `focusKey`.
6. **Request parameters are frozen by `syncRange`** (`instrument`, `timeframe`, `startTime`, `dataAnchorTime`, `requestSource`). Initial → `mode=initial&entryTime=dataAnchorTime`; Focus → `mode=initial&entryTime=new Date(timeMs).toISOString()`; Earlier/Later/Prefetch → `mode=earlier|later&entryTime=startTime&anchor=<edge>`; Gap → `mode=initial&entryTime=new Date((from+to)/2).toISOString()`; every request carries `source=requestSource` from `chartMarketContext`.
7. **Render protocol.** Prefetch installs into Cursor with `loaded` only (no Rendered change); `syncCursor` later publishes Active as Rendered. Later/Gap are append-type: during pointerdown they update Active + `pendingRender` and never call `setData`; `flushDeferredRender` publishes once. Earlier and whole-window Focus publish immediately.
8. **Snapshot stability.** `getSnapshot()` returns the same object until an actual transition; arrays are never mutated in place; one listener call per transition.
9. **No framework.** The Module imports no React, DOM, lightweight-charts, Session Store or `App.tsx`.
10. **Effect-owned lifecycle.** `FreeReplayChart`'s mount-only subscription effect creates a fresh Dataset on every setup and disposes that same instance on cleanup. The current instance lives in a ref; every command reads it at execution time. StrictMode effect replay must never reuse the instance disposed by the first cleanup, and latest callback refs must not trigger owner recreation.

## Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Stale generation success / empty / error | No data, status, focus or listener change |
| Focus key no longer current (A→B) | A's success, empty and error are silent; only B settles |
| Focus empty response | `focusSettled='failed'`, `status=''`, Active stays Cursor |
| Focus error | `focusSettled='failed'`, `ServerCandleError` message or `K 线加载失败` |
| Cursor initial empty | `status='没有 K 线'`, windows replaced with `[]` |
| Cursor initial error | `ServerCandleError` message or `K 线加载失败` |
| Earlier/Later current response | Merge into captured owner; `status=''` even when empty |
| Prefetch failure | Clear the anchor guard, `status='后续 K 线加载失败'` (retryable) |
| Gap error | `ServerCandleError` message or `K 线加载失败` |
| Active owner changed while loading | Merge into the captured owner only; never republish Focus over Cursor or vice versa |
| Pointer down + Later/Gap | Active updated, `pendingRender=true`, Rendered unchanged |
| After `dispose()` | Every completion is a no-op; listeners already cleared |

Moving the cursor (`syncCursor`) publishes `activeCandles` as `renderedCandles` and leaves `renderedRangeKey` unchanged; the first-anchor guard depends on that distinction.

## Good / Base / Bad Cases

- **Good:** a page loaded for Cursor while Focus is active updates `cursorCandles` (App sees it) and leaves `renderedCandles` on Focus.
- **Good:** switching timeframe during a pending Earlier discards that Earlier without touching the new range's status.
- **Good:** two Focus selections in the same range settle only the newer `focusKey`.
- **Base:** a fresh range keeps the previous Rendered window visible until the new initial load lands, so the chart never blanks.
- **Base:** `syncFocus(null)` on an unfocused chart is a no-op (do not reset viewport/backfill state on every render).
- **Bad:** merging Cursor and Focus arrays to “simplify” the snapshot.
- **Bad:** guarding only initial loads while Earlier/Later/Prefetch/Gap skip the generation check.
- **Bad:** calling `setData` for a Later/Gap page while the pointer is down.
- **Bad:** caching a snapshot that mutates its arrays in place (React subscription loops).
- **Bad:** storing one Dataset in render-scoped state while the subscription cleanup disposes it; StrictMode's second setup then issues no load and the chart stays blank.

## Tests Required

`tests/free-replay-dataset.test.ts` (no React, jsdom or lightweight-charts) must cover, with a deferred `CandleLoader`:

1. initial publication and request parameters;
2. range A/B success/empty/error isolation;
3. Focus A/B success and error isolation;
4. Focus exit with matching vs mismatched Cursor (no duplicate in-flight request);
5. Earlier/Later owner capture across a Focus transition;
6. stale page/prefetch/gap responses after a range switch;
7. prefetch loaded-but-not-rendered, `syncCursor` publication, failure retry;
8. pointer-down defer for Later/Gap, single flush, non-drag immediate render;
9. Focus empty/error fallback with Cursor preserved;
10. dispose silence;
11. full request matrix (instrument, timeframe, entryTime, mode, anchor, source);
12. snapshot stability / notification count.

`tests/app-free-replay.test.tsx` remains the characterization suite for first anchor, comfort-zone follow, focus paging, deferred render, future hiding, paper rounds and timeframe switch. Do not weaken it. Its production-entry `<StrictMode>` initial-mount case must assert that real OHLC points reach the latest `series.setData`; Dataset unit tests and non-StrictMode App tests do not cover effect replay disposal.

## Wrong vs Correct

```ts
// Wrong: a second mutable owner in the chart.
const cursorCandlesRef = useRef<Candlestick[]>([]);
onCandlesLoaded(merged);

// Correct: snapshot read + Dataset-owned publication.
const { cursorCandles, renderedCandles } = snapshot;
// listener: if (next.cursorCandles !== previous.cursorCandles) onCandlesLoaded(next.cursorCandles);
```

```ts
// Wrong: only the range key is checked, so same-range Focus A can overwrite B.
if (rangeKeyRef.current !== fetchRangeKey) return;

// Correct: generation for everything, plus focusKey for Focus.
if (!this.isCurrent(gen)) return;
if (!this.acceptsFocus(gen, focusKey)) return;
```

```ts
// Wrong: render append-type pages during the drag (LWC rightOffset snapshot).
setRenderedCandles(merged);

// Correct: data layer now, render after pointerup.
dataset.setPointerDown(true);
// …install marks pendingRender…
dataset.flushDeferredRender();
```
