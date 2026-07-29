# Chart Scale Reset and Visual Options

## Goal

Users can recover a distorted chart after manually dragging the right price scale, especially after switching timeframes away and back, without losing the ability to inspect candles interactively. The chart also exposes a compact logarithmic scale toggle for large-move reviews while keeping Normal scale as the default.

## Background

- The reported problem: dragging the right price scale changes the visible price scale height; after switching timeframes and returning, the chart can look distorted and there is no obvious way to restore the default view.
- Both Trade Review and Free Replay render candlesticks with `lightweight-charts` in `src/ui/App.tsx`.
- Trade Review chart creation configures only `rightPriceScale: { borderColor: '#2D333B' }` at `src/ui/App.tsx:1009`; Free Replay does the same at `src/ui/App.tsx:640`.
- Current timeframe changes reload candles and set a time range: Trade Review sets `chart.timeScale().setVisibleRange(entryRange)` at `src/ui/App.tsx:1073`, and Free Replay initializes a cursor-based range at `src/ui/App.tsx:705`.
- Existing viewport helper `src/ui/chart-viewport.ts` handles time/logical range capture and restore only; it does not cover price scale autoscale or mode.
- `lightweight-charts` exposes native `PriceScaleOptions.autoScale`, `PriceScaleOptions.mode`, and `PriceScaleMode.Logarithmic`, confirmed in `node_modules/lightweight-charts/dist/typings.d.ts:3708`.
- Existing chart-adjacent tests include `tests/app-chart-price.test.tsx`, `tests/chart-viewport.test.ts`, `tests/free-replay-chart.test.ts`, and `tests/app-free-replay.test.tsx`.
- Free Replay cursor-follow logic keeps the cursor 10 candles from the right edge using the current visible span at `src/ui/App.tsx:724`; because the effect only depends on `replay.cursorTime`, a timeframe switch can reuse a stale visible span and overwrite the freshly initialized range.
- Free Replay initial rendering sets visible data to candles through `replay.cursorTime`, adds whitespace at the desired range end, and initializes `setVisibleRange({ from: range.from, to: rangeTo })` at `src/ui/App.tsx:701` through `src/ui/App.tsx:710`; the user reports this can still land far back in history after clicking Start Free Replay.

## Requirements

- R1: Provide an explicit way to restore the right price scale to the normal auto-scaled view after user drag/zoom distortion.
- R2: The restore mechanism must apply to both Trade Review and Free Replay charts.
- R3: Timeframe switching must automatically restore the right price scale to the normal auto-scaled view, and users must also have a compact chart control to reset the price scale manually.
- R4: Any visual controls added to the chart must fit the existing compact chart toolbar style and avoid covering candles, drawings, readout, or paper-trading controls.
- R5: Include logarithmic price scale in MVP as a user-controlled Normal/Log toggle in both chart modes. Default mode is Normal.
- R6: Preserve existing drawing behavior, candle readout, marker rendering, auto-load behavior, and Free Replay cursor behavior while adding chart visual controls.
- R7: Fix intermittent chart blow-up after switching timeframes.
- R8: Fix Free Replay initial chart positioning so clicking Start Free Replay displays the intended positioned candle/window instead of landing far back in history and requiring the user to drag to the far right.
- R9: The manual reset control must restore price scale mode to Normal and enable autoscale.
- R10: Timeframe switching must preserve visual candle zoom density like a trading chart: candles should look roughly the same width after switching timeframe, rather than preserving old time span or forcing a fixed candle count window.
- R11: Free Replay timeframe switching must anchor on the replay cursor with right-side future padding, while Trade Review timeframe switching should anchor around the previous visible center.

## Candidate Visual Ideas

- Price scale reset: one icon button near the drawing toolbar or chart controls that resets the right price scale to normal autoscale.
- Double-click price axis reset: support the familiar chart interaction if `lightweight-charts` can reliably surface it; otherwise keep the explicit button as the dependable path.
- Logarithmic scale toggle: included in MVP; useful for large percentage moves or long review windows while Normal remains the default.
- More readable scale defaults: explicit top/bottom `scaleMargins` to keep candles away from chart edges after reset.
- Better chart affordance state: button selected state for log scale, tooltip titles for reset/log buttons, and no visible instructional copy inside the chart.
- Trading-platform-like timeframe switching: preserve `barSpacing` / visible candle density across timeframe switches, then re-anchor the visible range to the relevant context.

## Acceptance Criteria

- [ ] AC1: In Trade Review, after manually changing the price scale, activating the reset control restores the right price scale to auto-scaled normal view.
- [ ] AC2: In Free Replay, after manually changing the price scale, activating the reset control restores the right price scale to auto-scaled normal view without changing the replay cursor or revealed candles.
- [ ] AC3: Switching timeframes after a manual price-scale distortion automatically resets the right price scale, and the chart does not appear vertically blown up when switching away and back.
- [ ] AC4: Users can toggle Normal/Log scale in both chart modes, and reset returns to Normal mode with autoscale enabled.
- [ ] AC5: Chart controls remain compact, keyboard/mouse accessible, and do not overlap the candlestick readout, drawing overlay, chart status, or paper-trading panel on desktop and narrow layouts.
- [ ] AC6: Starting Free Replay positions the visible chart window around the replay start/cursor area without requiring the user to drag to the far right to find the active candle.
- [ ] AC7: After switching timeframe, candle visual width remains roughly consistent with the pre-switch chart zoom in both Trade Review and Free Replay.
- [ ] AC8: Free Replay timeframe switches keep the replay cursor visible near the right side with future padding; Trade Review timeframe switches keep the previous visible center area in view.
- [ ] AC9: Focused tests cover price scale reset behavior, log mode behavior, timeframe switch zoom preservation, Free Replay cursor anchoring, Trade Review center anchoring, and Free Replay initial positioning.

## Out Of Scope

- Persisting chart visual preferences across browser sessions unless explicitly added later.
- Replacing `lightweight-charts` or building a custom price axis.
- Adding indicators such as MA/EMA/VWAP/volume profile in this task unless the scope is expanded.

## Open Questions

- None blocking.
