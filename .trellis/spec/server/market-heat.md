# Market Heat (市场热度)

## 1. Scope / Trigger

The review detail header「热度」button opens a floating panel that answers "当时市场场子热不热" for a trade's entry/exit anchor. Historical tickers are never persisted, so the reading is computed from **candles around the anchor**, not from live ticker history.

Covers `src/domain/market-heat.ts` (pure types/tier/normalizer/constants), `src/server/market-heat-service.ts`, the `GET /api/market-heat` route in `src/server/scan-routes.ts`, and `src/ui/MarketHeatPanel.tsx` (plus the `热度` toggle in the trade/bitget detail header in `App.tsx`).

## 2. Signatures

- Route: `GET /api/market-heat?anchor=<epochMs>&instrument=<reviewSymbol>`
- Service: `MarketHeatService.computeHeat({ anchor, reviewInstrument?, poolTopN? }): Promise<MarketHeatResult>`
- Pure domain: `classifyTier(upRatio, medianPct): MarketTier`, `normalizeToBinance(symbol): string | null`
- Domain types: `MarketHeatResult { tier, stats, topGainers, topLosers, reviewCoin, skipped, warnings }`, `HeatRow { instrument, changePct, windowQuoteVolume, isReviewCoin }`
- Calibration constants (all in `src/domain/market-heat.ts`): `HEAT_POOL_TOP_N=80`, `HEAT_ACTIVITY_POOL_TOP_N=120`, `HEAT_BASELINE_DAILY_BARS=20`, `HEAT_WINDOW_MS=24h`, `HEAT_TIMEFRAME='15m'`, `HEAT_WINDOW_BARS=100`, `TIER_UP_RATIO=0.6`, `TIER_MEDIAN_PCT=1`, `VOLATILE_THRESHOLD_PCT=5`, `HEAT_MOVERS_LIMIT=10`
- Activity fields on `HeatRow` (optional for compatibility): `quoteVolumeRatio20d`, `rangeRatio20d`, `activityScore`, `recent4hVolumeIntensity` (each `number | null`)
- Activity fields on `MarketHeatResult` (optional for compatibility): `activityCandidates`, `activityPoolSize`

## 3. Contracts

