# API Plugin

## Route Ownership

`src/server/app-plugin.ts` registers the local JSON API through a Vite `Plugin` named `trading-review-api`. Keep route parsing and HTTP responses in this file; put reusable persistence or market-data behavior in store/service files.

Current routes:

- `GET /api/trades` builds the Review Queue and returns `trades`, source workbook `instruments`, and saved `tags`.
- `GET /api/bitget/trades` is the same Review Queue contract for the Bitget source: it maps cached `bitget_positions` rows to `Trade`s and additionally returns `configured: boolean`.
- `GET /api/bitget/config` returns `{ configured: boolean }` (never key material). `POST /api/bitget/config` accepts `{ apiKey, secret, passphrase }` (all required, ≤256 chars) and writes `data/bitget-keys.json`. `DELETE /api/bitget/config` clears the file.
- `POST /api/bitget/sync` accepts `{ startTime?: ms, wipe?: boolean }` (default: now − 90 days), pulls Bitget `history-position` windows, and returns `{ fetchedRows, uniqueRows, fromMs, toMs }`. Errors surface as HTTP 502 with the exchange `msg` (e.g. invalid key / passphrase / IP whitelist).
- `POST /api/reviews` saves tags and one note for a Trade. Accepts an optional `module: 'trade' | 'bitget'` and answers `{ review, tags, tagCounts }` — the saved review PLUS the module-scoped tag list and per-tag counts (same `scopedReviewsForModule` + `tagPayload` helpers the tag rename/delete routes use), so the UI can patch its tag counts in place after an add/remove instead of leaving a stale 「N 笔」.
- `GET /api/free-replay/instruments` returns OKX SWAP instruments.
- `GET /api/free-replay/sessions` lists saved Free Replay sessions (`updated_at` desc); `PUT` upserts one keyed by `instrument` + `startTime`; `DELETE` removes one keyed by `instrument` + `startTime`.
- `GET /api/candles` returns initial, earlier, or later candlesticks. An optional `source=okx|binance` query selects the exchange (default `okx`); `binance` is served by the shared `BinanceCandleSource` after the instrument is mapped with `okxInstrumentToBinanceSymbol` (unmappable instruments return `{ candles: [] }`).
- `GET /api/scan` runs a coin scan (选币). V1 supports only `method=shrink`; full contract in `coin-scan.md`.
- `GET /api/market-heat?anchor=<epochMs>&instrument=<reviewSymbol>` computes the anchor-time market temperature for the review pool (5-tier 温度 + stats + 涨跌榜 + skips). Full contract in `market-heat.md`.
- `GET /api/drawings`, `POST /api/drawings`, and `DELETE /api/drawings` manage instrument-level Chart Drawings.

## Gotcha: Connect middleware strips the mount prefix

When a route is mounted via connect middleware (Vite's `configureServer`), connect strips the mount prefix from `req.url`. Any sub-path parsed from `req.url` is relative to the mount point. Match sub-route pathnames against the stripped form, or use the query string, rather than testing the full `/api/<route>/…` path.

## Request Parsing

Use `new URL(req.url ?? '', 'http://local')` for query parsing, as the existing routes do. Convert query strings into domain option types at the boundary, then call domain/server helpers.

Validate required fields before invoking services. The candle route must reject missing Instrument, missing Review Timeframe, unsupported Review Timeframe, or missing entry time with HTTP 400.

## Responses And Errors

Use the local `send` helper so JSON responses consistently set `content-type: application/json; charset=utf-8`. Unsupported methods should return 405. Market-data failures should return 502 with an error message, as `/api/candles` and `/api/free-replay/instruments` do.

## Initialization

On server configuration, create `data/`, load trades once from the Source Workbook, and instantiate stores/services against `data/review.sqlite`. Do not modify the Source Workbook; review data belongs in SQLite.

## Tests

App-level route behavior is covered indirectly by React tests and server service tests. When adding a route, prefer focused tests for parsing and behavior rather than broad end-to-end tests unless the route crosses several layers.