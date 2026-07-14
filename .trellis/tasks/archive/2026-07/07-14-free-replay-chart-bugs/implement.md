# Free Replay Chart Bugs Implementation Plan

## Checklist

- [x] Read relevant project specs with `trellis-before-dev` before code changes.
- [x] Add or update App-level test for Start Free Replay initial viewport range containing `cursorTime` with right-side padding.
- [x] Add or update App-level test for paper trade markers after Free Replay timeframe switch.
- [x] Add or update test proving timeframe switch initial candle load is anchored on pre-switch `freeReplay.cursorTime`, not `startTime` or paper marker times.
- [x] Fix Free Replay timeframe switch/data-load anchor wiring in `src/ui/App.tsx` if the new test exposes the current bug.
- [x] Fix marker recomputation/filtering if tests expose stale, missing, duplicated, or wrongly mapped markers. Existing marker behavior remains valid; no marker-source change required.
- [x] Run focused tests for Free Replay/chart-time/paper-trading.
- [x] Run `npm test`.
- [x] Do a final PRD acceptance pass before marking implementation complete.

## Validation Commands

```bash
npm test -- app-free-replay free-replay-paper-trading chart-time free-replay-chart
npm test
```

Latest validation:

- `npm test -- app-free-replay chart-time free-replay-chart free-replay-paper-trading` passed with 28 tests.
- `npm test` passed with 77 tests.

## Risky Files

- `src/ui/App.tsx`: large component with both Trade Review and Free Replay behavior; keep changes narrowly scoped to Free Replay code paths. Timeframe-switch data-load anchor changes should not affect Trade Review `/api/candles` requests.
- `src/ui/chart-time.ts`: shared mapping logic; changing it can affect Trade Review markers and drawings.
- `src/ui/free-replay-paper-trading.ts`: paper trading business rules; avoid changing trading state semantics unless marker tests prove it is required.

## Rollback Points

- Viewport changes can be reverted independently from marker changes if tests isolate them.
- Marker tests should distinguish pure helper correctness from App update wiring so a failure does not force broad refactoring.
