# Component Guidelines

## Components In This App

The UI is a dense local review tool, not a marketing site. Components should keep the first screen usable for reviewing trades or starting Free Replay. Match the existing two-pane structure in `src/ui/App.tsx`: a sidebar for mode, filters, queue, and replay setup; a workspace for chart, timeframe controls, metrics, drawings, and review editing.

## Props And Data Flow

Use typed inline props for small components and exported types when another file needs the shape. `ReviewEditor` accepts a `ReviewedTrade` and an `onSaved` callback. `FreeReplayPanel` exports `FreeReplayStart` because `App.tsx` stores that shape.

Prefer callbacks that report completed domain events instead of exposing component internals:

- `ReviewEditor` calls `onSaved(review)` after `/api/reviews` returns a `TradeReview`.
- `FreeReplayPanel` calls `onStart(start)` after it maps the selected start time to a containing candlestick through `freeReplayCursorTimeForStart`.

## Chart Components

`TradeChart` and `FreeReplayChart` inside `App.tsx` integrate with `lightweight-charts`. Keep imperative chart objects in refs (`chartApiRef`, `seriesRef`, marker refs, overlay refs) and keep React state for UI state that affects rendering or controls.

Important local patterns:

- Create and remove the chart in a mount-only `useEffect`.
- Use refs for loaded/rendered candlestick arrays when event handlers need current data without re-subscribing every render.
- Preserve the Chart Navigation Anchor when applying on-demand loaded candlesticks. See `visibleRangeForAnchor` and `visibleRangeForLatestAnchor` in `src/ui/chart-navigation-anchor.ts`.
- In Free Replay, show only candles through the Free Replay Cursor. Use `visibleCandlesForFreeReplay` from `src/ui/free-replay-chart.ts`.

## Styling And Accessibility

Use existing class names and extend `src/ui/styles.css`. Buttons that contain icons should use `lucide-react`, as shown by `Save`, `ChevronDown`, `ChevronUp`, `Minus`, `Slash`, and `Eraser`.

Inputs that do not have visible English text still need accessible labels. Existing examples include `aria-label` on review tag/note fields in `src/ui/ReviewEditor.tsx` and the Free Replay start input in `src/ui/FreeReplayPanel.tsx`.

## Common Mistakes

Do not put pure chart or queue math directly into JSX when it can be tested as a helper. Do not show trade entry or exit markers during Free Replay; `Free Replay Chart Context` in `CONTEXT.md` explicitly excludes them. Do not make Review Notes count as reviewed; Review Progress is driven by tags.