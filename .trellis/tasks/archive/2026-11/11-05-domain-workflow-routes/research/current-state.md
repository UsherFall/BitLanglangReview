# Current state — Vite route composition

Date: 2026-11-05

## Registration inventory and required order

`src/server/app-plugin.ts` currently owns store/service construction AND every route handler:

| Order | Route(s) | Workflow Module |
| --- | --- | --- |
| 1–4 | `/api/trades`, `/api/reviews`, `/api/tags/rename`, `/api/tags/delete` | `review-routes.ts` |
| 5 | `/api/free-replay/instruments` | `free-replay-routes.ts` (instrument registration) |
| 6–7 | `/api/candles`, `/api/drawings` | `chart-routes.ts` (two registration functions) |
| 8–9 | `/api/free-replay/sessions`, `/api/paper/rounds` | `free-replay-routes.ts` (Session/Library registration) |
| 10–12 | `/api/scan/config`, `/api/scan`, `/api/market-heat` | `scan-routes.ts` |
| 13–15 | `/api/bitget/config`, `/api/bitget/sync`, `/api/bitget/trades` | `bitget-routes.ts` |

There are 15 `server.middlewares.use` calls (not 13 route paths). `/api/scan/config` MUST remain before `/api/scan` because Connect matches prefixes. Other paths keep their original order too, so review can compare the composition mechanically.

## Shared route utilities

- `send` / `readBody` are HTTP-only helpers.
- `toQueueOptions` is shared by Trade and Bitget queues.
- `tagPayload` is shared by review/tag, Paper Library and Bitget responses.
- `parseOptionalNumber` belongs only to scan parsing; `trimOrEmpty` only to Bitget config parsing; `buildPerSource` and workbook discovery stay in the composition root.

These move to a small `route-support.ts` (HTTP + review payload helpers), not a generic Router.

## Dependency seams

`register*Routes(server,deps)` accepts concrete current Stores/Services or narrow structural Adapters. `app-plugin.ts` remains the only construction root. Bitget key functions and sync-service creation are injected so direct route tests never read real keys or construct a network client.

No response DTO migration is needed in this child; shared response-type neutralization belongs to #7.

## Direct test seam

A small `tests/route-test-utils.ts` captures registrations with a fake `middlewares.use`, invokes handlers with `Readable` requests and a structural response, and parses JSON. It tests real route code without booting Vite, loading the workbook, opening production SQLite or touching the network.

High-value cases:

1. Review save returns review + scoped tag payload.
2. Replay DELETE calls the new atomic SessionStore cascade with the exact trailing prefix and preserves `{ ok, deletedReviews }`.
3. Candle validation + Drawing board behavior.
4. Scan config registration order and source parsing / invalid scope.
5. Bitget configured=false queue and config validation, with injected key/sync Adapters.

Existing service/store/domain suites remain authoritative for deeper business rules; route tests own parsing, registration and response composition.

## Rejected approaches

- Generic Router / middleware framework: unnecessary new abstraction and prefix-order risk.
- One route file per endpoint: shallow file movement and duplicated support code.
- Moving Store/Service construction into route Modules: would hide composition and make direct tests boot the world.
- Changing response shapes while extracting: prohibited; #7 handles type ownership separately.
