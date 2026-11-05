# Design — Domain workflow Route Modules

## 1. Route support

New `src/server/route-support.ts` owns only reusable HTTP/review composition:

```ts
send(res, status, body): void;
readBody(req): Promise<string>;
toQueueOptions(params): ReviewQueueOptions;
tagPayload(store, reviews): { tags: string[]; tagCounts: Record<string, number> };
```

No route matching abstraction. Scan keeps `parseOptionalNumber`; Bitget keeps `trimOrEmpty`; `buildPerSource` and workbook discovery stay in `app-plugin.ts`.

## 2. Registration Modules

```ts
registerReviewRoutes(server, deps): void                 // 1–4
registerFreeReplayInstrumentRoutes(server, deps): void   // 5
registerCandleRoutes(server, deps): void                 // 6
registerDrawingRoutes(server, deps): void                // 7
registerFreeReplaySessionRoutes(server, deps): void      // 8–9
registerScanRoutes(server, deps): void                   // 10–12
registerBitgetRoutes(server, deps): void                 // 13–15
```

All take `ViteDevServer` and an explicit dependency object. The two split Replay/chart registration functions exist only to preserve the old interleaving; their code remains grouped by workflow file.

### Dependency boundaries

- **Review:** workbook `Trade[]`, `ReviewStore`, `scopedReviewsForModule`.
- **Free Replay:** SessionStore, ReviewStore, scope callback, Binance metadata factory, OKX instrument service, Bitget ticker source.
- **Chart:** CandlestickService, Binance/Bitget candle sources, metadata factory, DrawingStore.
- **Scan:** per-source CoinScanService and MarketHeatService maps + `defaultSource`.
- **Bitget:** ReviewStore, BitgetPositionStore, scope callback, key load/save/clear Adapters, `createSyncService(keys)` factory.

The Bitget factory prevents route tests from constructing `BitgetClient` or touching real key files. Other services are the existing concrete instances supplied by the root.

## 3. Composition root

`app-plugin.ts` retains workbook loading, every Store/Service construction, source maps and `scopedReviewsForModule`. At the exact positions in the inventory it calls the seven registration functions with those dependencies. Route-specific imports/helpers leave the root.

This is constructor/composition extraction, not a second router: each Module calls the same `server.middlewares.use(path,handler)` with the same handler body.

## 4. Direct harness

`tests/route-test-utils.ts`:

- captures route + handler registrations into a Map and ordered list;
- invokes a handler with a `Readable` request (method/url/JSON body);
- captures status, headers and JSON response through a structural `ServerResponse`;
- casts only the fake server to `ViteDevServer` at the test boundary.

No Vite boot, production data root, external network or real Bitget keys.

Focused suites:

1. `review-routes.test.ts` — POST review success + scoped tag composition / 405.
2. `free-replay-routes.test.ts` — Session DELETE exact cascade args + response; instruments can be covered with an injected source Adapter.
3. `chart-routes.test.ts` — candle 400 and Drawing GET/POST board validation / success with an in-memory Store.
4. `scan-routes.test.ts` — exact registration order, config-only source, invalid scope and valid parsed service call.
5. `bitget-routes.test.ts` — configured=false queue without position reads and key validation / adapter behavior.

## 5. Compatibility and rollback

All handler bodies move byte-for-byte in behavior, with only dependency names changing. The atomic cascade added in #5 remains a single `deleteSessionWithPaperReviews` call. No response-type neutralization occurs until #7.

Implement support + one Module + its tests at a time, then convert the root once all registration functions exist. Rollback is a single child work commit; no data or API migration.
