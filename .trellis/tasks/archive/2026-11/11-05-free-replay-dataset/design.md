# Design — Free Replay Dataset

## 1. Design Summary

Create a framework-free `FreeReplayDataset` Module that owns the Cursor / Focus / Active / Rendered datasets and all Candlestick loading/publication rules. The chart keeps lightweight-charts, Viewport, drawing and gesture-trigger logic; it consumes immutable Dataset snapshots and calls intent-level commands.

This is deliberately not a pure-helper extraction and not a whole-chart controller. The new Interface hides owner selection, in-flight dedupe, stale responses, focus switching and deferred publication—the complexity currently spread across refs and effects.

## 2. Module And Adapter

New file: `src/ui/free-replay-dataset.ts`

```ts
export type CandleLoader = (params: URLSearchParams) => Promise<Candlestick[]>;

export class FreeReplayDataset {
  constructor(loader?: CandleLoader); // production default: fetchCandles

  getSnapshot(): FreeReplayDatasetSnapshot;
  subscribe(listener: (snapshot: FreeReplayDatasetSnapshot) => void): () => void;

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

`CandleLoader` has exactly the existing `fetchCandles` shape. Production uses that Adapter; tests use a deferred fake Adapter. This is a real Seam because two Adapters exercise the same Interface.

No React, lightweight-charts, DOM, Session Store, or `App.tsx` imports are allowed in this Module.

### Snapshot

```ts
export type FreeReplayDatasetSnapshot = {
  cursorCandles: Candlestick[];
  activeCandles: Candlestick[];
  renderedCandles: Candlestick[];
  renderedRangeKey: string;
  focusActive: boolean;
  focusKey: string;
  focusSettled: 'installed' | 'failed' | null;
  status: string;
  pendingRender: boolean;
};
```

Semantics:

- `cursorCandles`: the only array App may receive through `onCandlesLoaded`; also supplies Cursor-based price reads.
- `activeCandles`: currently loaded owner used by viewport-trigger gates. It is Focus while focused, otherwise Cursor.
- `renderedCandles`: the only array the chart may render and publish through `onActiveCandlesLoaded`.
- `renderedRangeKey`: range identity of `renderedCandles`; first-anchor logic keeps using it.
- `focusKey` / `focusSettled`: lets the existing Focus viewport effect wait for the current window to install or fail before anchoring.
- `status`: preserves the current loading/error text contract.
- `pendingRender`: distinguishes loaded-active from the final deferred rendered snapshot and is directly testable.

`getSnapshot()` returns a cached object. A new snapshot is created only for an actual transition; array contents are never mutated in place. This prevents React subscription render loops.

## 3. Commands And Contracts

### 3.1 `syncRange`

Input:

```ts
type FreeReplayDatasetRangeInput = {
  rangeKey: string;
  instrument: string;       // already translated by replayRequestInstrument
  timeframe: ReviewTimeframe;
  startTime: string;        // replay.startTime for earlier/later/prefetch
  dataAnchorTime: string;   // Cursor initial anchor
  requestSource: ChartCandleSource;
};
```

Every invocation by the existing range-change effect begins a monotonically increasing range generation. Do not call it unconditionally on every render.

It:

1. invalidates all older async completions;
2. resets range-local in-flight/dedupe/pending state while preserving the previous rendered snapshot to avoid blank flashing;
3. sets status to `加载 K 线`;
4. starts the shared Cursor initial load with `mode=initial` and `dataAnchorTime`;
5. on current success, replaces Cursor, publishes App Cursor, and—only when not focused—publishes Active + Rendered with the new `renderedRangeKey`.

`loadCursorInitialWindow` remains an internal operation with same-generation in-flight dedupe. A range reset and Focus exit may request it together; only one request may be in flight for that generation.

### 3.2 `syncFocus`

For a non-null request, derive `focusKey = currentRangeKey + ':' + token`.

- Same current focusKey: no duplicate fetch.
- New focusKey: back up Cursor if this is the first focus, mark Focus active, clear prior focus settlement, and issue one `mode=initial` centered on `new Date(timeMs).toISOString()`.
- Completion is accepted only when both the range generation and focusKey are still current.
- Non-empty current response: replace Focus/Active/Rendered; never merge with Cursor and never publish Focus through `onCandlesLoaded`; settle `installed`.
- Empty current response: settle `failed`, leave Active on Cursor and status empty, matching the current fallback path.
- Current error: settle `failed` and preserve `ServerCandleError` text where available.

For `null`:

- No prior Focus: no-op.
- Otherwise clear Focus and its settlement, then restore the matching-range Cursor as Active + Rendered + App Cursor.
- If Cursor is absent or belongs to another range, trigger the shared Cursor initial load; its in-flight dedupe prevents a second request when a range reset just started one.
- Viewport behavior after restoration remains in the chart.

### 3.3 `syncCursor`

When Active is non-empty, publish Active as Rendered without fetching. This preserves the current cursor-step effect. Future visibility is still filtered by `visibleCandlesForFreeReplay` in the chart, not by duplicating that logic in Dataset.

### 3.4 Earlier / Later

Each command:

- no-ops when Active is empty or the same operation is already in flight;
- captures the owner at invocation (`focusActive ? focus : cursor`) and the current range generation;
- anchors on Active's first (`earlier`) or last (`later`) timestamp;
- uses `entryTime=startTime` and the current request parameters;
- merges only into the captured owner after generation validation;
- publishes Active/Rendered only if that owner is still active; a Cursor response during Focus updates App Cursor in the background without replacing Focus rendering;
- Later uses deferred publication when pointer is down; Earlier publishes immediately as today.

Viewport-specific logical-range keys remain in the chart. Dataset-level generation and in-flight guards are mandatory even when those keys exist.

### 3.5 Future prefetch

- No-op during Focus, when loading, or when the latest anchor is already guarded.
- Reuse `shouldPrefetchFutureCandles(cursorCandles, cursorTime, 20)`.
- Request `mode=later` from Cursor's latest timestamp with `entryTime=startTime`.
- On current non-empty response, merge into Cursor with `render:false`; App Cursor updates, Rendered does not change until `syncCursor`.
- On failure, clear the future-anchor guard and preserve the existing error text so Cursor movement or the existing retry token can retry.
- Range generation validation applies to success, empty responses and errors.

### 3.6 Gap healing

The chart continues to detect `firstGapInRange` and own the visible-range trigger key. `healGap(gap)`:

- no-ops while a gap window is loading;
- issues one `mode=initial` centered on `(from + to) / 2`;
- captures the current owner and generation;
- merges only into that owner on a current response;
- uses deferred publication while pointer is down and immediate publication otherwise.

### 3.7 Pointer and disposal

`pointerDownRef` stays in the chart because it is physical gesture state. It is mirrored through `setPointerDown`.

- Append-type Later/Gap responses during pointerdown update owner + Active immediately but leave Rendered unchanged and set `pendingRender=true`.
- `flushDeferredRender()` publishes the latest Active once and clears pending. The existing pointerup `setTimeout(0)`, pointercancel and blur ordering stays in the chart.
- Range reset and `dispose()` clear pending state. Dispose also increments generation, invalidates Focus and removes listeners so no late completion can produce any effect.

## 4. React Integration

FreeReplayChart remains in `src/ui/App.tsx` for this task.

1. Hold one `FreeReplayDataset` instance in a ref.
2. Subscribe in a mount-only effect and mirror the cached snapshot into React state. Unsubscribe and dispose on unmount.
3. Replace `loadedCandles`, `renderedCandles`, `status`, Focus/dataset/loading/pending refs with snapshot reads.
4. Call `syncRange`, `syncFocus`, `syncCursor`, `loadEarlier`, `loadLater`, `prefetchFuture` and `healGap` from the existing effects at the same trigger points and in the same declaration order.
5. Feed `snapshot.cursorCandles` to `onCandlesLoaded` and `snapshot.renderedCandles` to `onActiveCandlesLoaded` through effects, preserving callback timing.
6. Continue using `renderedRangeKey`, `focusKey`, `focusSettled`, `focusActive`, Active and Cursor snapshots in the existing viewport effects. `initializedRangeKeyRef`, `appliedFocusKeyRef`, `appliedCursorKeyRef`, `cursorFollowRangeKeyRef` and trigger-dedupe refs stay in the chart.

Delete the old local `publishActive`, `installIntoDataset`, `loadCursorInitialWindow`, `loadEarlierFreeReplayCandles`, `loadLaterActiveCandles`, `loadWindowCandles`, `fetchInitialWindow` and their parallel ownership refs. Temporary delegation during migration is allowed only as an uncommitted stepping stone; the final diff may not leave two owners.

Move the existing `mergeCandles` helper from `App.tsx` into `src/ui/free-replay-chart.ts` and import it from both App and Dataset. This avoids creating a second merge implementation; OtherCoinChart and server consolidation remain a later task.

## 5. Unit Test Design

New `tests/free-replay-dataset.test.ts` uses a deferred fake Candle Loader with request logging and manually controlled resolution/rejection. Required cases:

1. **Initial publication:** Cursor/Active/Rendered and range identity are correct; request parameters match the old initial request.
2. **Range A/B race:** resolve A after B; A's success/error/empty response cannot alter B's snapshot or status.
3. **Focus A/B race:** same range, resolve A after B; only B can install or fail. Focus never merges with Cursor.
4. **Focus exit:** matching Cursor restores without a request; mismatched Cursor shares the initial loader and does not duplicate an in-flight request.
5. **Earlier/Later ownership:** owner is captured at invocation; Cursor growth during Focus feeds App Cursor only, Focus growth renders only when still active.
6. **Stale page responses:** old-range Earlier/Later/Gap/Prefetch responses cannot merge into the new range.
7. **Prefetch:** updates loaded Cursor but not Rendered; `syncCursor` publishes Active; a failed prefetch can be retried.
8. **Pointer defer:** Later and Gap update Active immediately during pointerdown without changing Rendered, flush once to the latest Active, and render immediately in the non-drag control.
9. **Focus empty/error:** current focusKey settles failed with the existing status/fallback data; stale focus errors are silent.
10. **Dispose:** every pending operation is harmless after disposal.
11. **Request matrix:** initial/focus/earlier/later/prefetch/gap preserve instrument, timeframe, entryTime, mode, anchor and requestSource.
12. **Snapshot stability:** repeated `getSnapshot()` calls without a transition return the same object; updates create a new snapshot.

Use small contiguous candle fixtures; do not mount React or lightweight-charts.

## 6. Compatibility And Trade-offs

- **No product behavior redesign:** request parameters, status messages, rendering boundaries, Viewport and Session contracts remain unchanged. The only intentional correctness tightening is rejecting stale responses that the existing comments already say should be rejected.
- **Real Loader Seam:** production `fetchCandles` and the test fake are two Adapters. No mock-only interface is added to production callers.
- **Viewport stays local:** keeping gesture triggers in the chart avoids forcing chart-specific knowledge into Dataset and keeps the new Module focused on data correctness.
- **No global store:** one Dataset instance per mounted FreeReplayChart is sufficient.
- **No simultaneous owners:** snapshot is the only read model after migration; keeping refs for imperative chart APIs is still correct.
- **New domain term:** add `Free Replay Dataset` to `CONTEXT.md` because this name becomes a durable domain/architecture concept, not a one-off helper.

## 7. Rollout And Rollback

Implement and test the Module standalone first. Then integrate range/Cursor, Focus, paging/prefetch/gap, and deferred publication in small steps, running the existing App characterization tests after each. Temporary delegation is only for local migration and must be removed before the quality gate.

Rollback is a single focused commit revert. No API, database or Session migration is involved. If App integration becomes unstable, keep the standalone Module and tests locally for diagnosis but do not commit a half-migrated dual-owner state.
