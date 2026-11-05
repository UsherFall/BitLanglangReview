# Current-state research — Replay market context

Date: 2026-11-05
Mode: read-only source and test inspection

## Baseline

- `npm test -- --reporter=dot`: 75 files / 686 tests passed in 74.02s.
- `npx tsc --noEmit`: passed.
- Existing React tests print `act(...)` warnings; this task must not rewrite the test suite to chase them.
- No `docs/adr/` entries exist. The binding product contracts are `CONTEXT.md` and `.trellis/spec`.

## Source vocabularies today

| Type / location | Values | Meaning in current code |
| --- | --- | --- |
| `CandleSourceId`, `src/domain/candlestick.ts:13` | `okx`, `binance`, `bitget` | Instrument-list venue and most chart callers' source prop |
| `ReplayCandleSource`, `src/ui/free-replay-chart.ts:34` | `binance-only`, `okx`, `bitget` | Free Replay Session's persisted request source |
| `/api/candles?source=...`, `src/server/app-plugin.ts:223-274` | absent / `okx`, `binance`, `binance-only`, `bitget` | OKX, Binance candidate chain, strict Binance, Bitget respectively |
| `/api/free-replay/instruments?source=...`, `src/server/app-plugin.ts:201-221` | `okx`, `bitget`, anything else → `binance` | Native Instrument List vocabulary |

`binance` and `binance-only` are deliberately NOT interchangeable. A mapping module must preserve requestSource identity while mapping both to the Binance Instrument List and UTC Candle Grid.

## Broken composition path

1. FreeReplayChart receives `replay` and resolves the Session source correctly:
   - request instrument: `src/ui/App.tsx:1690`
   - focus viewport grid: `src/ui/App.tsx:2055`
   - Candlestick request sources: `src/ui/App.tsx:2150,2189,2219,2263,2277`
2. App renders the replay Other Coin Panel at `src/ui/App.tsx:1104-1111` without a `candleSource` prop.
3. OtherCoinChart sees `cursorTime` and enters Replay mode, then calls `replayCandleSource(null)` at `src/ui/OtherCoinChart.tsx:84-85`.
4. `replayCandleSource(null)` returns `FREE_REPLAY_CANDLE_SOURCE` (currently Bitget) at `src/ui/free-replay-chart.ts:66-72`.
5. Therefore a restored OKX Session or legacy `binance-only` Session can have a correct main chart and a default-Bitget Other Coin Panel. The panel's Candle Grid is then derived from that incorrect venue at `src/ui/OtherCoinChart.tsx:87`.

The domain contract forbids this: `CONTEXT.md:131-133` says the panel always reads the same Market Data Source as its host chart and, in Free Replay, follows the same Cursor and Candle Grid.

## Required compatibility matrix

This matrix preserves existing behavior while making the three concerns explicit. It is the expected truth table for the new pure mapping tests.

| Input chart source | Instrument List venue | Candle requestSource | Candle Grid | Notes |
| --- | --- | --- | --- | --- |
| `binance` | `binance` | `binance` | `utc` | Preserve existing non-Replay candidate-chain strategy |
| `binance-only` | `binance` | `binance-only` | `utc` | Legacy / strict-Binance Replay |
| `okx` | `okx` | `okx` | `shanghai` | OKX Replay and workbook review |
| `bitget` | `bitget` | `bitget` | `shanghai` | Current default Replay and Bitget review |

Standalone OtherCoinChart defaults to preserve:

- `cursorTime` present + no source prop → current default Replay source (`bitget`). Existing tests at `tests/other-coin-chart.test.tsx:232-269` rely on the Bitget-native opening symbol.
- no `cursorTime` + no source prop → `okx`. Existing workbook-review tests rely on this.
- App's real Free Replay path must pass the Session source explicitly, so these defaults no longer decide an active Session's venue.

## Existing tests and blind spot

Covered today:

- `tests/free-replay-chart.test.ts:103-109`: legacy / current Session grid helper.
- `tests/app-free-replay.test.tsx:1191-1310`: restore Session and select source before starting Replay.
- `tests/other-coin-chart.test.tsx`: future hiding, prefetch, native opening symbol, explicitly supplied `candleSource="binance"`, default OKX trade panel, and drawing board behavior.

Not covered today:

- Restore OKX / legacy Session → open Other Coin Panel → assert the panel inherits that Session's requestSource and grid.
- A 1D Other Coin Panel on `binance-only` whose initial Review Window is checked against an independently calculated UTC day boundary.

These are the regression tests to add before changing implementation.

## Deferred inconsistency — do not fix in this task

`tests/other-coin-chart.test.tsx:271-375` contains comments that describe `source=binance` as direct Binance for native symbols, while `src/server/app-plugin.ts:240-268` routes `source=binance` through `fetchReviewCandles`, whose candidate chain accepts OKX-style trade instruments. The current tests assert `source=binance`, and changing them to `binance-only` would be a separate behavior fix with compatibility implications.

For this task:

- keep `candleSource="binance"` → requestSource `binance` exactly as before;
- do not alter those legacy assertions or the server route;
- use `binance-only` only when the Free Replay Session actually carries that source;
- record any desired native-symbol candidate-chain fix as another task, not an incidental change here.

## Design constraints from specs

- UI-only deterministic chart mapping belongs in a kebab-case helper under `src/ui`, with focused Vitest coverage (`.trellis/spec/frontend/directory-structure.md`).
- Shared source types belong under `src/domain`, not in a React file (`.trellis/spec/frontend/type-safety.md`).
- Chart requests use milliseconds in domain data and seconds only at lightweight-charts boundaries; no timestamp-unit change is allowed in this task.
- Do not recreate charts during normal prop changes or fetch while `suppressAutoLoadRef` is active (`.trellis/spec/frontend/hook-guidelines.md`).
- Binance day opens at 00:00Z; OKX and Bitget day opens at 00:00 Beijing (`.trellis/spec/server/market-data.md`, `CONTEXT.md`).
