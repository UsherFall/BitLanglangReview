# Market Heat (市场热度)

## 1. Scope / Trigger

The review detail header「热度」button opens a floating panel that answers "当时市场场子热不热" for a trade's entry/exit anchor. Historical tickers are never persisted, so the reading is computed from **candles around the anchor**, not from live ticker history.

Covers `src/domain/market-heat.ts` (pure types/tier/normalizer/constants), `src/server/market-heat-service.ts`, the `GET /api/market-heat` route in `src/server/app-plugin.ts`, and `src/ui/MarketHeatPanel.tsx` (plus the `热度` toggle in the trade/bitget detail header in `App.tsx`).

## 2. Signatures

- Route: `GET /api/market-heat?anchor=<epochMs>&instrument=<reviewSymbol>`
- Service: `MarketHeatService.computeHeat({ anchor, reviewInstrument?, poolTopN? }): Promise<MarketHeatResult>`
- Pure domain: `classifyTier(upRatio, medianPct): MarketTier`, `normalizeToBinance(symbol): string | null`
- Domain types: `MarketHeatResult { tier, stats, topGainers, topLosers, reviewCoin, skipped, warnings }`, `HeatRow { instrument, changePct, windowQuoteVolume, isReviewCoin }`
- Calibration constants (all in `src/domain/market-heat.ts`): `HEAT_POOL_TOP_N=80`, `HEAT_WINDOW_MS=24h`, `HEAT_TIMEFRAME='15m'`, `HEAT_WINDOW_BARS=100`, `TIER_UP_RATIO=0.6`, `TIER_MEDIAN_PCT=1`, `VOLATILE_THRESHOLD_PCT=5`, `HEAT_MOVERS_LIMIT=10`

## 3. Contracts

- `anchor`: epoch ms of the trade's entry (default) or exit time. Required, `> 0`; else 400.
- `instrument`: the review symbol as shown (OKX `BTC-USDT-SWAP` or Bitget/Binance `BTCUSDT`). Required; else 400.
- Pool: Binance USDT-M top-N by 24h quote volume **after** session gating (`isMarketOpen(marketClass, anchor)`, same as coin scan), plus the reviewed coin force-included by base-asset normalization.
- Stats: `poolSize` = number of instruments actually requested (pool ∪ review coin); `coveredCount` excludes no-data members (history shorter than the 24h window); `medianChangePct` over covered changes; `up/down/volatileCount` (|change| ≥ `VOLATILE_THRESHOLD_PCT`).
- Boards: strictly-up coins sorted desc / strictly-down asc, `HEAT_MOVERS_LIMIT` each. Rows are **copies** — never mutate the cached row's `isReviewCoin`.
- `reviewCoin`: the reviewed coin's row copy with `isReviewCoin: true`, or null (no data / unmapped).
- `skipped`: `closedCount` (session-closed tickers), `noDataCount`, `unmappedReviewInstrument` (symbol not normalizable to Binance).
- `warnings`: rate-limit backoff messages raised during this computation (429), surfaced not swallowed.

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

- **Good**: a broad, strongly-up pool (≥60% of covered up AND median ≥ +1%) reads `hot`; the boards list gainers/losers and the reviewed coin is marked.
- **Base**: a split/flat pool reads `neutral`; a Saturday review drops session-closed US-equity perps into `closedCount` without failing; the reviewed coin listed later than the 24h window reads `noData`.
- **Bad**: a coin whose candles stop before `anchor − 24h` must NOT count as covered (ref bar missing → null); the same anchor reopened must NOT refetch the pool (per-anchor memo); the reviewed coin that is not in today's top-N must still be fetched and counted.

## 6. Tests Required

- `tests/market-heat.test.ts` — pure: 5-tier boundaries (exact thresholds `>=`; breadth-vs-magnitude partial → warm/cool), neutral split, normalizer (OKX `-USDT-SWAP` → Binance name, Bitget passthrough, unmappable → null).
- `tests/market-heat-service.test.ts` — service with fake sources: hot classification & boards, session gating (closed member neither requested nor counted), no-data skip, forced review coin flagged (with small `poolTopN`), unmapped review symbol, **same-anchor memo = zero refetch**, warnings surfaced.
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

### Always Binance, independent of `MARKET_DATA_SOURCE`

Heat's pool is Binance USDT-M top-N and only Binance metadata can gate TradFi sessions; the OKX switch applies to the scan only. Binance instances are shared with the scan in Binance mode (shared ticker/metadata caches).

### Historical heat is computed from candles, one request per coin

`HEAT_TIMEFRAME` 15m × 100 bars covers the 24h window ending at the anchor. Candles write into the shared SQLite cache, so consecutive review anchors reuse slices; per-anchor in-memory memo (FIFO-evicted, 50 anchors) makes same-anchor reopen **zero** network requests.

### Quote volume ≈ Σ close × volume

The candle schema stores base volume only; adding a quote column would migrate the shared table. The boards label the column ≈.

### Rate limits ride the shared Binance budget

No heat-specific pacer: the global `binanceRatePacer` in `defaultBinanceFetchJson` (110ms ≈ 9 req/s) paces heat, scan, and any future Binance caller off one budget. 418 fails fast with a warning surfaced on the response; already-fetched coins stay cached so retry only tops up the missing ones.
