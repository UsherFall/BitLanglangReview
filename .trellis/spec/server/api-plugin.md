# API Plugin

## Route Ownership

`src/server/app-plugin.ts` registers the local JSON API through a Vite `Plugin` named `trading-review-api`. Keep route parsing and HTTP responses in this file; put reusable persistence or market-data behavior in store/service files.

Current routes:

- `GET /api/trades` builds the Review Queue and returns `trades`, source workbook `instruments`, and saved `tags`.
- `POST /api/reviews` saves tags and one note for a Trade.
- `GET /api/free-replay/instruments` returns OKX SWAP instruments.
- `GET /api/free-replay/sessions` lists saved Free Replay sessions (`updated_at` desc); `PUT` upserts one keyed by `instrument` + `startTime`; `DELETE` removes one keyed by `instrument` + `startTime`.
- `GET /api/candles` returns initial, earlier, or later candlesticks.
- `GET /api/scan` runs a coin scan (选币). V1 supports only `method=shrink`; full contract in `coin-scan.md`.
- `GET /api/drawings`, `POST /api/drawings`, and `DELETE /api/drawings` manage instrument-level Chart Drawings.
- `GET /api/alerts` returns `{ alerts, config: { notifierConfigured, monitorIntervalMs } }`; `POST /api/alerts` creates a price alert; `DELETE /api/alerts?id=…` deletes one; `POST /api/alerts/reactivate?id=…` reactivates a triggered alert. Full contract in `price-alert.md` (domain) and the Alert Store section of `persistence-and-imports.md`.

## Gotcha: Connect middleware strips the mount prefix

`/api/alerts` is mounted via connect middleware (Vite's `configureServer`), which strips the mount prefix from `req.url`. Inside the handler the pathname is therefore `/reactivate`, **not** `/api/alerts/reactivate`. Checking `url.pathname === '/api/alerts/reactivate'` is always false and the request falls through to the create-alert branch, returning `400` instead of `200`. Match sub-route pathnames against the stripped form (`url.pathname === '/reactivate'`).

This bug shipped in the initial watchlist-notify implementation and was only caught by a live dev-server request after unit tests all passed — route behavior has no automated HTTP-level test (see Tests). When adding a sub-route under a mounted prefix, verify the stripped pathname.

## Request Parsing

Use `new URL(req.url ?? '', 'http://local')` for query parsing, as the existing routes do. Convert query strings into domain option types at the boundary, then call domain/server helpers.

Validate required fields before invoking services. The candle route must reject missing Instrument, missing Review Timeframe, unsupported Review Timeframe, or missing entry time with HTTP 400.

## Responses And Errors

Use the local `send` helper so JSON responses consistently set `content-type: application/json; charset=utf-8`. Unsupported methods should return 405. Market-data failures should return 502 with an error message, as `/api/candles` and `/api/free-replay/instruments` do.

## Initialization

On server configuration, create `data/`, load trades once from the Source Workbook, and instantiate stores/services against `data/review.sqlite`. Do not modify the Source Workbook; review data belongs in SQLite.

## Tests

App-level route behavior is covered indirectly by React tests and server service tests. When adding a route, prefer focused tests for parsing and behavior rather than broad end-to-end tests unless the route crosses several layers.