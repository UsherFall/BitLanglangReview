# Thinking Guides

Cross-cutting prompts for changes that span layers or introduce repeated patterns. These guides supplement the concrete layer specs under `domain`, `server`, and `frontend`.

## Available Guides

| Guide | Purpose | When to Use |
| --- | --- | --- |
| [Code Reuse Thinking Guide](./code-reuse-thinking-guide.md) | Identify existing helpers and reduce duplication | Before adding a helper, config, constant, or repeated branch |
| [Cross-Layer Thinking Guide](./cross-layer-thinking-guide.md) | Trace data contracts across UI, API, services, stores, and tests | When a feature changes payloads, persistence, market data, or chart behavior |

## Project-Specific Triggers

Read the cross-layer guide when changing any of these flows:

- Source Workbook row -> `Trade` -> Review Queue -> sidebar list.
- Review Editor -> `/api/reviews` -> `ReviewStore` -> Review Progress.
- Chart navigation -> `/api/candles` -> `CandlestickService` -> Candlestick Cache -> chart render.
- Free Replay instrument/start time -> OKX instruments/candles -> cursor reveal/rewind.
- Chart Drawing overlay -> `/api/drawings` -> `DrawingStore` -> instrument-level redraw.

Read the code reuse guide before adding a second implementation of timeframe math, candle merging, queue filtering, or API payload parsing.

## Verification Rule

Every cross-layer claim should be checked against source or tests before acting on it. Useful anchors include `CONTEXT.md`, `tests/review-queue.test.ts`, `tests/candlestick-cache.test.ts`, `tests/trade-import.test.ts`, `tests/free-replay-chart.test.ts`, and `tests/app-free-replay.test.tsx`.