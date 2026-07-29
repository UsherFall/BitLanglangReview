# Hover price percentage

## Goal

When the reviewer moves the mouse over the Free Replay candlestick chart, show the percentage move from the latest revealed candlestick close to the price level under the mouse pointer. This lets the reviewer quickly judge how far a potential target, stop, or support/resistance level is from the current replay market price without drawing a line or calculating manually.

## Confirmed Facts

- The app is a React/Vite UI using `lightweight-charts` in `src/ui/App.tsx`.
- The main chart components are `TradeChart` for completed Trade Review and `FreeReplayChart` for Free Replay.
- `TradeChart` already subscribes to `chart.subscribeCrosshairMove` and shows a `CandlestickReadout` for the candlestick under the crosshair.
- `FreeReplayChart` does not currently show a candlestick readout, but Free Replay state already exposes `replay.cursorTime` and the current replay candle is used elsewhere for paper-trading market actions.
- Existing drawing conversion helpers can convert a pointer coordinate to a chart price through `series.coordinateToPrice(y)`.
- `lightweight-charts` 5.2.0 provides coordinate conversion, crosshair move events, price lines, and `PriceScaleMode.Percentage`, but the package does not expose a built-in "show percent from current price to hovered price" measurement widget.
- Existing price formatting helpers live in `src/ui/candlestick-readout.ts` and `src/ui/chart-price.ts`; related tests exist in `tests/candlestick-readout.test.ts` and app-level chart tests.

## Requirements

- Only the Free Replay chart should show the hover percentage readout.
- The baseline price must be the close of the latest revealed Free Replay candlestick, i.e. the candlestick represented by the replay cursor after timeframe switching.
- The feature must not use unrevealed future candlesticks as the baseline.
- The chart should display a live percentage value while the pointer is inside the chart and over a valid price coordinate.
- The percentage should update as the pointer moves vertically and should disappear when the pointer leaves the chart or the price coordinate is invalid.
- The display should be hidden while candlestick data is loading, empty, or otherwise lacks a valid latest revealed close.
- The percentage should be formatted with an explicit sign and exactly two decimal places, for example `+2.35%` or `-0.08%`.
- The readout should sit beside the Free Replay chart's top-left toolbar/readout area as a stable small overlay, not follow the mouse pointer.
- The feature should preserve existing chart navigation, drawing, zoom, scroll, log-scale toggle, and price-scale reset behavior.
- Charts that display entry/exit markers should provide a toolbar button to hide and show those markers without changing candlestick data or drawings.
- Free Replay paper trading should let the reviewer set a stop-loss order after a position is open.
- Stop-loss orders should trigger automatically when a newly revealed candlestick touches the stop price.
- If a newly revealed candlestick touches both the stop-loss price and an existing exit limit price, the stop-loss order should execute first.

## Acceptance Criteria

- [ ] Moving the pointer inside the Free Replay chart shows a signed percent move from the latest revealed candlestick close to the pointer price.
- [ ] Moving the pointer vertically changes the percentage without requiring a click.
- [ ] Leaving the chart hides the percentage display.
- [ ] If no latest revealed candlestick close is available, no percentage value is shown.
- [ ] Percentages are shown with an explicit sign and two decimal places.
- [ ] The Trade Review chart remains unchanged and does not show this percentage display.
- [ ] Existing chart drawings, Free Replay chart navigation, and price-scale controls continue to work.
- [ ] The marker visibility button hides and restores entry/exit markers on charts that have them.
- [ ] After opening a Free Replay paper position, the reviewer can set and cancel a stop-loss price.
- [ ] A long position stop loss closes automatically when a newly revealed candlestick low is at or below the stop price.
- [ ] A short position stop loss closes automatically when a newly revealed candlestick high is at or above the stop price.
- [ ] If the same revealed candlestick touches both stop-loss and exit-limit prices, stop loss closes the position first.
- [ ] Focused tests cover percentage calculation, formatting, and at least one UI integration path.

## Out of Scope

- Trade Review percentage display.
- Mouse-following tooltip behavior.
- Using hidden future candlestick data as the percentage baseline.
