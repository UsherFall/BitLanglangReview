# Current-state research — Free Replay Dataset

Date: 2026-11-05  
Mode: read-only source, tests, specs and archived-task inspection

## Baseline and constraints

- Current product baseline after child 1: 76 files / 694 tests passed, TypeScript and CRLF-aware diff check passed.
- Current branch: `feat/replay-market-context`; child 1 work commit `9e627a6` is present.
- `chartMarketContext` is now the only source → venue/requestSource/grid mapping. The Dataset Module must consume its `requestSource`, not reconstruct it.
- No new product behavior is requested. This is a Module deepening plus strict async-staleness enforcement.

## Current ownership map

| Concern | Current owner / location | Required final owner |
| --- | --- | --- |
| Cursor continuous window | `cursorCandlesRef` + `cursorCandlesRangeKeyRef` | Dataset Module |
| Focus continuous window | `focusCandlesRef` | Dataset Module |
| Active loaded window | `activeCandlesRef` + `loadedCandles` state | Dataset Module snapshot |
| Rendered window + range identity | `renderedCandles` state + `renderedRangeKeyRef` | Dataset Module snapshot |
| Focus enter/exit and installed/failed keys | `focusActiveRef`, `wasFocusedRef`, `focusWindowKeyRef`, `focusInstalledKeyRef`, `focusFailedKeyRef` | Dataset Module |
| Initial / earlier / later / future / gap in-flight state | five loading refs + `cursorInitialKeyRef` + `lastFutureLoadAnchorRef` | Dataset Module |
| Deferred render | `pointerDownRef` + `pendingInstallRenderRef` + `flushPendingInstallRender` | Pointer state stays in chart; pending publication moves to Dataset Module |
| Initial/focus/viewport anchoring | `initializedRangeKeyRef`, `appliedFocusKeyRef`, `appliedCursorKeyRef`, `cursorFollowRangeKeyRef` | Stay in chart |
| Viewport-trigger dedupe | `lastLoadEarlierRangeRef`, `lastLoadLaterRangeRef`, `historyBackfill*`, `gapHealKeyRef` | Stay in chart; Dataset still enforces in-flight and range guards |
| Candlestick requests | local async functions using `fetchCandles(URLSearchParams)` | Dataset Module through injectable Candle Loader Adapter |
| Status text | local `status` state updated by each loader | Dataset snapshot, preserving current messages |

The chart should decide **when** a viewport gesture needs data. The Dataset Module should decide **which owner receives it, whether the response is current, and when it becomes rendered**.

## Async operation inventory

| Operation | Owner at invocation | Publish behavior today | Existing stale guard |
| --- | --- | --- | --- |
| Cursor initial | Cursor | Cursor + App; Active + Rendered only when not focused | rangeKey only; same-key in-flight dedupe |
| Focus initial | Focus | Replace Focus + Active + Rendered; never App Cursor | rangeKey only, no same-range focusKey guard |
| Earlier | Capture `focusActive ? focus : cursor` | Merge into captured owner; publish only if owner still active | no uniform range-generation guard |
| Later | Capture owner the same way | Merge; `render:'defer'` while pointer down | no uniform range-generation guard |
| Future prefetch | Cursor only when not focused | Merge into Cursor; `render:false`; App Cursor still updates | no uniform range-generation guard |
| Gap initial window | Current active owner | Merge; `render:'defer'` while pointer down | loadingWindow + chart trigger key, no uniform range-generation guard |
| Cursor sync | Active | Re-publish Active as Rendered without fetching | synchronous |
| Range reset | New range | Starts Cursor initial and resets dedupe/pending state | multiple refs reset in one effect |
| Dispose | All | chart.remove and pending flag cleanup | no async generation invalidation |

## Concrete race evidence

### Same-range Focus A → B

`src/ui/App.tsx` Focus effect builds `focusKey = rangeKey:token`, but its fetch completion checks only `rangeKeyRef.current !== fetchRangeKey`. If Focus A is pending and the reviewer selects Focus B in the same Session/timeframe, rangeKey is unchanged. A's late success can publish A's window after B was requested and can overwrite `focusInstalledKeyRef` / Active / Rendered. A's late error can also replace B's status. The new Module must validate both range generation and focusKey before any publication.

