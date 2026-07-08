# Directory Structure

## Current Layout

```text
src/
  domain/    Pure trade, review, candlestick, drawing, and queue types/helpers.
  server/    Vite middleware, workbook import, SQLite stores, OKX services.
  ui/        React components, chart integration, browser state, CSS.
tests/       Vitest unit and component tests mirroring source layer names.
```

Frontend files live in `src/ui`. Keep UI-only chart math in small `.ts` helpers beside the components so it can be tested without rendering React. Existing examples are `src/ui/chart-time.ts`, `src/ui/chart-autoload.ts`, `src/ui/chart-navigation-anchor.ts`, `src/ui/candlestick-readout.ts`, `src/ui/free-replay-chart.ts`, `src/ui/review-progress.ts`, and `src/ui/trade-markers.ts`.

## Module Boundaries

`src/ui/App.tsx` is currently the application shell and chart host. It is acceptable to add local helpers there when they are tightly coupled to the chart instance, refs, or overlay event handling. When logic can be expressed as pure data transformation, extract it to a sibling helper and cover it with a focused test.

Follow the existing split:

- Components use `.tsx`: `App.tsx`, `ReviewEditor.tsx`, `FreeReplayPanel.tsx`.
- UI helpers use lowercase kebab-case `.ts`: `chart-time.ts`, `trade-markers.ts`.
- Shared contracts come from `src/domain`, not from UI files.
- Styling is centralized in `src/ui/styles.css` with class names used by React components.

## Naming

Use domain terms from `CONTEXT.md`: Trade, Instrument, Review Timeframe, Candlestick, Review Queue, Review Progress, Chart Drawing, Free Replay, and Free Replay Cursor. Avoid alternate terms such as order, ticker, K line, comment, or simulator in new code.

Tests should mirror the unit under test: `src/ui/free-replay-chart.ts` is covered by `tests/free-replay-chart.test.ts`, and `src/ui/review-progress.ts` is covered by `tests/review-progress.test.ts`.