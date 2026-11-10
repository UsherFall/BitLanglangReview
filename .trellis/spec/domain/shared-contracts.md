# Shared Session, Response And Candlestick Contracts

## Scope / Trigger

Read this before changing `domain/free-replay-session.ts`, `domain/review-queue.ts` response types, `domain/paper-round.ts` library response types, or `domain/candlestick.ts` duration/merge helpers. These are pure domain Modules: no React, Vite, SQLite, workbook, filesystem or fetch imports.

## Signatures

```ts
FreeReplayStart = {
  candleSource?: ReplayCandleSource;
  instrument: string;
  startTime: string;
  dataAnchorTime: string;
  startCursorTime: number;
  startProgressTime: number;
  progressTime: number;
  cursorTime: number;
};
FreeReplayReviewStatus = 'active' | 'ended';
FreeReplaySessionPayload<Paper = PaperTradingSession, Timeframe extends string = ReviewTimeframe> =
  FreeReplayStart & { timeframe: Timeframe; paperTrading: Paper; reviewStatus?: FreeReplayReviewStatus };
FreeReplaySession<Paper = PaperTradingSession, Timeframe extends string = ReviewTimeframe> =
  FreeReplaySessionPayload<Paper, Timeframe> & { reviewStatus: FreeReplayReviewStatus; updatedAt: string };

TradeResponse = {
  trades: ReviewedTrade[];
  instruments: string[];
  tags: string[];
  tagCounts: Record<string, number>;
  configured?: boolean;
};
PaperRoundLibraryResponse = {
  rounds: PaperRound[];
  sessions: PaperRoundSessionRow[];
  tags: string[];
  tagCounts: Record<string, number>;
  reviews?: TradeReview[];
};

timeframeMs(timeframe: ReviewTimeframe): number;
mergeCandles<T extends { timestamp: number }>(candles: readonly T[]): T[];
```

## Contracts

1. **Session shape.** `updatedAt` exists only on a saved Session. `reviewStatus` is the reversible `active | ended` freeze state: it is optional on unsaved/legacy payloads and means `active` when absent, while every saved Store/API row carries it explicitly. UI uses the strict default generic parameters; SessionStore explicitly uses `FreeReplaySessionPayload<unknown, string>` / `FreeReplaySession<unknown, string>` for opaque legacy JSON, while PUT routes validate new timeframes and `reviewStatus` and UI restore normalizes Paper Trading.
2. **Adapters.** `FreeReplayPanel`, `ui/chart-time`, `server/candlestick-service` and `ui/free-replay-chart` may re-export domain contracts for compatibility. They must not keep another implementation or divergent response type.
3. **Queue response.** `TradeResponse` is used by App state AND review/bitget route responses; `configured` remains optional and meaningful only for Bitget.
4. **Library response.** API/UI `reviews` stays optional for compatibility; `server/paper-rounds.ts` derivation always returns `rounds`, `sessions` and every Paper Review.
5. **Nominal duration.** Exact map: 1m=60,000; 5m=300,000; 15m=900,000; 1H=3,600,000; 4H=14,400,000; 1D=86,400,000; 1W=604,800,000; 1M=2,592,000,000ms (30 days). Calendar month, Candle Grid and closed-bar logic stay outside this helper.
6. **Merge.** One Map keyed ONLY by timestamp, last object wins, ascending output, no input mutation. Generic payload/object identity is preserved; do not add instrument/timeframe/venue to the key.

## Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Legacy Session without source | Type permits absence; UI restore applies legacy source |
| Legacy Session/payload without reviewStatus | Read/save/restore as `active`; saved rows emit the field explicitly |
| PUT reviewStatus outside `active` / `ended` | HTTP 400 before Store save |
| Store receives opaque/old Paper JSON | Store generic accepts it; route/UI boundaries validate or normalize |
| Unsaved payload | No `updatedAt` required |
| Duplicate timestamps | Last input object wins |
| `1M` duration | Exactly 30 nominal days, never used as a calendar-month completion rule |
| API Library without `reviews` | UI type permits it; current server derivation still supplies it |

## Good / Base / Bad Cases

- **Good:** a route and its UI state both annotate with `TradeResponse`; changing a field is a single type edit.
- **Good:** generic `{timestamp,payload}` merges retain the concrete payload and last duplicate.
- **Base:** existing UI imports continue through a re-export Adapter.
- **Base:** a pre-11/10 Session without `reviewStatus` opens as `active`; `ended` never means `paperTrading.active=false`.
- **Bad:** separate UI and Server `timeframeMs` maps or private `mergeCandles` copies.
- **Bad:** narrowing opaque Store input to the strict UI Paper shape and breaking old sessions/tests.
- **Bad:** adding calendar-month logic to `timeframeMs` or venue fields to the merge key.

## Tests Required

`tests/candlestick-contracts.test.ts` covers every timeframe, exact nominal values, sorting, duplicate winner, generic payload and input non-mutation. Route/Store/UI type adoption is checked with `npx tsc --noEmit`; existing route, SessionStore/lifecycle, chart-time, OtherCoin, review-candle-source and Paper Round suites remain runtime compatibility gates.

## Wrong vs Correct

```ts
// Wrong: strict UI shape leaks into opaque storage input.
type SaveInput = FreeReplaySessionPayload;

// Correct: the Store explicitly names its legacy boundary.
type SaveInput = FreeReplaySessionPayload<unknown, string>;
```

```ts
// Wrong: a second local implementation can drift.
function mergeCandles(candles: Candlestick[]) { /* private copy */ }

// Correct: one generic pure implementation shared by UI and Server.
import { mergeCandles } from '../domain/candlestick';
```