### Earlier / Later / Prefetch / Gap after range switch

These paths call `installIntoDataset`, which reads the current `rangeKeyRef` but does not compare the invocation's rangeKey with a generation captured at completion. A late response can merge an old timeframe/source into the current owner and mark it as current. The new Module must capture a monotonically increasing range generation at every `syncRange`, reject all older completions, and invalidate them on dispose.

These are correctness hardening points within the existing documented contract, not a request to preserve the race behavior.

## Existing behavior that must remain byte-for-byte at the request level

- `syncRange` Cursor initial: `mode=initial`, `entryTime=replay.dataAnchorTime`, current requestInstrument/timeframe/requestSource.
- Focus initial: `mode=initial`, `entryTime=new Date(focus.timeMs).toISOString()`.
- Earlier / Later: `entryTime=replay.startTime`, anchor is the Active window's first/last timestamp, mode matches direction.
- Future prefetch: mode `later`, anchor is Cursor's latest timestamp, threshold 20 hidden bars; failure clears the anchor guard so a later Cursor/retry token can retry.
- Gap: `mode=initial`, `entryTime=new Date((gap.from+gap.to)/2).toISOString()`, current Active owner; chart keeps visible-range/gap trigger dedupe.
- Rendering: `render:false` for prefetch, `render:'defer'` for Later and Gap while pointer is down, immediate for non-drag controls and whole-window replacement.

## Characterization Tests already available

`tests/app-free-replay.test.tsx` contains direct integration coverage for:

- right-edge initial anchor, comfort-zone follow and left-edge follow;
- no future reveal, continued prefetch and retry after failure;
- middle-gap heal and deferred gap render;
- focus right-edge page gates, immediate/deferred render and pointerup flush;
- one contiguous Focus window, App Cursor supply during Focus, and Cursor restoration after stepping out;
- timeframe first-anchor waiting for new range data and Focus clearing on timeframe switch;
- order entry anchor, return-to-Cursor and pre-entry view reset;
- Session source/grid inheritance from child 1;
- Paper Round markers, paper trading and annotations.

These tests must run after every migration step. They are not a reason to skip Dataset-level tests: today many of them require the full 3,000+ line App test harness and a lightweight-charts mock, which is exactly the Interface cost this task should reduce.

## Historical decisions to preserve

- `archive/2026-11/10-30-replay-focus-window-replace/design.md`: Cursor and Focus never merge; Focus is one contiguous whole-window replacement; App only consumes Cursor during Focus.
- `archive/2026-11/11-03-replay-focus-right-page-drift/design.md`: `shiftVisibleRangeOnNewBar:false`; focus later paging stops at the reveal boundary; stale Cursor refs must not drive handlers.
- `archive/2026-11/11-04-replay-focus-drag-prepend-jump/design.md`: only append-type Later/Gap publications defer during pointerdown; earlier and whole-window replacements do not; pointerup/cancel/blur flush once.
- `archive/2026-11/11-04-replay-timeframe-switch-viewport/design.md`: first anchor waits for `renderedRangeKey === rangeKey`; old rendered data stays visible during load to avoid blank flash; timeframe switch clears Focus.
- `archive/2026-11/11-02-replay-source-gaps/design.md`: gap healing uses one centered initial window and trigger-key dedupe, never cross-venue substitution.

## Rejected approaches

- **Pure helper extraction only:** moving `publishActive` / `installIntoDataset` into free functions while React still owns every ref and async guard would keep the same Interface complexity and provide little Locality.
- **Whole-chart controller:** moving Viewport, drawing, markers, price scale and pointer math together would multiply risk and obscure the useful Dataset seam.
- **Generic Chart abstraction shared with TradeChart / OtherCoinChart:** their Cursor/focus semantics differ; there are not two matching Adapters for that abstraction.
- **New global store:** the state belongs to one mounted FreeReplayChart; a small controller with an injected Candle Loader is sufficient.

## Testing implications

The new Module needs a controllable deferred Candle Loader so tests can resolve A/B responses in either order. Production continues to use `fetchCandles`; tests use the same Interface with a fake Adapter. Snapshot reads must be stable/immutable between transitions so React cannot enter a subscription render loop.
