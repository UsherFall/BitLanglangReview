Active task: .trellis/tasks/11-05-free-replay-dataset

# Implementation Plan — Free Replay Dataset

## Executor Brief

This is the DeepSeek execution handoff for architecture child task 2. Do not edit product code until the user approves the final planning summary and this task is `in_progress`.

Deliver a framework-free Dataset Module and migrate FreeReplayChart's data ownership to it. Preserve all existing user-facing chart behavior. Do not expand the work into Viewport, Session lifecycle, a generic chart abstraction or the next architecture tasks.

### Required reading order

1. Every entry in `implement.jsonl`.
2. `.trellis/tasks/11-05-free-replay-dataset/prd.md`.
3. `.trellis/tasks/11-05-free-replay-dataset/design.md`.
4. `.trellis/tasks/11-05-free-replay-dataset/research/current-state.md`.
5. This file.

The large `frontend/component-guidelines.md` and archived Replay designs are summarized in the research file. Read their specific Focus / deferred-render / timeframe sections only when more evidence is needed.

If dispatching a Trellis sub-agent, its prompt must start with the `Active task:` line above. Inline execution must load equivalent before-development specs.

## Scope Guard

Expected product files:

- `src/ui/free-replay-dataset.ts` — new framework-free Module
- `src/ui/free-replay-chart.ts` — reuse the existing merge helper from here
- `src/ui/App.tsx` — FreeReplayChart integration only; no Session lifecycle redesign

Expected tests:

- `tests/free-replay-dataset.test.ts` — new direct Module tests with a deferred fake Candle Loader
- `tests/app-free-replay.test.tsx` — only if a characterization assertion exposes an integration mistake; never weaken existing assertions
- Existing `tests/free-replay-chart.test.ts`, `tests/chart-market-context.test.ts`, `tests/chart-time*.test.ts`, `tests/other-coin-chart.test.tsx` are controls and should not need semantic edits

Expected documentation near completion:

- `CONTEXT.md` — add the durable `Free Replay Dataset` term
- `.trellis/spec/frontend/free-replay-dataset.md` — new focused code-spec with the seven required sections
- `.trellis/spec/frontend/index.md` — link the new spec

Do not change server code, API payloads, SQLite, package dependencies, TradeChart, OtherCoinChart, drawing logic, Paper Trading logic or Viewport algorithms.

## Ordered Checklist

### 0. Activate and establish the branch/baseline

- [ ] Confirm `python3 ./.trellis/scripts/task.py current --source` names this task and `task.json` says `in_progress`. If still `planning`, stop.
- [ ] Confirm child 1 commit `9e627a6` is in history and the working tree has no unrelated changes.
- [ ] Create/record the task branch from the current head that contains child 1. If it does not already exist:

```bash
git switch -c feat/free-replay-dataset
python3 ./.trellis/scripts/task.py set-branch .trellis/tasks/11-05-free-replay-dataset feat/free-replay-dataset
```

If the user has already prepared another branch, use that actual branch instead of recreating it.

- [ ] Run the focused baseline:

```bash
npx vitest run tests/free-replay-chart.test.ts tests/chart-market-context.test.ts tests/app-free-replay.test.tsx tests/chart-time.test.ts tests/chart-time-scale.test.ts tests/chart-navigation-anchor.test.ts tests/other-coin-chart.test.tsx
npx tsc --noEmit
```

Record pre-existing React `act(...)` warnings; do not fix them incidentally.

### 1. Build the direct test surface first

- [ ] Create `tests/free-replay-dataset.test.ts` with a deferred fake `CandleLoader`. The fake must log `URLSearchParams` and let each test resolve/reject individual requests out of order.
- [ ] Add all cases from `design.md` §5: initial publication, range A/B, Focus A/B, Focus exit, Earlier/Later owner capture, every stale page type, Prefetch/retry, pointer defer/flush/control, Focus empty/error, dispose, request matrix and snapshot stability.
- [ ] Include explicit assertions that no stale success, empty response or error can change `status`, Cursor, Active, Rendered, Focus settlement or listener emissions.
- [ ] Run the new tests and record the red result before implementing the Module. If a race test passes against a placeholder or cannot control response order, fix the harness before continuing.

