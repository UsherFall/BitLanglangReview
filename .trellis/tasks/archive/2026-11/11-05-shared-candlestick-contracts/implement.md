# Implement — Shared response and Candlestick contracts

- [x] 1. Add neutral Session types and migrate Panel/App/lifecycle/SessionStore while preserving re-exports.
- [x] 2. Move TradeResponse and Paper Round response types into domain; adopt them in App, routes and server derivation.
- [x] 3. Move `timeframeMs` and generic `mergeCandles` into `domain/candlestick.ts`; replace all three merge implementations and two duration maps with imports/re-exports.
- [x] 4. Add `tests/candlestick-contracts.test.ts` for exact durations and merge semantics.
- [x] 5. Run focused contracts/routes/stores/UI suites and `npx tsc --noEmit`; inspect for duplicate implementations and domain dependency violations.
- [x] 6. Run raw and established runnable full tests sequentially plus CRLF-aware `git diff --check`.
- [x] 7. Update domain spec and parent map, commit independently and archive.
- [x] 8. Perform parent-level final integration review across #1–#7, update cross-child acceptance and archive the parent after final journal/commit bookkeeping.

## Review gates

- Domain has no UI/Server/runtime imports; no duplicate `timeframeMs` or `mergeCandles` implementation remains.
- SessionStore returns `FreeReplaySession[]`; save input excludes `updatedAt`; API/UI response fields are unchanged.
- `1M` remains nominal 30d and merge key remains timestamp only.
- No old assertion is relaxed and compatibility re-exports continue to compile.

## Rollback points

1. Stop on any type mismatch that reveals an actual payload divergence; document and preserve behavior rather than casting it away.
2. Keep pure tests green before changing Adapters.
3. Revert the single work commit to restore local implementations; no data rollback is needed.
