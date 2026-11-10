# Quality Guidelines

## Test Expectations

Use Vitest for frontend logic and React component behavior. Existing trusted examples:

- `tests/review-editor.test.tsx` for saving tags and notes through the editor.
- `tests/app-review-progress.test.tsx` and `tests/app-free-replay.test.tsx` for app-level flows.
- `tests/chart-time.test.ts`, `tests/chart-autoload.test.ts`, `tests/chart-navigation-anchor.test.ts`, and `tests/free-replay-chart.test.ts` for chart behavior that should remain pure and deterministic.
- `tests/trade-markers.test.ts` for timeframe candlestick placement of entry/exit markers.

Run `npm test` after changes. The project currently has no separate lint script.

## Required Checks For UI Changes

When changing trade review charts, verify:

- Entry and exit markers are placed on the containing candlestick for the active Review Timeframe.
- On-demand loading can expand both earlier and later without changing the Chart Navigation Anchor.
- Drawings remain instrument-level **within their board** (10/26: `scan` = 选品抽屉, `review` = 复盘/回溯) and appear across trades/timeframes for the same Instrument on that board; the two boards never show each other's lines, and only the `scan` board feeds the 距线 column. Cross-timeframe appearance also holds at RENDER time (10/28): a line whose anchor is outside the loaded candles of the current timeframe must still draw — the app-level test mock must make `timeToCoordinate` return null outside the loaded candles, or the extrapolation path (`coordinateForTime`) is never exercised.

When changing Free Replay, verify:

- The production-entry `<StrictMode>` initial mount renders real Candlesticks; effect replay must not reuse a Dataset disposed by the first cleanup.
- Session lifecycle changes run the direct `renderHook` suite for trailing saves, restore, stale-PUT deletion and cursor commands, then the unchanged App Replay characterization.
- End/resume review (11/10) must freeze BOTH the controls and lifecycle commands: ended blocks every Paper Dispatch plus reveal/rewind (buttons AND Arrow keys, no future retry/fills), keeps position/pending orders/stops unchanged, persists across restore, and an ended same-key restore is a complete no-op. Order Focus, drag/zoom and timeframe viewing stay available; resume never auto-starts a never-started Paper session.
- Future candlesticks remain hidden until reveal.
- Rewind cannot move before the start progress, and cannot move AT ALL while `paperTrading.active` (11/03: button + keyboard ← both locked, function-level guard in `rewindFreeReplayCandle`).
- The 焦点单 pre-entry view (剪刀按钮, 11/03) keeps the two boundaries straight: render/magnet filter strictly below `positionOpenTime` (the candle OPENING at `positionOpenTime` is already the future), later-paging gate one step earlier than that (no request storm), auto-resets on focus exit, and never leaks into the session save payload.
- Historical TRADE markers are not rendered; paper-fill open/close points ARE — each anchored to the loaded candle CONTAINING the fill instant (`eventTime - 1`, never the progress→cursor mapping), dropped when that candle is not loaded or is later than the reveal cursor (11/02).
- Paper round annotations (11/04) write the ROUND id (`paper:{instrument}:{startTime}:{positionId}`), so every fill row of one round shares its tags/star; the star toggle must not open the editor, and the library row must send `module: 'paper'` so tag counts stay module-scoped.
- Switching Review Timeframes preserves true Free Replay `progressTime`, maps the display cursor to the latest complete candlestick whose end time is not after that progress, and clears the focused order (11/04 — the viewport must land on the cursor right edge, and the first anchor must wait for the new period's data instead of anchoring on the still-rendered old period candles).

## Forbidden Patterns

Do not move Review Store state into the Source Workbook. Do not introduce a global frontend store unless repeated prop/state wiring becomes a real maintenance problem. When changing Review Timeframe UI, verify `1m` remains first in the selector and uses the same 150-candle initial window/on-demand loading behavior as other timeframes.

## Existing Risk To Notice

Several Chinese literals in source and tests are mojibake in the current checkout. Preserve exact existing string values when changing nearby behavior so tests and workbook parsing remain stable. Fixing encoding should be a deliberate separate change with tests, not incidental cleanup.

When adding or rewriting tests around Chinese UI text, prefer stable structural queries (`aria-label`, role, class-scoped controls, or numeric/value assertions) over copying mojibake literals. If a test file must be rewritten from scripts on Windows, write it explicitly as UTF-8 without BOM; PowerShell defaults can produce invalid UTF-8 and make Vitest fail before tests run.

**jsdom does not simulate CSS `pointer-events`.** A test can assert that a click handler fires on an element with `pointer-events: none`, and it will pass in jsdom even though the handler is unreachable in a real browser. When a fix relies on `pointer-events` to route clicks (e.g., SVG overlay deselection), always verify the behavior manually in the dev server — do not trust a passing jsdom test alone. If the behavior must be tested, consider an integration flag or a separate attribute (`data-testid`) that doesn't depend on CSS hit-testing.

**`.test.tsx` matcher setup.** `vitest.config.ts` currently has no `setupFiles`, so `@testing-library/jest-dom` matchers (`toBeInTheDocument`, `toHaveValue`, `toHaveTextContent`, …) are **not** registered. Every `.test.tsx` that relies on them fails at runtime in a bare environment (e.g. local Node 24 / Vitest 4 `vmForks` pool) — this is a config gap, not a code regression. The domain-level `tests/*.test.ts` (plain Node env) still run green and are the trusted signal for logic changes. Before trusting a failing `.test.tsx`, confirm jest-dom is imported in a setup file or via a global registration; fixing the test runner setup is a deliberate separate change, not incidental to a feature task.
