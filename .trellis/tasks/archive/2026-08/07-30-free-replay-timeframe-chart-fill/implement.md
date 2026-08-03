# Implementation Plan

## Checklist

- [x] Load frontend Trellis specs with `trellis-before-dev` before editing code.
- [x] Add or adjust a Free Replay history-fill decision after timeframe-switch initialization so preserved zoom can request enough earlier candles.
- [x] Reuse `loadEarlierFreeReplayCandles()` and ensure repeated loads only happen when new unique earlier candles are added and the left side still lacks historical coverage.
- [x] Keep `visibleCandlesForFreeReplay` as the display boundary so future candles are never shown just to fill blank space.
- [x] Add focused regression coverage for switching timeframe after zooming out: the chart preserves visible candle count and calls earlier candle loading enough to backfill history.
- [x] Run focused tests around Free Replay and chart time-scale behavior.

## Verification Results

- `npm test -- tests/app-free-replay.test.tsx tests/free-replay-chart.test.ts tests/app-drawings.test.tsx tests/free-replay-panel.test.tsx` passed: 4 files, 25 tests.
- `npm test` passed: 25 files, 107 tests.
- `npx tsc --noEmit` passed.

## Notes

- Segment draft previews now follow the pointer after the first click, while saved segment points still snap to the timeframe-canonical candle times.
- Free Replay start-time picker input no longer closes on every time edit; it closes on Enter.
- TradeChart earlier-load now renders immediately under `suppressAutoLoadRef` instead of delayed `schedulePendingRender()` (removes the 250 ms delay and the old-time-range restore for earlier loads; net visual behavior equivalent, matches the Free ReplayChart deviation).

## Validation Commands

- `npm test -- tests/app-free-replay.test.tsx tests/free-replay-chart.test.ts tests/chart-time-scale.test.ts tests/chart-autoload.test.ts`
- `npm test`

## Risky Files

- `src/ui/App.tsx`: large chart component file; keep edits limited to `FreeReplayChart` loading/range behavior.
- `tests/app-free-replay.test.tsx`: chart mocks are behavior-sensitive; update only the methods needed for the regression.

## Review Gate

Planning is ready after the PRD convergence pass. Implementation can start when the user approves or directly asks to implement.
