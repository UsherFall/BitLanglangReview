# Server Specs

Guidance for `src/server`, the local Vite middleware and persistence layer.

## Read These Files

| Guide | Use When |
| --- | --- |
| [API Plugin](./api-plugin.md) | Adding or changing `/api/*` routes |
| [Persistence And Imports](./persistence-and-imports.md) | Changing SQLite stores or Source Workbook import |
| [Market Data](./market-data.md) | Changing OKX instruments, candlestick fetching, or cache behavior |

## Scope

The server layer runs inside the Vite dev server through `tradingReviewApiPlugin` in `src/server/app-plugin.ts`. It is a local review tool backend, not a deployed multi-user service.

It owns:

- Loading the read-only Source Workbook.
- Persisting Review Store, Candlestick Cache, and Chart Drawings in local SQLite.
- Fetching OKX public market data.
- Returning JSON payloads consumed by React.

It should reuse domain contracts from `src/domain` and keep UI rendering concerns out of `src/server`.