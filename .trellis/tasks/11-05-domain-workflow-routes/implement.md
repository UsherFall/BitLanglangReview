# Implement — Domain workflow Route Modules

- [x] 1. Add `route-support.ts` and `tests/route-test-utils.ts`; keep helpers behavior-identical.
- [x] 2. Extract review/tag routes and add direct tests.
- [x] 3. Extract Free Replay instruments/session/library routes and add direct tests, preserving #5 cascade wiring.
- [x] 4. Extract candle/drawing routes and add direct validation/board tests.
- [x] 5. Extract scan/config/market-heat routes and add order/parsing tests.
- [x] 6. Extract bitget config/sync/trades with key/sync Adapters and add isolation tests.
- [x] 7. Reduce `app-plugin.ts` to construction + exact-order registration calls; delete moved imports/helpers and shadow handlers.
- [x] 8. Run focused route + service/store suites and `npx tsc --noEmit`.
- [x] 9. Run raw and established runnable full tests sequentially, `git diff --check`, and full registration/API inventory review.
- [x] 10. Update API spec + parent map, commit independently, archive, then start #7.

## Review gates

- Exactly 15 registrations in the same order; scan/config precedes scan.
- No route handler remains in the root, no production Store/Service is constructed by tests, and no response shape changes.
- Bitget tests cannot read real keys or instantiate BitgetClient; DELETE uses only the atomic SessionStore cascade.
- No generic Router, no response DTO migration (#7), no weakened existing assertion.

## Rollback points

1. Keep each extracted Module + tests green before root composition.
2. If root wiring fails, compare the registration inventory before changing handler behavior.
3. Revert the single work commit to restore the monolithic route root; no runtime/data rollback needed.
