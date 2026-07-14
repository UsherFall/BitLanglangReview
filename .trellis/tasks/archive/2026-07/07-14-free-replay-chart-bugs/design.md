# Free Replay Chart Bugs Design

## Architecture And Boundaries

This task stays inside the UI layer.

- `src/ui/App.tsx` owns `FreeReplayChart`, Free Replay timeframe switching, chart viewport updates, and paper marker rendering.
- `src/ui/free-replay-paper-trading.ts` owns paper trading state helpers and marker generation.
- `src/ui/chart-time.ts` owns timeframe timestamp mapping and should remain the shared mapping contract for Trade Review, drawings, and Free Replay paper markers.
- `src/ui/free-replay-chart.ts` owns pure Free Replay cursor/candle visibility helpers.

Trade Review chart behavior is a regression boundary, not an implementation target.

## Data Flow

1. `FreeReplayPanel` emits a `FreeReplayStart` containing `instrument`, `startTime`, `startCursorTime`, and `cursorTime`.
2. `App` stores it as `freeReplay` and resets `freeReplayCandles` plus paper trading session only at a new Free Replay start.
3. `FreeReplayChart` fetches initial candles for `instrument + timeframe + data anchor`, then renders `visibleCandlesForFreeReplay(renderedCandles, replay.cursorTime)`.
4. `paperMarkers` are derived in `App` from `paperTrading.trades`, current `timeframe`, and latest `freeReplayCandles`.
5. `FreeReplayChart` calls `markersRef.current?.setMarkers(paperMarkers)` whenever data/cursor/timeframe/markers change.

## Viewport Contract

Initial Start Free Replay viewport should use the current replay cursor as the right-side anchor. The visible range must include the current cursor and reserve approximately 10 current-timeframe bars to the right.

When switching timeframe, the data-load anchor and the right-side replay boundary must use the pre-switch replay progress. In code terms, old `freeReplay.cursorTime` is mapped through `freeReplayCursorTimeForTimeframeSwitch(...)` to the new timeframe cursor. The initial candle fetch for the new timeframe should be centered around that progress anchor, not around `replay.startTime` and not around paper trade marker times.

Recommended implementation shape:

- Extract or locally reuse one range calculation for cursor-anchored Free Replay ranges.
- Initial range should not depend on loaded-history size.
- Cursor-advance range should preserve the current visible span, keeping existing zoom behavior.
- Programmatic `setVisibleRange` calls must keep using `suppressAutoLoadRef` to avoid triggering earlier/later autoload loops.

## Marker Contract

Free Replay paper marker identity is based on original trade event timestamps and current timeframe mapping.

- Preserve `paperTrading` across timeframe switches.
- Recompute markers from `paperTrading.trades`, current `timeframe`, and current `freeReplayCandles`.
- Use `markerTimeForEvent` as the single mapping contract.
- Keep filtering out markers whose mapped time is after `freeReplay.cursorTime`.
- Do not use paper marker times as inputs for Free Replay candle loading or viewport right-edge selection.

## Compatibility Notes

- No storage migration.
- No API change.
- No change to OKX candle fetching contract.
- No change to Trade Review marker semantics.

## Risks

- If initial viewport uses too-wide a span, the bug can appear fixed in tests but remain poor for dense data. Tests should assert cursor inclusion and right-side padding, not just that `setVisibleRange` was called.
- If markers are tested only at the pure helper layer, React memo/update bugs can slip through. Add at least one App-level test that observes `createSeriesMarkers().setMarkers` after a timeframe switch.
