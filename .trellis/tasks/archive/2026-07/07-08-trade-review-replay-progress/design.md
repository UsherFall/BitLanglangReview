# Technical Design

## Scope

This task changes only the frontend layer:

- `src/ui/App.tsx` for Trade Review keyboard panning and Review Progress rendering.
- `src/ui/review-progress.ts` for reviewed profit calculation.
- `src/ui/styles.css` for compact progress metric styling if needed.
- Tests under `tests/` for progress calculation, UI display, save updates, and chart keyboard movement.

No server, domain model, workbook import, or SQLite persistence changes are required.

## Trade Review Keyboard Panning

Add a Trade Review keyboard handler that moves the current `TradeChart` visible range by one candle step:

- The handler should be active for Trade Review only. The simplest boundary is inside `TradeChart`, because `TradeChart` only renders in Trade Review mode.
- Ignore keyboard events when `event.target` is `INPUT`, `SELECT`, or `TEXTAREA`, matching the existing Free Replay shortcut guard in `App.tsx`.
- On `ArrowRight`, read `chart.timeScale().getVisibleRange()`, add `timeframeMs(timeframe) / 1000` to `from` and `to`, and call `chart.timeScale().setVisibleRange()`.
- On `ArrowLeft`, subtract the same step.
- Prevent default browser behavior only when the key is handled and the chart has a valid visible range.

This is view movement only. It must not mutate candle arrays, marker arrays, drawing data, selected Trade, or Free Replay cursor state.

## On-Demand Loading Compatibility

Do not add a keyboard-specific fetch path. `setVisibleRange()` should cause the existing `subscribeVisibleLogicalRangeChange` handler in `TradeChart` to run. That handler already checks the visible range against loaded candle boundaries and calls `loadMore('earlier' | 'later')`.

Keep `suppressAutoLoadRef` semantics intact:

- Initial programmatic range setup still suppresses auto-load.
- Keyboard panning should not set `suppressAutoLoadRef`; otherwise edge loading would be blocked.

## Review Progress Profit

Extend `ReviewProgress` in `src/ui/review-progress.ts` with `reviewedProfit: number`.

Implementation rule:

- A trade is reviewed if `isReviewedTrade(trade)` is true.
- `reviewedProfit` is the sum of `trade.profit` for reviewed trades in the current queue.
- The current position and reviewed count behavior remains unchanged.

In `App.tsx`, render the value in the existing `.review-progress` panel:

- Label: `已复盘收益`.
- Value: signed fixed two-decimal USDT amount.
- Positive values use a positive tone class; negative values use a negative tone class; zero can use neutral/default styling.

Add a small formatter near existing `formatPercent` / `formatLeverage`, for example `formatSignedUsdt(value: number)`.

## Data Flow

1. `/api/trades` returns `ReviewedTrade[]` for the current Review Queue.
2. `App` derives `progress = reviewProgress(data.trades, selectedTrade?.id ?? '')`.
3. `Review Progress` renders `progress.current`, `progress.reviewed`, `progress.total`, and `progress.reviewedProfit`.
4. `ReviewEditor` saves tags through `/api/reviews`.
5. `handleReviewSaved` replaces the matching trade review in local state.
6. `reviewProgress` recomputes reviewed count and reviewed profit from the updated queue.

## Compatibility Notes

- Free Replay keyboard shortcuts remain owned by the existing `reviewMode === 'freeReplay'` effect in `App.tsx`.
- Trade Review keyboard panning should not fire while Free Replay is mounted because `TradeChart` is not rendered in Free Replay mode.
- The existing Chinese literals in code/tests should be preserved unless a test needs a new label for `已复盘收益`.
