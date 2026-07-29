# Implementation Plan

## Checklist

- [x] Read frontend specs required by `trellis-before-dev` before editing.
- [x] Add a chart-scale helper for default price scale options, reset, and mode application.
- [x] Import `PriceScaleMode` from `lightweight-charts` and wire Normal/Log state into `FreeReplayChart` and `TradeChart`.
- [x] Add compact icon controls near the existing drawing toolbar: reset price scale and Normal/Log toggle, with `title`/`aria-label` attributes.
- [x] Ensure reset applies Normal mode, `autoScale: true`, and default scale margins in both chart modes.
- [x] On timeframe changes, reset price scale and avoid stale manual scale state carrying across timeframe reloads.
- [x] Add a time-scale helper for preserving visual candle density across timeframe switches using bar spacing / chart width / visible candle count.
- [x] Fix Trade Review timeframe switching to preserve candle visual width and anchor around the previous visible center.
- [x] Fix Free Replay timeframe switching to preserve candle visual width and anchor around `replay.cursorTime` with right-side padding.
- [x] Fix Free Replay initial positioning so first Start Free Replay uses a default cursor-anchored window with right-side padding.
- [x] Fix Free Replay cursor-follow so timeframe switches cannot reuse a stale visible time span and blow up the chart.
- [x] Add focused tests for helper behavior and React wiring in both chart modes.

## Verification Results

- `npm test -- tests/chart-scale.test.ts tests/chart-time-scale.test.ts tests/app-chart-price.test.tsx tests/app-free-replay.test.tsx tests/app-review-progress.test.tsx` passed.
- `npm test -- tests/chart-time-scale.test.ts tests/app-free-replay.test.tsx tests/app-review-progress.test.tsx tests/app-chart-price.test.tsx tests/app-drawings.test.tsx` passed after switching zoom preservation to visible logical range.
- `npm test -- tests/chart-time-scale.test.ts tests/app-free-replay.test.tsx tests/app-review-progress.test.tsx tests/app-chart-price.test.tsx tests/app-drawings.test.tsx` passed after changing timeframe switches to use destination `setVisibleLogicalRange` instead of time ranges.
- `npm test` passed: 25 files, 93 tests.
- `npx tsc --noEmit` passed.

## Validation Commands

- `npm test -- tests/chart-viewport.test.ts tests/app-chart-price.test.tsx tests/app-free-replay.test.tsx`
- `npm test`

## Risky Files

- `src/ui/App.tsx`: large file with both chart components; avoid unrelated refactors.
- `tests/app-free-replay.test.tsx`: existing chart mocks may need `priceScale()` support.
- `tests/app-chart-price.test.tsx`: existing chart creation assertions may need updates for new options or mocks.

## Review Gate

- Do not run `task.py start` until the user approves this PRD/design/implementation plan or asks to implement.
