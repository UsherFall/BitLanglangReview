# Free Replay no-future progress model implementation

## Checklist

- [x] Add pure no-future progress helpers in `src/ui/chart-time.ts`.
  - Parse start input into true `progressTime` seconds.
  - Derive display cursor from `progressTime` and Review Timeframe.
  - Compute candle completion time from cursor and Review Timeframe.
- [x] Update `tests/chart-time.test.ts` for no-future boundaries.
- [x] Update `src/ui/free-replay-chart.ts` next/previous helpers to work from display cursor/progress completion.
- [x] Update `tests/free-replay-chart.test.ts` for new reveal/rewind progress behavior.
- [x] Extend `FreeReplayStart` and `FreeReplayPanel` to emit `progressTime`.
- [x] Refactor `App.tsx` Free Replay state transitions.
  - Start stores true progress and derived cursor.
  - Timeframe switch preserves progress and derives cursor.
  - Next updates both progress and cursor.
  - Previous rewinds progress by current timeframe semantics and derives cursor.
  - Initial candle load anchors on progress.
  - Visible candles, viewport follow, prefetch, markers, and current candle use derived cursor.
- [x] Update paper trading helpers to accept event time for starts, order creation, market fills, and limit fills.
- [x] Update `tests/app-free-replay.test.tsx` for cross-timeframe no-future behavior and paper price/time semantics.
- [x] Update changed frontend specs after implementation to replace containing-candle Free Replay cursor guidance.

## Validation

- `npm test -- chart-time free-replay-chart app-free-replay free-replay-paper-trading`
- `npm test`

## Risk areas

- `App.tsx` is large and shares Trade Review and Free Replay chart code. Keep changes scoped to Free Replay branches.
- Existing Chinese strings are mojibake in tests. Preserve existing string literals and avoid new assertions against those strings.
- Timestamps cross seconds/milliseconds boundaries. Keep conversions explicit.
- Existing specs still describe old Free Replay containing-candle behavior; update specs only after tests pass.
