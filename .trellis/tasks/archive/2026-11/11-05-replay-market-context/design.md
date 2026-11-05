# Design — Replay market context

## 1. Design Summary

Add one pure UI mapping Module that converts a chart source into three explicit values: Instrument List venue, Candle requestSource, and Candle Grid. Use that Module from both FreeReplayChart and OtherCoinChart, and pass the active Free Replay Session source from App to the Other Coin Panel.

The change is intentionally additive and compatibility-first. It does not alter server routes, stored Sessions, fallback policy, Candlestick data, or chart lifecycle.

## 2. Module And Seam

### 2.1 Shared source types

Owner: `src/domain/candlestick.ts`

Add two shared type contracts:

```ts
export type ReplayCandleSource = 'binance-only' | 'okx' | 'bitget';
export type ChartCandleSource = CandleSourceId | ReplayCandleSource;
```

`CandleSourceId` remains unchanged. `ChartCandleSource` is the Other Coin Chart's widened input vocabulary; `ReplayCandleSource` remains the Session vocabulary.

Move the `ReplayCandleSource` type ownership out of `src/ui/free-replay-chart.ts`. Update its UI imports, including `FreeReplayPanel.tsx`, to import the domain type. `FreeReplayStart.candleSource` becomes `ReplayCandleSource | undefined`; the server store's string-based storage contract does not need to change.

### 2.2 Pure chart market context

New Module: `src/ui/chart-market-context.ts`

```ts
export type ChartMarketContext = {
  venue: CandleSourceId;
  requestSource: ChartCandleSource;
  grid: CandleGrid;
};

export function chartMarketContext(source: ChartCandleSource): ChartMarketContext;
```

Implementation should be one exhaustive `Record<ChartCandleSource, ChartMarketContext>` (or equivalently exhaustive mapping), not another chain of venue/grid/requestSource branches spread across callers.

| source | venue | requestSource | grid |
| --- | --- | --- | --- |
| `binance` | `binance` | `binance` | `utc` |
| `binance-only` | `binance` | `binance-only` | `utc` |
| `okx` | `okx` | `okx` | `shanghai` |
| `bitget` | `bitget` | `bitget` | `shanghai` |

Why a separate Module instead of another helper in `free-replay-chart.ts`:

- OtherCoinChart also serves Trade Review and Instrument Scan; it should not need a Replay Session to understand venue/grid mapping.
- The current incorrect dependency is exactly `OtherCoinChart → replayCandleSource(null)`. The new Seam removes that Session lookup entirely.
- The Interface is one input and one small immutable result; the exhaustive table is the Implementation and the direct test surface.

`CandleGrid` stays owned by `chart-time.ts`. This task maps grids only; calendar-month completion and flooring logic must remain in `chart-time.ts`.

## 3. Caller Changes

### 3.1 Free Replay source helpers

File: `src/ui/free-replay-chart.ts`

- Import `ReplayCandleSource` from the domain.
- Type `FREE_REPLAY_CANDLE_SOURCE` as `ReplayCandleSource` and keep its value `bitget`.
- Narrow the `candleSource` field in the `replayCandleSource(...)` / `replayCandleGrid(...)` Session input types to `ReplayCandleSource`, and make `replayCandleSource(...)` return `ReplayCandleSource` instead of `string`; no cast should be needed at the OtherCoinChart call.
- Preserve its three existing branches exactly: explicit Session source → that source; Session with missing source → legacy `binance-only`; no Session → current default Bitget.
- Implement `replayCandleGrid(session)` by delegating to `chartMarketContext(replayCandleSource(session)).grid` so Session grid rules and panel grid rules cannot drift.
- Derive `FREE_REPLAY_CANDLE_GRID` and `LEGACY_REPLAY_CANDLE_GRID` from the same mapping while preserving their exported values; keep symbol translation, Cursor, and future-visibility helpers semantically unchanged.

Do not add new runtime fallback behavior for corrupted persisted source strings in this task. The narrowed types apply to the UI Session contract; the independent server storage payload may keep its existing string field, and existing UI response typing remains the compatibility boundary. Schema validation is a separate concern.

### 3.2 FreeReplayChart

File: `src/ui/App.tsx:1541-2418`

Resolve once per render:

```ts
const market = chartMarketContext(replayCandleSource(replay));
const requestInstrument = replayRequestInstrument(replay.instrument, market.requestSource);
```

Then:

- replace every Candlestick request's `source: replayCandleSource(replay)` with `source: market.requestSource`;
- use `market.grid` for `entryVisibleRange(...)` inside FreeReplayChart;
- keep `rangeKey` based on Session identity and `replay.candleSource`, as it is today;
- keep effect dependencies on primitive Session/source/timeframe values, not the freshly created `market` object.

Expected request sites are the current lines 2150, 2189, 2219, 2263 and 2277; line numbers may shift after edits. Do not change fetch parameters other than routing the existing value through the new mapping.

