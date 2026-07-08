# Domain Specs

Guidance for pure business types and helpers under `src/domain`.

## Read These Files

| Guide | Use When |
| --- | --- |
| [Trade And Review Model](./trade-and-review-model.md) | Changing trades, reviews, drawings, candlesticks, or review timeframes |
| [Review Queue](./review-queue.md) | Changing queue filtering, sorting, or reviewed status rules |

## Scope

The domain layer defines data contracts and deterministic transformations. It must not import React, Vite, filesystem APIs, SQLite, workbook parsing, or `fetch`.

Representative files:

- `src/domain/trade.ts`
- `src/domain/review.ts`
- `src/domain/review-queue.ts`
- `src/domain/build-review-queue.ts`
- `src/domain/candlestick.ts`
- `src/domain/drawing.ts`