- `anchor`: epoch ms of the trade's entry (default) or exit time. Required, `> 0`; else 400.
- `instrument`: the review symbol as shown (OKX `BTC-USDT-SWAP` or Bitget/Binance `BTCUSDT`). Required; else 400.
- Pool: Binance USDT-M top-N by 24h quote volume **after** the scan pool policy (`isScannable`, so HK/A-share/pre-IPO classes are not part of the 场子 reading) and session gating (`isMarketOpen(marketClass, anchor)`, same as coin scan), plus the reviewed coin force-included by base-asset normalization.
- Stats: `poolSize` = number of instruments actually requested (pool ∪ review coin); `coveredCount` excludes no-data members (history shorter than the 24h window); `medianChangePct` over covered changes; `up/down/volatileCount` (|change| ≥ `VOLATILE_THRESHOLD_PCT`).
- Boards: strictly-up coins sorted desc / strictly-down asc, `HEAT_MOVERS_LIMIT` each. Rows are **copies** — never mutate the cached row's `isReviewCoin`.
- **Activity worklist**: `activityCandidates` reads the selected source's Top120 + forced review coin, never the Top80-only stats. It is sorted by `activityScore` descending, null scores last, then `abs(changePct)` descending. `activityPoolSize` is 120 in production; an explicit test `poolTopN` overrides both pools.
- **Relative activity**: rolling24h quote volume / median quote volume of the last 20 completed 1D candles, and rolling24h high-low range percent / median daily high-low range percent. `activityScore = sqrt(volumeRatio × rangeRatio)`. It orders attention only and does not predict direction.
- **Recent rhythm**: `recent4hVolumeIntensity` compares average quote volume per 15m bar in the last 16 bars against every earlier bar in the rolling24h window; >1 = accelerating, <1 = cooling. It is a display hint, not a hard rejection.
- **Baseline/null contract**: request 21 daily candles, discard the still-forming day and take 20 completed bars. Missing/zero/non-finite baselines produce `null` ratios and score, never fabricated 0 or 1. Null activity rows remain in the worklist and sort last.
- **Live fetch anchors**: the 15m request floors to its completed intraday boundary so OKX's earlier-contiguity seed cannot reject the newest closed bar. The 1D request floors to its source's daily open (`app-plugin` supplies `dailyGrid`: Binance `utc`, OKX/Bitget `shanghai`), preventing a live anchor from falling one full day beyond the latest closed daily bar. The original anchor still controls all 24h/ref/completion calculations.
- **Source wiring**: `app-plugin` passes each source's rate gate and `dailyGrid` into `MarketHeatService` so warnings and day boundaries follow the selected source rather than silently defaulting to Binance.
- `reviewCoin`: the reviewed coin's row copy with `isReviewCoin: true`, or null (no data / unmapped).
- `skipped`: `closedCount` (session-closed tickers), `noDataCount`, `unmappedReviewInstrument` (symbol not normalizable to Binance).
- `warnings`: rate-limit backoff messages raised during this computation (429), surfaced not swallowed.
- Completed-bar guard: `heatRowFromCandles` DROPS bars with `timestamp + intervalMs > anchor` (the anchor's still-forming bar) instead of returning `null` for the whole instrument. Sources may hand it back — OKX always has, and Binance's `earlier` does since 09/10 — so a null-on-sight guard would degrade every instrument to no-data. Only when no completed bar remains does the row read `noData`.

### Tier rule (5-tier)

| tier | condition |
| --- | --- |
| hot | upRatio ≥ 0.6 AND median ≥ +1% |
| cold | downRatio ≥ 0.6 AND median ≤ −1% |
| warm | upRatio ≥ 0.6 OR median ≥ +1% |
| cool | downRatio ≥ 0.6 OR median ≤ −1% |
| neutral | otherwise |

Zero covered coins → `neutral` (no reading), never `cool`.

## 4. Validation & Error Matrix

| Condition | Error |
| --- | --- |
| non-GET | 405 |
| missing / non-numeric / `<= 0` `anchor` | 400 `anchor is required` |
| missing `instrument` | 400 `instrument is required` |
| Binance ticker/candle fetch failure (incl. 418 fast-fail) | 502 with readable message |
| review coin fetch failure (its own symbol only) | degrade to `null` row + noData skip, response still 200 |

## 5. Good/Base/Bad Cases

- **Good**: a broad, strongly-up pool (≥60% of covered up AND median ≥ +1%) reads `hot`; the boards list gainers/losers and the reviewed coin is marked. An active candidate outside Top80 can enter the Top120 worklist without changing tier/stats.
- **Base**: a split/flat pool reads `neutral`; a Saturday review drops session-closed US-equity perps into `closedCount` without failing; a coin listed later than the 24h window reads `noData`; a coin with 24h data but fewer than 20 completed daily bars stays in the worklist with `—` activity metrics, sorted last.
- **Bad**: a coin whose candles stop before `anchor − 24h` must NOT count as covered (ref bar missing → null); the same anchor reopened must NOT refetch the pool (per-anchor memo); the reviewed coin that is not in today's top-N must still be fetched and counted. Activity-only Top120 members must NOT change `stats.poolSize`, breadth, median or the old boards.

## 6. Tests Required

- `tests/market-heat.test.ts` — pure: 5-tier boundaries (exact thresholds `>=`; breadth-vs-magnitude partial → warm/cool), neutral split, normalizer (OKX `-USDT-SWAP` → Binance name, Bitget passthrough, unmappable → null).
- `tests/market-heat-service.test.ts` — service with fake sources: hot classification & boards, relative activity formula and recent rhythm, Top120/Top80 isolation, Top80-only candidate inclusion, null baselines, intraday/UTC/Shanghai fetch-anchor flooring, session gating (closed member neither requested nor counted), **pool policy (an HK/A-share/pre-IPO member is excluded without being counted as closed)**, no-data skip, forced review coin flagged (with small `poolTopN`), unmapped review symbol, **same-anchor memo = zero refetch**, warnings surfaced.
- `tests/heat-scan-results.test.tsx` — UI: renders tier/numbers/boards + review marker + skip summary for legacy payloads; activity worklist defaults to 20, sorts by activity/volume/range/absolute move with null last, filters accelerating/cooling/insufficient history, expands all and invokes the chart callback with the selected instrument.
- `tests/market-heat-panel.test.tsx` — UI: renders tier/numbers/boards + review marker + skip summary for entry anchor; switching to 离场 refetches with the exit anchor; 502 shows the error without a tier.

## 7. Wrong vs Correct

#### Wrong

```ts
const reviewRow = rowsByInstrument.get(reviewBinance);
if (reviewRow) reviewRow.isReviewCoin = true; // mutates a row cached across trades/anchors
```

#### Correct

```ts
const cached = rowsByInstrument.get(reviewBinance);
if (cached) reviewRow = { ...cached, isReviewCoin: true }; // per-request copy
```

## Design Decisions

### Follows `MARKET_DATA_SOURCE` (flipped from always-Binance on 10/12)

Heat runs on the SAME source as the coin scan (`MarketHeatService(tickerSource, scanCandleSource)` in `app-plugin.ts`): the whole 选品 module moves together, and the default is Bitget. Binance instances are still shared with the scan in Binance mode (shared ticker TTL / metadata caches). Consequences of the flip:

- Bitget mode: the pool is Bitget USDT-FUTURES top-N; RWA contracts (isRwa=YES → US_EQUITY, two-bucket rule — see `market-data.md`) are session-gated/excluded exactly like Binance's TradFi perps, so the board stays crypto+commodity-flavoured.
- OKX mode: heat now reads OKX (it was hardcoded to Binance before the flip) — module consistency was chosen over per-module source pinning.
- Rate limits ride the running source's budget (`bitgetMarketRatePacer` 50ms / `binanceRatePacer` 110ms); a 429 surfaces as a warning on the response, and already-fetched coins stay cached so retry only tops up the missing ones.

### Historical heat is computed from candles, one request per coin

`HEAT_TIMEFRAME` 15m × 100 bars covers the 24h window ending at the anchor. Candles write into the shared SQLite cache, so consecutive review anchors reuse slices; per-anchor in-memory memo (FIFO-evicted, 50 anchors) makes same-anchor reopen **zero** network requests.

### Activity worklist (11/23)

The scan now separates two pools: Top80 remains the Market Temperature universe, while Top120 supplies an activity worklist for choosing which chart to inspect first. Each activity row compares rolling24h quote volume and high-low range against the median of the last 20 completed daily bars, then orders by `sqrt(volumeRatio × rangeRatio)`. This intentionally covers volume/range expansion without implementing convergence detection or a buy/sell classifier. The last-4h quote intensity distinguishes recent acceleration from earlier activity now cooling; neither metric is a direction veto. `HeatScanResults` owns the worklist UI (20 collapsed rows, sorting, recency filters, expand, same-source chart). `MarketHeatView.showBoards` defaults true so the trade-review floating panel remains unchanged; the embedded activity scan passes false to avoid duplicating the legacy movers boards. Live anchors are floored per source before fetching, while all heat calculations keep the original timestamp.

### Quote volume ≈ Σ close × volume

The candle schema stores base volume only; adding a quote column would migrate the shared table. The boards label the column ≈.

### Rate limits ride the shared Binance budget

No heat-specific pacer: the global `binanceRatePacer` in `defaultBinanceFetchJson` (110ms ≈ 9 req/s) paces heat, scan, and any future Binance caller off one budget. 418 fails fast with a warning surfaced on the response; already-fetched coins stay cached so retry only tops up the missing ones.
