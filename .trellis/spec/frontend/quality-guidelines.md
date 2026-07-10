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
- Drawings remain instrument-level and appear across trades/timeframes for the same Instrument.

When changing Free Replay, verify:

- Future candlesticks remain hidden until reveal.
- Rewind cannot move before the start cursor.
- Trade markers are not rendered.
- Switching Review Timeframes maps the cursor to the containing candlestick.

## Forbidden Patterns

Do not move Review Store state into the Source Workbook. Do not introduce a global frontend store unless repeated prop/state wiring becomes a real maintenance problem. When changing Review Timeframe UI, verify `1m` remains first in the selector and uses the same 150-candle initial window/on-demand loading behavior as other timeframes.

## Existing Risk To Notice

Several Chinese literals in source and tests are mojibake in the current checkout. Preserve exact existing string values when changing nearby behavior so tests and workbook parsing remain stable. Fixing encoding should be a deliberate separate change with tests, not incidental cleanup.

When adding or rewriting tests around Chinese UI text, prefer stable structural queries (`aria-label`, role, class-scoped controls, or numeric/value assertions) over copying mojibake literals. If a test file must be rewritten from scripts on Windows, write it explicitly as UTF-8 without BOM; PowerShell defaults can produce invalid UTF-8 and make Vitest fail before tests run.
