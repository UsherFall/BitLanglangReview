# Chart Scale Reset and Visual Options Design

## Scope

This task changes only the frontend chart integration in `src/ui`. It covers both chart surfaces in `src/ui/App.tsx`: `FreeReplayChart` and `TradeChart`.

## Architecture

- Add a small chart-scale helper module, likely `src/ui/chart-scale.ts`, to keep price scale behavior testable outside React.
- Use `lightweight-charts` native price scale APIs:
  - `chart.priceScale('right').applyOptions(...)` or `series.priceScale().applyOptions(...)`.
  - `PriceScaleMode.Normal` for default/reset.
  - `PriceScaleMode.Logarithmic` for Log toggle.
- Keep visual scale mode as React-local state per chart instance. No localStorage persistence in this task.
- Share the same reset/toggle helper between Free Replay and Trade Review to avoid two subtly different implementations.

## Data Flow

1. Chart component mounts and creates the `lightweight-charts` chart.
2. Chart initializes with explicit right price scale defaults: Normal mode, autoscale enabled, and agreed scale margins.
3. User clicks Log toggle:
   - React state flips between Normal and Log.
   - Helper applies `mode` and `autoScale: true` to the right price scale.
4. User clicks reset:
   - React state returns to Normal.
   - Helper applies Normal mode, autoscale enabled, and default scale margins.
5. Timeframe changes:
   - Candle loading and time-range initialization proceed as today.
   - Price scale reset runs after or alongside the timeframe-specific chart data/range reset.
   - Time scale zoom density is preserved by carrying forward the current bar spacing or visible candle count instead of carrying forward the old time span.

## Timeframe Switch Positioning

- Preserve visual candle size across timeframe switches, matching common trading chart behavior.
- Use `chart.timeScale().options().barSpacing` where available as the source of visual zoom density.
- Estimate visible candle count from chart width and bar spacing when an explicit logical range is not reliable.
- Recompute visible time range in the destination timeframe using `timeframeMs(nextTimeframe)` and the preserved visible candle count.
- Trade Review anchor: previous visible center time. This respects where the user was looking before switching timeframe.
- Free Replay anchor: `replay.cursorTime`, with about 10 destination-timeframe candle slots of right-side padding.
- Do not preserve old visible time span across timeframe switches; old time span is the likely source of exaggerated zoom changes when timeframe duration changes.

## Free Replay Initial Positioning

- Initial visible range should be derived from `replay.cursorTime` and `timeframeMs(timeframe)`, not from an old `getVisibleRange()` span.
- Cursor should start visible with roughly 10 future candle slots to the right.
- The cursor-follow effect must be gated so timeframe changes do not reuse stale visible span from the previous timeframe.
- Reset `cursorFollowInitRef` or replace it with a range-key based guard tied to `instrument:startTime:timeframe` so each timeframe gets a clean initialization.

## Compatibility

- Existing drawing overlay continues to use `series.priceToCoordinate` and `series.coordinateToPrice`; those APIs should work under both Normal and Log modes.
- Existing paper trading markers and trade markers remain unchanged.
- Existing time-axis navigation and auto-load thresholds remain unchanged except where Free Replay range initialization currently causes incorrect positioning.

## Trade-Offs

- Defaulting reset to Normal means users lose a manually selected Log state when pressing reset. This matches the product decision that reset is a full recovery action.
- Not persisting Log mode reduces scope and avoids surprising future sessions. Users can re-enable Log when needed.
- Explicit button-based reset is more reliable than relying on price-axis double-click behavior, and it is easier to test in jsdom.
- Preserving bar spacing on timeframe switches is closer to professional charting tools than a fixed 150-left/10-right window. The trade-off is slightly more implementation complexity because each chart mode needs a different anchor.

## Rollback Shape

- Price scale changes are isolated to helper calls and toolbar buttons. Rollback can remove the helper, state, and buttons without touching server or domain code.
- Free Replay range bug fixes are isolated to initialization/follow effects and related tests.
