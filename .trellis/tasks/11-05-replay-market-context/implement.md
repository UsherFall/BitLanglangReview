Active task: .trellis/tasks/11-05-replay-market-context

# Implementation Plan — Replay market context

## Executor Brief

This document is the execution handoff for DeepSeek. Work only on this child task after the user approves the final planning summary and Trellis status is `in_progress`.

The deliverable is a compatibility-first source/grid mapping and its regression tests. Do not expand it into a Free Replay rewrite, server route refactor, native-Binance candidate-chain fix, or generic chart abstraction.

### Required reading order

1. Every entry in `implement.jsonl`.
2. `.trellis/tasks/11-05-replay-market-context/prd.md`.
3. `.trellis/tasks/11-05-replay-market-context/design.md`.
4. `.trellis/tasks/11-05-replay-market-context/research/current-state.md`.
5. This file.

The large `frontend/component-guidelines.md` and `server/market-data.md` documents are intentionally summarized in `research/current-state.md` rather than injected with truncation. When more detail is needed, read only their Other Coin / Free Replay and source-selection / Bitget-as-chart-source sections.

If dispatching a Trellis sub-agent, its prompt must begin with the `Active task:` line above. If executing inline, load the same specs through the platform's before-development flow.

## Scope Guard

Expected product files:

- `src/domain/candlestick.ts`
- `src/ui/chart-market-context.ts` — new
- `src/ui/free-replay-chart.ts`
- `src/ui/OtherCoinChart.tsx`
- `src/ui/FreeReplayPanel.tsx` — domain type import / Session source typing only
- `src/ui/App.tsx` — FreeReplayChart mapping and one OtherCoinChart prop only

Expected test files:

- `tests/chart-market-context.test.ts` — new
- `tests/free-replay-chart.test.ts` — only if an existing assertion needs a non-semantic import adjustment
- `tests/other-coin-chart.test.tsx`
- `tests/app-free-replay.test.tsx`

Expected documentation near completion:

- `.trellis/spec/frontend/component-guidelines.md` or `.trellis/spec/frontend/state-management.md`, recording the single chart market mapping and explicit Replay Other Coin source inheritance.

Do not edit server product code, SQLite files, package dependencies, Vite config, unrelated UI, or the parent task's future deliverables.

## Ordered Checklist

### 0. Confirm activation and baseline

- [ ] Run `python3 ./.trellis/scripts/task.py current --source`; confirm it names `.trellis/tasks/11-05-replay-market-context` and `task.json` is `in_progress`. If it is still `planning`, stop and request plan approval instead of editing product code.
- [ ] Read `git status --short`; do not overwrite or mix with unrelated user changes.
- [ ] Establish the focused baseline:

```bash
npx vitest run tests/free-replay-chart.test.ts tests/other-coin-chart.test.tsx tests/app-free-replay.test.tsx tests/chart-time.test.ts
npx tsc --noEmit
```

Record pre-existing failures or `act(...)` warnings rather than treating them as this task's regressions.

### 1. Add failing regression tests first

- [ ] Add `tests/chart-market-context.test.ts` with the exact four-row truth table from `design.md` §2.2. Initially this Module does not exist, so the test is red by construction.
- [ ] Add the Other Coin Chart `binance-only` + `1D` regression from `design.md` §5.2. Use literal expected UTC timestamps for the visible range and assert list venue `binance`, requestSource `binance-only`.
- [ ] Add the table-driven App restored-Session composition test from `design.md` §5.3 for OKX, Bitget, explicit `binance-only`, and missing-source legacy. Reuse existing fetch/session helpers where possible, but do not weaken assertions to fit current broken behavior.
- [ ] Run the new focused tests. Confirm OKX and legacy composition cases fail for the current default-Bitget panel reason, and the UTC grid case fails for the same source inheritance reason. Bitget should remain the control.
- [ ] Preserve the failing output or a short note in the task journal / handoff as red-green evidence.

**Rollback point A:** if the tests do not expose the current defect, stop and fix the test setup before touching product code. Do not claim coverage from a test that passes for unrelated reasons.

### 2. Add shared types and the pure mapping

- [ ] In `src/domain/candlestick.ts`, retain `CandleSourceId` and add `ReplayCandleSource` plus `ChartCandleSource` exactly as designed.
- [ ] Create `src/ui/chart-market-context.ts` with an exhaustive source → `{ venue, requestSource, grid }` mapping. Keep it pure and free of React, fetch, lightweight-charts creation, or Session lookup.
- [ ] Run `npx vitest run tests/chart-market-context.test.ts`; all four mappings must pass.

### 3. Route existing Replay helpers through the mapping

- [ ] Move `ReplayCandleSource` type ownership to the domain import in `free-replay-chart.ts` and `FreeReplayPanel.tsx`; type `FreeReplayStart.candleSource` accordingly.
- [ ] Keep `replayCandleSource` control flow unchanged but narrow its Session input field and return type to `ReplayCandleSource`; apply the same input typing to `replayCandleGrid` so no OtherCoinChart cast or new invalid-string fallback is needed.
- [ ] Delegate `replayCandleGrid` to `chartMarketContext(...).grid`, and derive the exported default/legacy grid constants from the same mapping without changing their values.
- [ ] Run `npx vitest run tests/free-replay-chart.test.ts tests/chart-time.test.ts tests/chart-market-context.test.ts`.