**Rollback point A:** the tests must be able to prove A/B ordering. Do not replace them with synchronous `Promise.resolve` fixtures that cannot expose the original races.

### 2. Implement the standalone Dataset Module

- [ ] Create `src/ui/free-replay-dataset.ts` with the exact responsibilities in `design.md`; no React, DOM or lightweight-charts imports.
- [ ] Default the production Candle Loader to existing `fetchCandles`; allow the deferred fake through the same constructor Interface.
- [ ] Implement cached immutable snapshots and subscription first, then range generation, shared Cursor initial loading, Focus, Earlier/Later, Future, Gap, pointer defer and dispose.
- [ ] Keep `mergeCandles` in `src/ui/free-replay-chart.ts` and import it from Dataset; move App's existing local helper there rather than creating another implementation.
- [ ] Preserve all current request parameters and status messages. Reuse `shouldPrefetchFutureCandles` and `ServerCandleError` rather than duplicating rules.
- [ ] Run `npx vitest run tests/free-replay-dataset.test.ts tests/free-replay-chart.test.ts tests/chart-market-context.test.ts` and make every direct test green before touching App integration.

**Rollback point B:** if the standalone state machine cannot satisfy the tests without leaking viewport/React concerns, stop and correct the Module design instead of adding special cases to App.

### 3. Connect the snapshot and range/Cursor path

- [ ] Instantiate one Dataset per mounted FreeReplayChart and subscribe/dispose in a mount-only effect.
- [ ] Mirror the cached snapshot into React state without creating a new object on every `getSnapshot()` call.
- [ ] Replace the range effect's local Cursor initial loading with `syncRange` at the same effect position and with the existing primitive dependencies.
- [ ] Feed `onCandlesLoaded` from snapshot Cursor and `onActiveCandlesLoaded` from snapshot Rendered. Keep `renderedRangeKey` in the first-anchor guard.
- [ ] Remove `loadedCandles` / `renderedCandles` local state only when their readers have moved to the snapshot; do not leave two mutable read models.
- [ ] Run the App baseline tests and inspect any failure as an integration issue, not a reason to change chart behavior.

### 4. Migrate Focus and Cursor restoration

- [ ] Replace Focus enter/switch/exit effects with `syncFocus(focusRequest)` at the same declaration order.
- [ ] Use snapshot `focusKey` / `focusSettled` / `focusActive` in the existing Focus viewport and backfill gates. Keep `appliedFocusKeyRef` and all actual anchoring math in the chart.
- [ ] Preserve Focus failure/empty fallback and shared Cursor initial in-flight dedupe.
- [ ] Delete replaced Focus/dataset refs and local `publishActive` / `installIntoDataset`; temporary delegation must not survive this step.
- [ ] Run Focus, timeframe and Paper Round characterization tests, especially contiguous-window, App Cursor availability and Cursor restoration cases.

**Rollback point C:** do not patch around a mixed legacy/Dataset owner. Revert the incomplete integration step and return to the green standalone Module plus the last green App step.

### 5. Migrate Earlier / Later / Future / Gap and pointer defer

- [ ] Replace local async loaders with Dataset commands at the existing gesture trigger points. Keep logical-range, history-backfill and gap-trigger keys in the chart.
- [ ] Replace the future effect with `prefetchFuture(replay.cursorTime)` and the cursor-sync effect with `syncCursor`; preserve retry-token wiring and render:false behavior.
- [ ] Mirror physical pointer state through `setPointerDown`; keep pointerup `setTimeout(0)`, pointercancel, blur and chart removal ordering. Call `flushDeferredRender` at the existing release points.
- [ ] Delete all replaced loading refs, pending-render ref, local loader functions and dead imports. Do not alter `shiftVisibleRangeOnNewBar`, reveal/later gates or viewport effects.
- [ ] Run the full focused list from step 0 plus `tests/free-replay-dataset.test.ts`.

### 6. Structural review

