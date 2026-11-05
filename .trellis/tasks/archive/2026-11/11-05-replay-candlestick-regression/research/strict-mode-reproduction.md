# StrictMode reproduction — Free Replay blank chart

Date: 2026-11-05

## Feedback loop

Throwaway harness: `.scratch/replay-strict-repro.test.tsx` (ignored research file; delete before completion).

It drives the real `App` Free Replay flow with the existing lightweight-charts mock and a non-empty `/api/candles` response. The assertion counts REAL OHLC points in the latest `series.setData`, excluding whitespace points. `REPRO_STRICT=1` mounts the same `<React.StrictMode><App /></React.StrictMode>` as `src/main.tsx`; without the variable it is the non-StrictMode control.

Observed before any product-code change:

| Command | Result |
| --- | --- |
| `npx vitest run .scratch/replay-strict-repro.test.tsx` | PASS — real candles reach `setData` |
| `REPRO_STRICT=1 npx vitest run .scratch/replay-strict-repro.test.tsx` | FAIL — latest `setData` contains 0 real candles |
| `npx vitest run tests/free-replay-dataset.test.ts tests/app-free-replay.test.tsx` | PASS — 2 files / 75 tests, demonstrating the existing coverage gap |

The failing loop reproduces the reported symptom at the App + chart input Seam, rather than merely asserting that a nearby helper works.

## Ranked hypotheses and evidence

1. **StrictMode permanently disposes the render-scoped Dataset — CONFIRMED.** Prediction: the first effect setup starts a request, cleanup disposes the instance, and the second setup reuses the disposed instance. Instrumenting prototype methods only inside the throwaway harness produced:

   ```text
   [DEBUG-replay-strict] {
     "lifecycle":["syncRange:disposed=false","dispose","syncRange:disposed=true"],
     "candleRequests":1,
     "cursor":0,
     "rendered":0,
     "status":"加载 K 线"
   }
   ```

   `src/main.tsx:7` enables StrictMode. `src/ui/App.tsx:1581` stores one Dataset in render-scoped state; the subscription cleanup at `src/ui/App.tsx:1680` disposes it. StrictMode's development effect replay then runs the range effect again at `src/ui/App.tsx:1775`, but `FreeReplayDataset.syncRange` returns immediately for a disposed instance (`src/ui/free-replay-dataset.ts:127`). The first request's completion is also rejected by the generation/disposal guard at `src/ui/free-replay-dataset.ts:431`.

2. **Cursor/timeframe filtering removes otherwise loaded candles — RULED OUT for this repro.** The instrumented Dataset snapshot has both `cursorCandles` and `renderedCandles` empty before visibility filtering; there is no loaded Candlestick for `visibleCandlesForFreeReplay` to reveal.

3. **The render effect targets a removed chart series — NOT THE PRIMARY CAUSE.** StrictMode does recreate the chart, but the captured Dataset is already empty and the second range load is a no-op. The non-StrictMode control and the lifecycle trace isolate the blank input upstream of `series.setData`. The post-fix StrictMode assertion must still verify the current series receives real candles.

4. **The market request is empty or failed — RULED OUT for this repro.** The fake `/api/candles` response always contains three valid Candlesticks. Exactly one request fires, but its result cannot publish after disposal; the UI remains at `加载 K 线`, rather than receiving a server empty/error response.

## Minimal lifecycle design

Keep `FreeReplayDataset` and its terminal `dispose()` semantics unchanged. Fix ownership in `FreeReplayChart`:

- Hold the current Dataset in a ref. The mount-only subscription effect owns its lifecycle: each setup ensures a NEW current instance, subscribes to it, and each cleanup unsubscribes, disposes THAT instance, and clears the ref only if it still points to that instance.
- All range/focus/cursor/paging/prefetch/pointer commands read the current instance from the ref when their effect or handler executes. They must not capture the disposed instance from the render scope.
- Keep the subscription effect declared before the command effects, as it is today. StrictMode's second setup therefore creates the new instance before the second `syncRange` executes.
- Forward App callbacks through latest-value refs so the Dataset subscription remains mount-only; callback identity changes must not tear down and recreate the data owner.
- Preserve the existing listener-side publication of Cursor and Rendered arrays and every Dataset request/render contract.

Rejected alternatives:

