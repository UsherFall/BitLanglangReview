# Cross-Layer Thinking Guide

Use this guide when a change crosses domain contracts, Vite API routes, SQLite stores, OKX data, React state, or chart rendering.

## Trace The Contract

For each changed field or behavior, write the path from input to user-visible result.

Common paths in this app:

- Source Workbook row -> `loadTradesFromWorkbook` -> `Trade` -> `buildReviewQueue` -> `/api/trades` -> sidebar trade row.
- Review Editor draft -> `POST /api/reviews` -> `ReviewStore.saveReview` -> `TradeReview` -> local queue update -> Review Progress.
- Chart navigation -> visible range threshold -> `/api/candles` -> `CandlestickService` -> `CandlestickStore` -> merged candles -> chart `setData` -> navigation anchor restoration.
- Free Replay start input -> `freeReplayCursorTimeForStart` -> `/api/candles` -> hidden future candles -> reveal/rewind cursor helpers.
- Drawing overlay pointer event -> `SaveChartDrawingInput` -> `/api/drawings` -> `DrawingStore` -> instrument-level redraw.

## Boundary Questions

Ask these before editing:

- Does the domain type already express this field or state?
- Is the data persisted in SQLite, temporary browser state, or the read-only Source Workbook?
- Is the timestamp in milliseconds, seconds, Shanghai ISO string, or a local input string?
- Does the change affect both Trade Review and Free Replay?
- Should the behavior be instrument-level, trade-level, timeframe-level, or session-only?
- Which focused test already describes the rule?

## Time And Candlestick Rules

Time bugs are the highest-risk cross-layer area in this project. Preserve these rules unless deliberately changing product behavior:

- Source Workbook trade times are normalized to Shanghai ISO strings with `+08:00`.
- Domain/server Candlestick timestamps are milliseconds.
- `lightweight-charts` times are seconds.
- Entry, exit, drawing times, and Free Replay start times belong to the containing Candlestick for the active Review Timeframe.
- Initial Review Window is 150 candles before entry plus 150 after entry.
- On-demand loading must not move the Chart Navigation Anchor.

## Persistence Rules

The Source Workbook is read-only. Review Tags, Review Notes, Candlestick Cache data, and Chart Drawings live in local SQLite.

Do not add browser-only persistence for Review Store data. Do not treat the Candlestick Cache as authoritative market history. Do not save Free Replay sessions unless the product requirement changes; only Chart Drawings survive page reloads.

## Testing Map

Use these tests as regression anchors:

- Workbook import and stable Trade IDs: `tests/trade-import.test.ts`.
- Queue filters and sorting: `tests/review-queue.test.ts`.
- Review persistence: `tests/review-store.test.ts`.
- Candlestick cache, OKX anchors, and contiguity: `tests/candlestick-cache.test.ts`.
- Chart auto-load and navigation anchor: `tests/chart-autoload.test.ts`, `tests/chart-navigation-anchor.test.ts`.
- Timeframe placement and Free Replay cursor behavior: `tests/chart-time.test.ts`, `tests/trade-markers.test.ts`, `tests/free-replay-chart.test.ts`.
- React flows: `tests/app-review-progress.test.tsx`, `tests/app-free-replay.test.tsx`, `tests/review-editor.test.tsx`.

## Review Checklist

Before finishing a cross-layer change, confirm:

- Names match `CONTEXT.md` domain language.
- API payloads are parsed at the route boundary and typed before use.
- Stores serialize and deserialize to domain objects.
- UI state updates reflect the persisted response, not an optimistic shape with different cleanup rules.
- Existing mojibake literals are preserved unless the task is an explicit encoding cleanup.