- [ ] Grep App for `publishActive`, `installIntoDataset`, `activeCandlesRef`, `cursorCandlesRef`, `focusCandlesRef`, `loadingFutureRef`, `loadingEarlierRef`, `loadingLaterRef`, `loadingWindowRef`, `pendingInstallRenderRef`, `focusInstalledKeyRef`, `focusFailedKeyRef`, `cursorInitialKeyRef`; none should remain in FreeReplayChart.
- [ ] Confirm chart-only refs for chart APIs, pointer coordinates, Viewport tokens and trigger dedupe remain where appropriate. The goal is not an arbitrary ref-count target; it is one data owner.
- [ ] Confirm Dataset has no React/lightweight-charts import and all responses check range generation, with Focus additionally checking focusKey.
- [ ] Inspect every `/api/candles` parameter produced by Dataset against the request matrix and child 1's `chartMarketContext` path.
- [ ] Run `npx tsc --noEmit` and `git diff --check`.

### 7. Full quality gate

- [ ] Run:

```bash
npx vitest run tests/free-replay-dataset.test.ts tests/free-replay-chart.test.ts tests/chart-market-context.test.ts tests/app-free-replay.test.tsx tests/chart-time.test.ts tests/chart-time-scale.test.ts tests/chart-navigation-anchor.test.ts tests/other-coin-chart.test.tsx
npm test
npx tsc --noEmit
git diff --check
```

- [ ] Compare against baseline: focused/full failures are blocking; existing `act(...)` warnings remain separate noise.
- [ ] Review `git status --short` and complete diff for scope, accidental behavior changes, dual ownership, broad `any`, suppressed assertions and unrelated cleanup.
- [ ] Run `trellis-check` where supported, otherwise perform the equivalent inline review using `check.jsonl` and AC1–AC8.

### 8. Capture the contract and deliver

- [ ] Add `Free Replay Dataset` to `CONTEXT.md`: Cursor/Focus/Active/Rendered ownership, Cursor-only App supply, range/focus stale protection and deferred-render meaning. Avoid “global chart store” or “merged focus window”.
- [ ] Create `.trellis/spec/frontend/free-replay-dataset.md` with all seven required sections: Scope / Trigger, Signatures, Contracts, Validation & Error Matrix, Good/Base/Bad Cases, Tests Required, Wrong vs Correct. Include the snapshot fields, command responsibilities, generation/focusKey rules and Adapter contract.
- [ ] Link that spec from `.trellis/spec/frontend/index.md`.
- [ ] Map every AC to direct Dataset or App test evidence; do not mark unverified items complete.
- [ ] Prepare one focused commit such as `refactor(replay): 收拢 Cursor 与 Focus 数据集协议`. Do not include child task 3 work.
- [ ] Report red-green evidence, structural changes, focused/full test counts, tsc/diff results and residual risks. Follow the normal commit / archive / journal flow only after user confirmation.

## Forbidden Shortcuts

- Do not move `publishActive` / `installIntoDataset` into pure functions and leave all async ownership in React; that is a shallow relocation, not this task.
- Do not merge Cursor and Focus arrays, even temporarily, to simplify the snapshot.
- Do not guard only initial loads; Earlier/Later/Prefetch/Gap and error/empty completions need generation checks too.
- Do not check only rangeKey for Focus; same-range Focus A/B requires focusKey validation.
- Do not clear old Rendered on every range change and reintroduce blank flashing; `renderedRangeKey` is the first-anchor guard.
- Do not publish Prefetch into Rendered directly or flush deferred data while pointer is still down.
- Do not introduce a global store, `any`-heavy event bus, new dependency, generic Chart controller or server change.
- Do not alter Viewport math, Cursor/Focus reveal rules, Paper Trading, Session auto-save, API responses or old test expectations to obtain green.

## Completion Evidence Template

```text
Red evidence:
- <Dataset tests that failed before implementation / exposed A/B races>

Structure:
- <Dataset snapshot + Loader Adapter>
- <App refs/functions removed and chart responsibilities retained>

Verification:
- Dataset tests: <count/result>
- focused Replay/chart tests: <count/result>
- full: <count/result>
- tsc: <result>
- diff check: <result>

Acceptance:
- AC1..AC8: <test/evidence mapping>

Residual:
- pre-existing act(...) warnings: <unchanged/details>
- Viewport and Session lifecycle intentionally unchanged
```
