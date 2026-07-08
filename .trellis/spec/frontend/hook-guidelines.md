# Hook Guidelines

## Effect Boundaries

Effects in this app usually bind one external concern: fetching an API payload, creating a chart, syncing the selected trade row, or registering keyboard/chart events. Keep those concerns separate so dependencies stay reviewable.

Examples:

- `src/ui/App.tsx` fetches `/api/trades` whenever queue filters change.
- `src/ui/ReviewEditor.tsx` resets draft tags and note when `trade.id` changes.
- `src/ui/FreeReplayPanel.tsx` fetches instruments once and creates the `flatpickr` instance once.
- Chart effects in `src/ui/App.tsx` subscribe to lightweight-charts events and clean up subscriptions on unmount.

## Refs Versus State

Use refs for mutable integration state that should not re-render the tree on every pointer move or chart event: chart APIs, series APIs, loaded candle arrays, pending render flags, active drag state, pointer location, and debounce timers.

Use React state for values shown in the UI or used by JSX: selected trade, filters, timeframe, review mode, status text, drawing tool, selected drawing, draft point, loaded/rendered Free Replay candles, and review editor draft fields.

## Data Fetching

The frontend uses direct `fetch`; there is no React Query or SWR layer. Convert query objects to `URLSearchParams` at the boundary, as `App.tsx` does for `/api/trades`, `/api/candles`, and `/api/drawings`.

When an effect can race with user navigation, guard stale work with a stable key or ref. `TradeChart` uses `activeKeyRef` to avoid applying stale candlesticks after `trade.id` or timeframe changes.

## Event Handlers

Keyboard shortcuts belong to Free Replay mode only and should ignore focused form controls. Follow the `ArrowRight` and `ArrowLeft` handler in `App.tsx`.

Pointer and chart event handlers should preserve navigation stability. Before applying delayed candle renders, capture the current visible range and navigation anchor, then restore the range after `series.setData`.

## Common Mistakes

Do not place chart API objects in state. Do not let effect dependencies recreate charts during normal prop changes. Do not fetch more candles while `suppressAutoLoadRef` is active during programmatic range changes.