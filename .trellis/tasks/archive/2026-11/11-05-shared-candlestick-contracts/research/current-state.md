# Current state — shared contracts

Date: 2026-11-05

## Exact duplicates

| Contract | Current owners | Required neutral owner |
| --- | --- | --- |
| `FreeReplayStart`, `FreeReplaySessionPayload`, `FreeReplaySession` | `ui/FreeReplayPanel.tsx` + a divergent `server/free-replay-session-store.ts` type | new `domain/free-replay-session.ts` |
| Trade queue response | local `TradeResponse` in `ui/App.tsx`; route constructs the same shape implicitly | `domain/review-queue.ts` as `TradeResponse` |
| Paper Round session/library response | `ui/FreeReplayPanel.tsx` + `server/paper-rounds.ts` (`PaperRoundSession` / `PaperRoundLibrary`) | `domain/paper-round.ts` |
| Nominal `timeframeMs` | identical maps in `ui/chart-time.ts` and `server/candlestick-service.ts` | `domain/candlestick.ts` |
| Timestamp merge | identical last-write-wins + ascending functions in `ui/free-replay-chart.ts`, `ui/OtherCoinChart.tsx`, `server/review-candle-source.ts` | generic `mergeCandles` in `domain/candlestick.ts` |

The server Session type currently calls its updated row `FreeReplaySessionPayload` (including `updatedAt`), while UI distinguishes `FreeReplaySession` from the save payload. The neutral model makes that distinction explicit:

- `FreeReplayStart`: instrument/source/start/data anchors/progress/cursor;
- `FreeReplaySessionPayload = FreeReplayStart & { timeframe, paperTrading }`;
- `FreeReplaySession = FreeReplaySessionPayload & { updatedAt }`;
- `SaveFreeReplaySessionInput = FreeReplaySessionPayload`.

## Compatibility constraints

- `1M` is a NOMINAL 30-day duration, not a calendar-month or closed-bar rule. Existing exchange-specific closed-bar and Candle Grid logic must not move or change.
- Merge is by `timestamp` ONLY, last write wins, ascending output. Do not add instrument/timeframe/venue to the key: current callers already scope their datasets and rely on this exact behavior.
- Generic server merge accepts any `{ timestamp: number }`; the neutral helper must preserve that rather than narrowing to only `Candlestick`.
- UI and Server re-exports remain as compatibility Adapters where imports already exist. The pure domain must not import React, Vite, SQLite or fetch.
- No response field additions/removals. `PaperRoundLibraryResponse.reviews` stays OPTIONAL at the UI/API boundary; the server derivation continues to require and return it.

## Baseline

```text
npx vitest run tests/chart-time.test.ts tests/free-replay-chart.test.ts tests/review-candle-source.test.ts tests/paper-rounds.test.ts tests/free-replay-session-store.test.ts tests/free-replay-routes.test.ts tests/review-routes.test.ts tests/bitget-routes.test.ts
8 files / 57 tests passed
```

## Direct tests

Add `tests/candlestick-contracts.test.ts`:

- every ReviewTimeframe's exact nominal duration, including 1m and 1M=30 days;
- unsorted input produces ascending output;
- duplicate timestamp uses the last object;
- input array is not mutated;
- generic `{timestamp, payload}` objects retain their concrete type and payload.

Type correctness of response contracts is enforced by using them on BOTH route and UI/Store sides and running `npx tsc --noEmit`; existing route/store/UI suites provide runtime compatibility.