**Rollback point B:** this step must be behavior-preserving. If legacy or default grid tests fail, fix the mapping/delegation before migrating chart callers.

### 4. Migrate FreeReplayChart without changing its protocol

- [ ] In `src/ui/App.tsx` FreeReplayChart, derive `market` from `replayCandleSource(replay)` and `requestInstrument` from `market.requestSource`.
- [ ] Replace all main Replay Candlestick request sources with `market.requestSource` and the focus `entryVisibleRange` grid with `market.grid`.
- [ ] Do not alter Cursor, focus, dual datasets, loading flags, `rangeKey`, suppression, viewport tokens, marker points, or effect ordering.
- [ ] Do not add the fresh `market` object to effect dependency arrays; use the existing primitive Session source and timeframe dependencies.
- [ ] Run focused Replay tests before moving to the panel:

```bash
npx vitest run tests/app-free-replay.test.tsx tests/free-replay-chart.test.ts tests/chart-time.test.ts
```

### 5. Make Other Coin Panel inherit the active Session

- [ ] Widen `OtherCoinChart.candleSource` to `ChartCandleSource` and resolve its default as `candleSource ?? (isReplay ? FREE_REPLAY_CANDLE_SOURCE : 'okx')`.
- [ ] Derive `{ venue, requestSource, grid }` exclusively from `chartMarketContext(source)`.
- [ ] Remove `replayCandleSource(null)`, its cast, the independent grid ternary, and `requestSource = venue`.
- [ ] Keep instrument listing on `venue`, all Candlestick requests on `requestSource`, and Review Window calculations on `grid`.
- [ ] In App's Free Replay OtherCoinChart call, pass `candleSource={replayCandleSource(freeReplay)}`. Leave Scan and Trade Review call sites' source values unchanged.
- [ ] Update nearby prop comments so `binance` versus `binance-only` and standalone defaults are explicit; do not claim that `binance` is direct Binance.

### 6. Run focused verification and inspect behavioral diff

- [ ] Run:

```bash
npx vitest run tests/chart-market-context.test.ts tests/free-replay-chart.test.ts tests/other-coin-chart.test.tsx tests/app-free-replay.test.tsx tests/chart-time.test.ts
npx tsc --noEmit
```

- [ ] Verify the previously red OKX, explicit/implicit legacy, and UTC-grid cases are now green, while Bitget and existing `candleSource="binance"` controls remain green.
- [ ] Inspect `git diff` for App.tsx: only mapping derivation, requestSource substitutions, grid substitution, and the single OtherCoinChart prop should appear. Revert incidental chart-protocol edits.
- [ ] Confirm no expectation was changed from `binance` to `binance-only` in old non-Replay Other Coin tests.

**Rollback point C:** if behavior outside source selection changes, return to the last green step instead of patching unrelated Cursor or viewport logic.

### 7. Full quality gate

- [ ] Run the complete suite and type check:

```bash
npm test
npx tsc --noEmit
git diff --check
```

- [ ] Run `git status --short` and review the complete diff. Only scoped source, test, task, and spec files may remain.
- [ ] Compare results with the baseline. Existing `act(...)` warnings may be reported as pre-existing noise; new failures are blocking.
- [ ] Perform the project quality check (`trellis-check` sub-agent where supported, otherwise the equivalent inline checklist) using `check.jsonl`, PRD acceptance criteria, and the full diff.

### 8. Spec update and delivery

- [ ] Update the relevant frontend spec with three executable rules: one chart source mapping owns venue/requestSource/grid; Replay Other Coin Panel receives the Session source explicitly; `binance` and `binance-only` remain distinct request policies. `CONTEXT.md` already states the product invariant and needs no new term unless the implementation introduces one.
- [ ] Mark which PRD acceptance criteria have direct test evidence. Do not mark unchecked items as complete.
- [ ] Prepare one focused commit containing product code, regression tests and the related spec update. Do not mix the next architecture child task into it.
- [ ] Report: changed files, red-green evidence, focused/full commands and results, any pre-existing warnings, and residual deferred native-Binance issue.
- [ ] Follow the normal Trellis commit / finish flow for this child only. Do not archive the parent; create child task 2 only after this child is accepted.

## Forbidden Shortcuts

- Do not fix the panel by hard-coding `source=okx`, `source=bitget`, or `source=binance-only` in App.
- Do not keep `replayCandleSource(null)` and add another special-case fallback on top.
- Do not map every Binance spelling to `binance-only`; `binance` must retain its existing candidate-chain request policy.
- Do not pass `binance-only` to `/api/free-replay/instruments`; that route's venue vocabulary uses `binance`.
- Do not memoize away effect-loop symptoms without identifying which fresh object caused them.
- Do not rewrite existing Replay tests, delete chart mocks, or relax future/rewind assertions to get green.
- Do not change Session persistence, API responses, calendar-month math, symbol translation, or Chart Drawing boards.

## Completion Evidence Template

```text
Red evidence:
- <test names and pre-fix failure reason>

Implementation:
- <files and one-line responsibility per file>

Verification:
- focused: <count / result>
- full: <count / result>
- tsc: <result>
- diff check: <result>

Acceptance:
- AC1..AC7: <evidence mapping>

Residual / deferred:
- native-Binance candidate-chain semantics remain unchanged
- pre-existing act(...) warnings: <unchanged / details>
```
