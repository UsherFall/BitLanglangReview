# API Plugin

## Route Ownership

`src/server/app-plugin.ts` is the Vite construction/composition root for the `trading-review-api` Plugin. It constructs Stores/Services/Adapters and calls the workflow registration functions below; HTTP handlers live in those Modules, not as shadow handlers in the root. Reusable persistence or market-data behavior stays in store/service files.

| Order | Registration | Workflow file |
| --- | --- | --- |
| 1–4 | `registerReviewRoutes` — trades, reviews, tag rename/delete | `review-routes.ts` |
| 5 | `registerFreeReplayInstrumentRoutes` | `free-replay-routes.ts` |
| 6 | `registerCandleRoutes` | `chart-routes.ts` |
| 7 | `registerDrawingRoutes` | `chart-routes.ts` |
| 8–9 | `registerFreeReplaySessionRoutes` — sessions + Paper Round Library | `free-replay-routes.ts` |
| 10–12 | `registerScanRoutes` — scan/config, scan, market-heat | `scan-routes.ts` |
| 13–15 | `registerBitgetRoutes` — config, sync, trades | `bitget-routes.ts` |

Preserve this exact registration order. `/api/scan/config` MUST precede `/api/scan` because Connect matches prefixes. Split Replay/chart registration exists to preserve the old interleaving, not to create a second Router.

`route-support.ts` owns only `send`, `readBody`, `toQueueOptions` and `tagPayload`. Dependencies enter each registration as an explicit object; Bitget key functions and sync-service creation are Adapters injected by the root so route tests never touch real keys or construct a network client.

Current routes:

- `GET /api/trades` builds the Review Queue and returns `trades`, source workbook `instruments`, and saved `tags`.
- `GET /api/bitget/trades` is the same Review Queue contract for the Bitget source: it maps cached `bitget_positions` rows to `Trade`s and additionally returns `configured: boolean`.
- `GET /api/bitget/config` returns `{ configured: boolean }` (never key material). `POST /api/bitget/config` accepts `{ apiKey, secret, passphrase }` (all required, ≤256 chars) and writes `data/bitget-keys.json`. `DELETE /api/bitget/config` clears the file.
- `POST /api/bitget/sync` accepts `{ startTime?: ms, wipe?: boolean }` (default: now − 90 days), pulls Bitget `history-position` windows, and returns `{ fetchedRows, uniqueRows, fromMs, toMs }`. Errors surface as HTTP 502 with the exchange `msg` (e.g. invalid key / passphrase / IP whitelist).
- `POST /api/reviews` saves tags and one note for a Trade. Accepts an optional `module: 'trade' | 'bitget'` and answers `{ review, tags, tagCounts }` — the saved review PLUS the module-scoped tag list and per-tag counts (same `scopedReviewsForModule` + `tagPayload` helpers the tag rename/delete routes use), so the UI can patch its tag counts in place after an add/remove instead of leaving a stale 「N 笔」.
- `GET /api/free-replay/instruments` returns OKX SWAP instruments.
- `GET /api/free-replay/sessions` lists saved Free Replay sessions (`updated_at` desc); `PUT` upserts one keyed by `instrument` + `startTime`, accepts `reviewStatus: 'active' | 'ended'` (missing = `active`, anything else = 400) and returns the normalized status explicitly; `DELETE` removes one keyed by `instrument` + `startTime` **and atomically cascades its Paper Round reviews away** through `freeReplaySessionStore.deleteSessionWithPaperReviews(..., 'paper:{instrument}:{startTime}:')`, answering `{ ok: true, deletedReviews }`. Both deletes use one SQLite transaction, so a review failure rolls the session deletion back. The prefix carries the TRAILING COLON — without it a session whose start time merely shares the leading digits loses a neighbouring session's annotations.
- `GET /api/paper/rounds` (11/04) is the 模拟单库: every CLOSED **Paper Round** across all replay sessions, merged with its saved review. Query filters: `tag`, `starred=yes|no`, `session={instrument}:{startTime}`. Answers `{ rounds, sessions, reviews, tags, tagCounts }` — `sessions` is the sessions that actually hold closed rounds (the 来源会话 dropdown, computed BEFORE filtering so narrowing never empties it), `reviews` is EVERY `paper:`-scoped review including open-round ones (the client rehydrates in-replay 单子 rows from it), and `tags`/`tagCounts` are the `paper` module scope. Round market data is derived per request by `buildPaperRoundLibrary` (`src/server/paper-rounds.ts`) from `free_replay_sessions.paper_trading_json`; only the annotations touch SQLite.
- `POST /api/reviews` with `module: 'paper'` saves a **Paper Round** annotation, answering the same `{ review, tags, tagCounts }` shape scoped to the `paper:` prefix; `POST /api/tags/rename` and `/api/tags/delete` also accept `module: 'paper'` and rewrite paper rows through the same global tag rename/delete.
- `GET /api/candles` returns initial, earlier, or later candlesticks. An optional `source=okx|binance` query selects the exchange (default `okx`). `binance` is the personal review path: it runs the Binance-then-OKX candidate chain of `src/server/review-candle-source.ts` (see `market-data.md`), so a symbol Binance renamed or delisted still charts from OKX; when no source has data the route answers `502 { error }` with each source's reason. An instrument that is not a `*-USDT-SWAP` symbol returns `{ candles: [] }`.
- `GET /api/scan` runs a instrument scan (选品). V1 supports only `method=shrink`; full contract in `coin-scan.md`.
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

`tests/route-test-utils.ts` captures `middlewares.use` registrations and invokes handlers with `Readable` requests plus a structural response. Use the focused `tests/*-routes.test.ts` suites for registration order, parsing, response composition and dependency wiring without booting Vite, loading a workbook, opening production SQLite or reading real Bitget keys.

Required high-value anchors: review save + scoped tags, atomic Session DELETE cascade args, Candle 400 / Drawing board isolation, scan/config-before-scan + source parsing, and unconfigured Bitget queue / key validation. Existing service/store/domain tests still own deeper business rules; App-level React tests remain additional compatibility coverage, not a replacement for direct route tests.