### 3.3 OtherCoinChart

File: `src/ui/OtherCoinChart.tsx`

Widen the existing prop to `candleSource?: ChartCandleSource`; keep it optional.

Resolve the source without consulting a Session:

```ts
const source: ChartCandleSource = candleSource
  ?? (isReplay ? FREE_REPLAY_CANDLE_SOURCE : 'okx');
const { venue, requestSource, grid } = chartMarketContext(source);
```

Then remove:

- `replayCandleSource(null)` and its cast;
- the independent `venue === 'binance' ? ... : 'shanghai'` grid branch;
- `requestSource = venue`, which cannot represent `binance-only`.

Keep all three fetch paths using `requestSource`, and keep `/api/free-replay/instruments?source=${venue}`. The default source expression above preserves standalone OtherCoinChart tests and non-App usage; it is not a substitute for App passing the active Session source.

### 3.4 App composition

File: `src/ui/App.tsx:1104-1111`

Pass `candleSource={replayCandleSource(freeReplay)}` to the Free Replay Other Coin Panel.

Leave the Instrument Scan and Trade Review call sites semantically unchanged. In particular, an existing `candleSource="binance"` still maps to requestSource `binance`, not `binance-only`.

## 4. Data Flow

```text
Free Replay Session.candleSource
        │
        ▼
replayCandleSource(session)
  explicit │ missing → binance-only │ no Session → bitget
        │
        ├──────────────────────────────┐
        ▼                              ▼
chartMarketContext(source)      App OtherCoinChart prop
        │                              │
        │                              ▼
        │                       chartMarketContext(same source)
        │                              │
        ├─ requestSource → main Candlestick requests
        ├─ grid → main Review Window
                                   ├─ venue → Instrument List
                                   ├─ requestSource → panel Candlestick requests
                                   └─ grid → panel Review Window
```

Both charts consume the same pure mapping with the same source value. No global or mutable current-source state is introduced.

## 5. Test Design

### 5.1 Pure mapping tests

New `tests/chart-market-context.test.ts` covers the complete four-row matrix in §2.2. Assertions must check all three fields, especially that `binance` and `binance-only` keep distinct requestSource values while sharing venue/grid.

Existing `tests/free-replay-chart.test.ts` must continue to prove legacy/missing/default Session grid behavior after delegation.

### 5.2 Other Coin Chart grid regression

Extend `tests/other-coin-chart.test.tsx` with a Replay-mode `candleSource="binance-only"`, `timeframe="1D"` case.

Assert:

- Instrument List uses `source=binance`;
- Candlestick requests use `source=binance-only`;
- the first `setVisibleRange` call uses literal timestamps independently calculated from the 00:00Z day containing the test entry, ±150 nominal 1D steps. Do not calculate the expectation by calling `chartMarketContext` or `entryVisibleRange`, which would make the test tautological.

### 5.3 App composition regressions

Extend `tests/app-free-replay.test.tsx` with a table-driven restored-Session test for:

| persisted Session source | expected main/panel requestSource | expected panel list venue |
| --- | --- | --- |
| `okx` | `okx` | `okx` |
| `bitget` | `bitget` | `bitget` |
| `binance-only` | `binance-only` | `binance` |
| absent (legacy) | `binance-only` | `binance` |

For each case:

1. seed one restorable Session, using OKX-native instrument vocabulary for the OKX case;
2. restore it through the existing history UI;
3. verify the main request source;
4. open 其他币 and wait for the panel;
5. inspect only requests issued after opening it, then assert Instrument List venue and Candlestick requestSource;
6. assert no default-Bitget panel request appears for OKX / legacy cases.

At least the OKX and legacy cases must fail on the unfixed Implementation. Bitget is the unchanged control case.

## 6. Compatibility And Trade-offs

- **Server compatibility:** no server file or response shape changes; requestSource values are exactly the values already understood by `/api/candles`.
- **Storage compatibility:** no SQLite migration. Missing Session source still means legacy Binance.
- **Behavior compatibility:** `binance` does not become `binance-only`; standalone OtherCoinChart defaults do not change.
- **Small Interface:** one pure function and three derived values replace several independent source/grid derivations. No global store, class, React context provider, or new dependency is justified.
- **Object dependencies:** the returned context object is derived per render. Effects must depend on its primitive fields or existing Session keys, never on a fresh `market` object, to avoid reload loops.
- **Deferred native-Binance issue:** the candidate-chain inconsistency recorded in `research/current-state.md` remains untouched because fixing it would change existing route behavior and tests beyond this task's Free Replay scope.

## 7. Rollout And Rollback

Roll out in three verifiable steps: pure mapping → main/helper migration → OtherCoinChart/App composition. Run focused tests after each step.

There is no runtime migration or feature flag. If integration fails, stop before broad cleanup and revert the child task's focused commit. Restoring the previous callers completely restores prior behavior; no persisted data needs rollback.
