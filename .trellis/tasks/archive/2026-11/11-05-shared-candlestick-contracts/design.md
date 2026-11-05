# Design — Shared response and Candlestick contracts

## 1. Domain types

New `src/domain/free-replay-session.ts` imports only type-level Candlestick/Trade/Paper Trading contracts and exports `FreeReplayStart`, `FreeReplaySessionPayload`, `FreeReplaySession`.

`ui/FreeReplayPanel.tsx` re-exports them for existing consumers; App and the lifecycle hook may import the domain directly. The Panel keeps its own React props and source selection behavior.

`server/free-replay-session-store.ts` uses `FreeReplaySession<unknown, string>` for list/save results and `FreeReplaySessionPayload<unknown, string>` for save input, preserving its opaque legacy JSON contract without weakening the strict UI defaults. SQL rows map through the shared source types; JSON parsing remains at the persistence boundary with no schema change.

## 2. Queue and Library responses

Add to `domain/review-queue.ts`:

```ts
type TradeResponse = {
  trades: ReviewedTrade[];
  instruments: string[];
  tags: string[];
  tagCounts: Record<string, number>;
  configured?: boolean;
};
```

App removes its local duplicate. Review and Bitget routes annotate their response objects with this type, so the shared contract is enforced on both sides.

Add to `domain/paper-round.ts`:

```ts
type PaperRoundSessionRow = { instrument; startTime; updatedAt; roundCount };
type PaperRoundLibraryResponse = {
  rounds: PaperRound[];
  sessions: PaperRoundSessionRow[];
  tags: string[];
  tagCounts: Record<string, number>;
  reviews?: TradeReview[];
};
```

`server/paper-rounds.ts` aliases its session type to the domain row and its derivation result to a Pick requiring `rounds`/`sessions`/`reviews`. The API's optional `reviews` compatibility remains unchanged.

## 3. Candlestick pure functions

Add to `domain/candlestick.ts`:

```ts
function timeframeMs(timeframe: ReviewTimeframe): number;
function mergeCandles<T extends { timestamp: number }>(candles: readonly T[]): T[];
```

The duration map is exactly the two existing maps. Merge uses one Map keyed only by timestamp and ascending sort, preserving last write and concrete generic objects.

Compatibility Adapters:

- `ui/chart-time.ts` and `server/candlestick-service.ts` re-export `timeframeMs`;
- `ui/free-replay-chart.ts` re-exports `mergeCandles`;
- `OtherCoinChart.tsx` and `server/review-candle-source.ts` import the domain function and delete private copies.

No calendar/closed-bar code moves.

## 4. Verification

New direct pure tests cover the exact duration map, merge ordering, duplicate winner, generic payload preservation and input non-mutation. Type adoption is checked on both API and UI/Store sides with `npx tsc --noEmit` and existing route/store suites.

Full regression includes chart-time, free-replay chart/dataset, OtherCoin, review-candle-source, Paper Round derivation, Session lifecycle/store, all route suites and App Replay before the full suite.

## 5. Rollback

One child work commit revert restores the old local duplicates; there is no runtime/data migration. If any behavior differs, stop at the affected Adapter instead of changing domain semantics to match a mistaken refactor.