- Remove `React.StrictMode`: hides the lifecycle bug and weakens development checks.
- Skip disposal on cleanup: leaves real unmounts without explicit async invalidation and violates the existing Module contract.
- Make a disposed Dataset reusable / resurrect it in `subscribe`: confuses terminal ownership semantics and weakens the direct Module Seam.
- Delay disposal with a timer to guess whether cleanup is simulated: timing-dependent and unnecessary when the effect owns a fresh instance.

## Regression and validation plan

1. Add a characterization regression in `tests/app-free-replay.test.tsx` that mounts `<App>` in `React.StrictMode`, starts Free Replay with valid candles, and requires real OHLC points in the latest `setData`. Run it before the fix and retain the red evidence.
2. Apply only the ref/effect ownership change in `src/ui/App.tsx`.
3. Re-run the new regression and the throwaway original loop; both must turn green without removing StrictMode or relaxing assertions.
4. Run `npx vitest run tests/free-replay-dataset.test.ts tests/app-free-replay.test.tsx` for focused coverage, then `npm test` and `npx tsc --noEmit`.
5. Remove `.scratch/replay-strict-repro.test.tsx` and confirm no `[DEBUG-replay-strict]` instrumentation remains in tracked source.
6. During the required spec update, add the reusable rule to the frontend hook/dataset specs: an effect-cleaned disposable owner must be created by that same effect lifecycle, not retained in render state across StrictMode effect replay; production-entry mounting belongs in characterization coverage.

Rollback is one focused commit revert; there is no API, storage, Session or Dataset protocol migration.

## Post-fix outcome

- The permanent regression `keeps initial candles visible through StrictMode effect replay` was RED before the App change (`expected 0 to be greater than 0`) and GREEN afterwards.
- The original throwaway loop passed in BOTH StrictMode and non-StrictMode modes after the fix; it was then deleted, and no `[DEBUG-replay-strict]` instrumentation remains in tracked source.
- Focused Dataset + App Replay: **2 files / 76 tests passed**. TypeScript: `npx tsc --noEmit` passed. `git diff --check` passed.
- Full `npm test`: **77 files / 707 tests passed, one suite failed to load** because the pre-existing ignored fixture `.trellis/tasks/archive/2026-10/10-20-anomaly-level-tracker/research/pool` is absent (`tests/level-alert-parity.test.ts`, ENOENT). This is unrelated to the Replay diff and must not be reported as a full-suite pass.
- Full runnable suite with only that unavailable historical-data suite excluded (`npm test -- --exclude tests/level-alert-parity.test.ts`): **77 files / 707 tests passed**. No test or assertion was skipped or weakened in tracked code.
- `trellis mem search "level-alert-parity"` confirmed the same clean-HEAD environmental failure and delivery convention in earlier sessions, including Pi `01a19c33-108` (2026-11-03) and `01a1a656-518` / `01a1a69c-062` (2026-11-04). The task therefore uses the established gate of all runnable tests passing plus explicit disclosure of this one pre-existing fixture failure; the raw `npm test` result remains documented above.

## Bug analysis: disposed owner reused across effect replay

### 1. Root Cause Category

- **D — Test Coverage Gap:** direct Dataset tests and ordinary App tests passed while the production StrictMode composition failed.
- **A — Missing Spec:** the creation/disposal ownership rule for effect-cleaned resources was implicit, so render-scoped ownership looked valid.

### 2. Why Fixes Failed

No prior fix attempt failed in this task. The differential StrictMode/non-StrictMode loop prevented anchoring on market data, timestamp filtering or chart rendering. Removing StrictMode, skipping cleanup, reviving disposal and delayed disposal were rejected without implementation because they hide the defect or violate ownership semantics.

### 3. Prevention Mechanisms

| Priority | Mechanism | Action | Status |
| --- | --- | --- | --- |
| P0 | Regression coverage | Production-wrapper StrictMode test asserts real chart OHLC input | DONE |
| P0 | Lifecycle structure | Effect creates/disposes the instance; commands use current ref | DONE |
| P0 | Knowledge capture | Hook, Dataset and quality specs contain the executable rule | DONE |

### 4. Systematic Expansion

A source scan for render-created owners and UI `dispose()` cleanup found no second current instance of this pattern. No broad controller refactor is justified by this defect. Future reviews of effect-cleaned owners should check the production wrapper, not only direct Module tests.

### 5. Knowledge Capture

Updated `.trellis/spec/frontend/hook-guidelines.md`, `free-replay-dataset.md`, and `quality-guidelines.md`. This repository has no `src/templates/markdown/spec/` directory, so there is no template sync target.
