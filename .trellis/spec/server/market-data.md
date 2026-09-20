# Market Data

## Data-Source Seam (Coin Scan + Market Heat)

`src/server/market-data.ts` defines the normalized contracts shared by the coin scan and the market-heat service, so those consumers stay data-source-agnostic:

- `Ticker { instrument, quoteVolume24h, lastPrice, change24h, marketClass? }` — normalized ticker; `quoteVolume24h` is in USDT (each source computes it from its native payload), `change24h` is a percent. Optional `marketClass` (a `MarketClass` from `src/domain/market-class.ts`) is the instrument's underlying-market class. **An ABSENT class means UNKNOWN, not "no session"**: consumers treat it as crypto-like (always open, always scannable), and a source that could not classify reports that through `metadataAvailable?()` so the scan can surface it (09/16).
- `TickerSource.listTickers(): Promise<Ticker[]>` — full-market snapshot.
- `TickerSource.metadataAvailable?(): boolean` — optional: whether the last snapshot could attach classes. `false` means session gating was effectively off for that snapshot.
- `CandleRequest { instrument, timeframe, anchor, direction: 'earlier' | 'later', limit }` and `CandleSource.getCandlesticks(request): Promise<Candlestick[]>` — same contract as `CandlestickService`.

`app-plugin.ts` wires the selected source via `marketDataSource` option (default `'binance'`) with `process.env.MARKET_DATA_SOURCE` as fallback:

```ts
const marketDataSource = options.marketDataSource ?? process.env.MARKET_DATA_SOURCE ?? 'binance';
const tickerSource = marketDataSource === 'okx' ? new OkxTickerSource() : new BinanceTickerSource(undefined, binanceInstrumentMetadata());
const scanCandleSource = marketDataSource === 'okx' ? candleService : new BinanceCandleSource(candleStore);
```

The coin scan and the market-heat service consume the selected `tickerSource`; the scan also consumes `scanCandleSource`. **FreeReplay and the workbook TradeReview default to the OKX `CandlestickService`** and the OKX instrument list regardless of the setting. The personal review mode (Bitget-sourced trades, tab「个人交割单复盘」) is the exception: its charts pass `source=binance` and go through the Binance-then-OKX candidate chain (see "Personal Review Candle Source").

### Market heat always runs on Binance (09/07)

`MarketHeatService` (see `market-heat.md`) is wired in `app-plugin.ts` with dedicated `BinanceTickerSource` + `BinanceCandleSource` instances REGARDLESS of `marketDataSource`. Its pool is defined as Binance USDT-M top-N and only Binance `exchangeInfo` metadata can session-gate TradFi contracts, so the OKX switch does not apply. In Binance mode the same instances are shared with the coin scan so the 30s ticker TTL and 6h metadata cache stay shared.

## OKX Instrument List

`src/server/okx-instrument-service.ts` and `src/server/free-replay-instruments.ts` provide the Free Replay Instrument List from OKX public SWAP instruments. Free Replay should not be limited to instruments present in the Source Workbook.

When changing this flow, keep the domain language as Instrument and preserve `BTC-USDT-SWAP` style futures symbols.

## Candlestick Service

`src/server/candlestick-service.ts` is the service boundary between the local Candlestick Cache and OKX history candles, and implements `CandleSource`. It accepts an Instrument, Review Timeframe, anchor timestamp in milliseconds, direction (`earlier` or `later`), and limit.

Behavior to preserve:

- Return contiguous cached candles when enough are present.
- Fetch OKX history only when the contiguous cache is insufficient.
- Save fetched candles to the cache, then return from the cache path.
- **Closed bars only (09/20)**: fetched rows are filtered by OKX's own completion flag — `confirm` (row[8]), where only an explicit `'0'` ("not finished") is dropped. An ABSENT or unrecognised value counts as closed on purpose: over-dropping would leave this source with no candles at all, while under-dropping merely preserves the pre-09/20 behaviour. The filter runs on the raw row before mapping, so it is direction-agnostic (`earlier` and `later` both receive the in-progress bar). Do NOT derive completion from `timestamp + timeframeMs(timeframe)` — the nominal `1M` step is 30 days while calendar months are 28–31. Background: a still-forming bar used to reach the cache, and `isCacheFresh`'s "a historical anchor is always fresh" shortcut then reused its half-formed high/low/close forever (BTCUSDT 2026-09-17, 5 bars).
- For `later` requests, map intra-candle anchors to the containing candlestick boundary before calculating the OKX `after` parameter.
- Treat daily candles with the existing Shanghai/UTC offset handling in `boundaryAnchor`.
- Do not return later candles if the first candle after the anchor is missing; gaps break contiguity.

Coverage is in `tests/candlestick-cache.test.ts`.

## Binance Candles (Coin Scan)

`src/server/binance-candles.ts` provides `BinanceCandleSource implements CandleSource`, backed by `fapi/v1/klines`, used by the coin scan when the data source is Binance (the default).

- `timestamp = openTime` — Binance klines open at **UTC 0:00** boundaries, which aligns daily candles with the user's chart view. **No OKX-style -8h offset** is applied (unlike `CandlestickService.boundaryAnchor`).
- Interval mapping: `5m/15m/1H→1h/4H→4h/1D→1d/...` (see `toBinanceInterval`).
- `earlier` semantics (09/10): returns the bars **strictly before the anchor**, INCLUDING the bar that contains the anchor, matching `CandlestickService` (OKX). The request uses `endTime = anchor - 1` and the filter is `candle.timestamp < anchor`. The old filter was `candle.timestamp + intervalMs <= anchor` ("completed bars only"); that dropped the anchor's own bar while `later` starts at `boundaryAnchor(anchor) + intervalMs`, leaving a permanent one-bar hole at a review window's entry (a trade entry not sitting on a bar boundary lost its own candle on every timeframe). **Closed bars only (09/20)**: rows are filtered by Binance's own `closeTime` (row[6]) — `Number(row[6]) < Date.now()` — BEFORE mapping, so the still-forming bar reaches neither the cache nor the caller. Never derive it from `timestamp + timeframeMs(timeframe)`: the nominal `1M` step is 30 days while calendar months are 28–31, so a 31-day month would pass a running bar (and a 28-day one would drop a closed bar). This does not conflict with the 09/10 rule — an anchor in the past can only sit inside an already-closed bar, so the anchor's own bar is still returned; a LIVE anchor loses the in-progress bar on purpose (a half-formed bar has wrong high/low/close and breaks contiguity with its neighbours). Callers that need completed bars only (coin scan, market heat) still drop the still-forming bar themselves — `coin-scan-service.ts` filters it before `probeStructure`, and `market-heat-service.ts` filters it in `heatRowFromCandles` instead of degrading the whole instrument to no-data — but that is now a redundant second line of defence, not the primary gate.
- `later` requests set `startTime = boundaryAnchor(anchor) + intervalMs` so the first returned bar is the one after the anchor.
- Contiguity: reuses the same `contiguousCandles` logic as the OKX service. The boundary seed is `Math.floor(anchor / step) * step` for **both** directions. With the `earlier` filter above, the newest returned bar equals the seed (anchor inside a bar) or is one step below it (anchor exactly on a boundary), so both stay within `maxGap = 1.5 × step`. Do not change the seed without re-running the contiguity tests.
- Cache completeness: an `earlier` cache hit additionally requires `coversAnchorBar` — the newest cached bar must reach `min(anchor, now - intervalMs)` within one bar (`target - newest <= spacing`), where `target = Math.min(request.anchor, Date.now() - intervalMs)`. Without it, a cache holding `limit` bars that stops one bar short satisfies `length >= limit` + `isCacheFresh` (a historical anchor is always "fresh") and the hole becomes permanent. The `now - intervalMs` cap exists BECAUSE only closed bars are cached: for a live anchor the anchor's own bar is legitimately absent, so comparing against the raw anchor would demand a bar that cannot exist yet and bypass the cache on every request. A historical anchor sits below the cap and is still compared against itself. Keep `<=`, never `<`: an anchor exactly on a bar boundary has its newest bar one whole step away (`anchor - step`), so tightening it would refetch on every request. The spacing is measured from the cached run itself (with `intervalMs` as a floor), NOT from `boundaryAnchor`: that floors by the nominal `1W`/`1M` step, but Binance weeks open on Monday and months on the 1st, so a floored reference sits inside the current bar and would bypass the cache on every request for a late-week / mid-month anchor.
- Caching: reuses the shared `CandlestickStore`. Binance instrument names (`XAUUSDT`, `BTCUSDT`) differ from OKX (`XAU-USDT-SWAP`, `BTC-USDT-SWAP`), so the `(instrument, timeframe, timestamp)` primary keys never collide across sources.

Coverage is in `tests/binance-candles.test.ts`.

## Personal Review Candle Source: Binance + OKX fallback (09/17)

The「个人交割单复盘」review mode (trades synced from Bitget) requests `source=binance` on `/api/candles`. Bitget/OKX symbol → Binance symbol is NOT a pure string transform — the exchange renames and delists contracts — so the request runs through an ordered candidate CHAIN in `src/server/review-candle-source.ts` (`fetchReviewCandles`, built on `resolveCandleChain` in `src/domain/instrument-symbol.ts`):

1. Binance alias candidate (`BINANCE_SYMBOL_ALIASES`, e.g. `RAY` → `RAYSOLUSDT`), then the plain `base+USDT` candidate;
2. the OKX fallback on the instrument's own name (`RAY-USDT-SWAP`), served by the same `CandlestickService` the workbook review uses.

A Binance step whose `exchangeInfo.status` is known and not `TRADING` is skipped WITHOUT a request — that is the only way the chain advances to the OKX step. A tradable candidate's answer is final, including an empty window, so scrolling past the present stays silent instead of switching venue; and a Binance fetch failure propagates unchanged, because substituting OKX prices for a rate-limited (429/418) Binance chart would hide the limit. Verified root causes (2026-09-17):

- `SHIBUSDT` does not exist on Binance USDT-M (`fapi/v1/klines` → 400 `-1121`); Binance quotes the same asset as `1000SHIBUSDT`, a **1000x face value**. It is therefore deliberately NOT in the alias table — the candle prices would stop sharing a scale with the trade's entry/exit prices and would need a price-scaling layer (which would also change how drawings read prices). OKX lists the plain `SHIB-USDT-SWAP` at the trade's scale, so the fallback serves it.
- `RAYUSDT` is `status: "SETTLING"` (Binance settled it in 2022-11) and `fapi/v1/klines` still answers for it with a FROZEN price (`0.248`) and zero volume. Binance lists the same asset as `RAYSOLUSDT`, which is what the alias resolves to. `VANRYUSDT` is also `SETTLING` but has no replacement on Binance and none on OKX, so it is the case that ends in the explicit no-data error.
- Coverage measured on the user's 47 mappable Bitget positions: 11 symbols exist only on Binance, 2 (`SHIB`, `RAY`) only on OKX, 1 (`VANRY`) on neither. Binance must therefore stay the primary source; OKX is the fallback only.

Chain exhaustion raises `ReviewCandleUnavailableError`, which the route turns into `502 { error }`; the message names the instrument and each source's reason (e.g. `VANRYUSDT 不可用(币安合约状态 SETTLING)`), and the chart status line renders it verbatim. `binanceStatuses` comes from `BinanceInstrumentMetadataSource.symbolStatuses()` — the same 6h-cached `exchangeInfo` fetch the scan already uses.

**Known residual**: when that metadata is unreadable (empty status map) nothing can be validated, so every Binance candidate is attempted and the chain cannot advance to OKX. A `SETTLING` contract is then undetectable and still charts as a flat line, and a symbol Binance does not list (SHIB) still 502s — i.e. exactly the pre-chain behaviour. Closing either would need a "zero-volume window" heuristic (which would misfire on genuinely quiet markets) or a fallback on request errors (which would mask rate limits).

Why not Bitget's own candles? Bitget `/api/v2/mix/market/candles` keeps only a **rolling window per granularity** (measured 09/07 on BTCUSDT): 5m ≈ 30 days, 15m ≈ 1–2 months, 1H ≈ 60–90 days, 4H ≈ a few months, while 1D/1W/1M go back years. Intraday charts for any but recent trades were therefore empty, so the personal review default was moved to Binance, whose `fapi/v1/klines` have no such rolling retention (5m data from 2021+). Historical notes kept for future reference:

- Bitget candle rows/caching follow the native-symbol isolation rule (`BTCUSDT` vs OKX `BTC-USDT-SWAP`), the same rule Binance uses.
- Bitget `startTime~endTime` span per request is capped at **90 days** (HTTP 400 code `00001`), so paging windows must not exceed it.
- A `BitgetCandleSource` existed for this mode and was removed when the source moved to Binance; do not re-introduce it without reconsidering the retention gap.

### Source selection notes

- `CandleRequest.instrument` is always the **native symbol of the chosen source**. The route resolves the review's OKX-style instrument into a chain (`src/domain/instrument-symbol.ts`) and each step requests its own source with that source's vocabulary.
- The personal review chain must not leak into the coin scan or market heat: those consumers hold `BinanceCandleSource` directly (the scan pool is defined as Binance USDT-M, so an OKX fallback would rank a different universe), and only the `/api/candles?source=binance` route path runs the chain.
- **Cache-key namespace rule (09/07)**: the `candles` PK is `(instrument, timeframe, timestamp)` with no source column. Isolation works only when sources use DIFFERENT symbol vocabularies — OKX's `X-USDT-SWAP` vs `base+USDT` — NOT when two sources share a vocabulary. The retired Bitget source and Binance both keyed on `base+USDT` (`ZECUSDT`), so Bitget leftovers mixed with Binance rows and produced two daily bars per day. If a future source shares the `base+USDT` namespace, it MUST namespace its cache keys (e.g. a source prefix); the retired-source leftovers were cleared once from the local cache.
- The mode→source binding lives in `src/ui/App.tsx` (`reviewModeBindings`): workbook review → `okx`, personal review → `binance`.
- Binance daily candles align to UTC 0:00 (no -8h offset), so a trade near a UTC day boundary may sit on a different chart day than the OKX/UTC+8 view — accepted for the personal mode.

## API Windowing

`src/server/app-plugin.ts` builds the initial Review Window by fetching 150 earlier and 150 later candlesticks around the entry time, then merges by timestamp. On-demand requests use `mode=earlier` or `mode=later` with an anchor.

Do not preload all history. The product contract is On-Demand Candlestick Loading with cache reuse.

## OKX Tickers (FreeReplay / OKX Fallback)

`src/server/okx-tickers.ts` owns the single full-market ticker fetch: `fetchOkxTickers(fetchJson)` calls `GET /api/v5/market/tickers?instType=SWAP` once, filters to instruments whose `instId` ends with `-USDT-SWAP`, sorts by 24h quote-volume in USDT descending, and returns `OkxTicker[]` (shape-identical to `Ticker`). It is wrapped by `OkxTickerSource implements TickerSource`, the OKX option for the switchable coin-scan data source. Keep `fetchOkxTickers` a pure module function; do not re-embed the fetch in service classes.

OKX ticker `volCcy24h` is the 24h volume in **base coin units** (e.g. XLM coins), not USDT. The 24h quote-volume in USDT is therefore `volCcy24h * last`; the scan uses that product for both ranking and the liquidity floor. `lastPrice` comes from ticker `last`; `change24h` is `(last - open24h) / open24h * 100`.

## Binance Tickers (Shared, Default)

`src/server/binance-tickers.ts` provides `BinanceTickerSource implements TickerSource`, the default source for the coin scan and the market-heat pool. `listTickers()` calls `fapi/v1/ticker/24hr` once (no pagination), maps every USDT-M perpetual symbol (ends with `USDT`), excludes stablecoin pairs, and sorts by `quoteVolume` descending:

- `quoteVolume24h = Number(quoteVolume)` — Binance already reports USDT-denominated quote volume, so no `volCcy * last` conversion (unlike OKX).
- `change24h = Number(priceChangePercent)` — already a percent.
- Stablecoin exclusion list (`STABLECOIN_QUOTE_PAIRS`): `USDCUSDT`, `FDUSDUSDT`, `DAIUSDT`, `TUSDUSDT`, `USDDUSDT`, `USDPUSDT`, `USD1USDT`, `USD0USDT`. Extend this set as new stablecoin/synthetic pairs appear.
- Entries with non-finite `quoteVolume24h`, `lastPrice`, or `change24h` are skipped.
- Precious-metal perpetuals `XAUUSDT`/`XAGUSDT` and tokenized `PAXGUSDT`/`XAUTUSDT` remain in the pool.

### Instrument-class metadata (Session Gating)

`src/server/binance-instrument-metadata.ts` provides `BinanceInstrumentMetadataSource` (module-shared via `binanceInstrumentMetadata()`): it fetches `fapi/v1/exchangeInfo` once, maps `underlyingType` → `MarketClass` (`EQUITY`→`US_EQUITY`, `HK_EQUITY`/`KR_EQUITY`/`CN_EQUITY`, `COMMODITY`, `PREMARKET`→`PRE_IPO`, `COIN`/`INDEX`→`CRYPTO`, unknown → omitted), and returns a `symbol → MarketClass` map. TTL 6h + in-flight dedupe; any failure/non-array payload degrades to an EMPTY map, never an error. Coverage in `tests/binance-instrument-metadata.test.ts`.

`BinanceTickerSource` attaches `marketClass` for **every** classified symbol — crypto and commodity included (09/16), because the scan pool policy needs to see HK/CN/pre-IPO in order to exclude them. It also records whether the metadata was readable and exposes `metadataAvailable()`; the coin scan turns that into `ScanResponse.metadataUnavailable`. The coin scan then checks the anchor with `isMarketOpen` and drops untraded candles with `isCandleInSession` (both in `src/domain/market-session.ts`). Coverage in `tests/binance-tickers.test.ts`.

`baseAsset` is intentionally NOT surfaced: the scan classifies by `underlyingType`, and the Yahoo-ticker alias design that briefly needed the upstream symbol was dropped in 09/16 (Yahoo's free chart API rate-limits after ~40 requests).

Coverage is in `tests/binance-tickers.test.ts`.

## Error Handling

`defaultFetchJson` aborts OKX requests after 12 seconds and throws when the response is not OK; `defaultBinanceFetchJson` (`src/server/http.ts`) applies the same timeout/error contract to Binance `fapi` endpoints. Both wrap `fetchJsonWithRetry`, which retries Binance's rate-limit responses so a scan survives instead of dying on the first hit: 429 (transient weight-limit) gets exponential backoff honoring `Retry-After`; 418 (IP auto-ban) waits the FULL `Retry-After` (else 2min) then retries exactly ONCE — per Binance, retrying during a ban prolongs it (2min → up to 3 days), so a still-banned IP throws rather than hammer. Non-retryable statuses and network/timeout errors throw immediately. Route handlers convert service failures to HTTP 502 so the UI can show loading failure status without crashing.

### Shared request-rate budget (09/07)

Binance's limits are **per IP** and measured in `REQUEST_WEIGHT` (2400/min), not in requests per second — "the limits on the API are based on the IPs, not the API keys". An IP ban (418) follows repeatedly violating that limit and/or not backing off after 429s, and scales in duration for repeat offenders (2 minutes → 3 days). `binanceRatePacer` (`BINANCE_MIN_INTERVAL_MS=110`, jitter 15ms → ~9 req/s ≈ 1090 weight/min at the klines weight of 2) lives inside `defaultBinanceFetchJson` — the single choke point every Binance outbound passes through (klines/tickers/exchangeInfo) — so the coin scan, the market-heat service, and any future Binance caller share ONE request-start budget; cache hits never reach the fetch and OKX/Bitget requests are unpaced. The pacer exists because the previous 50ms spacing (~20 req/s) was 1200 klines/min × weight 2 = 2400 weight/min — exactly the ceiling — which is what tripped 429s and escalated to 418s. The 429/418 gate (`binanceRateGate`) behavior is unchanged. The ceiling, the endpoint weights and the ban mechanics are sourced in `.trellis/tasks/09-14-binance-rate-limit-diagnostics/research/binance-rate-limits.md`.

### Weight observability (09/14)

Binance answers every request with `X-MBX-USED-WEIGHT-1M`, the used weight **for the IP** in the current minute — "the limits on the API are based on the IPs, not the API keys" — against the `REQUEST_WEIGHT` ceiling of 2400/min. `binanceWeightMonitor` (`createWeightMonitor` in `src/server/http.ts`, a shared module singleton like the gate and the pacer, default sink `console.warn`) consumes it from `fetchJsonWithRetry`, which takes it as an optional 4th argument so tests can inject a capturing monitor. Every response is observed — OK and non-OK alike, because a 418 response carries the header too — and a 429/418 additionally prints one line unconditionally, with the weight taken from the response that tripped the limit. The high-water mark is monotonic for the life of the process (deliberately not persisted) and only prints when it crosses a `step` boundary, so a 300-request scan produces a readable ladder instead of 300 lines: the step defaults to 200, comes from `BINANCE_WEIGHT_LOG_STEP`, falls back to 200 for a non-finite or negative value, and `0` silences the high-water line only (limit lines always print). The log shape is fixed so it stays greppable, with missing fields rendered as `unknown`:

```text
[binance] used-weight-1m high-water=<N> (本进程权重上限 ≈≤1090/min; 限额 2400/min)
[binance] HTTP <status> used-weight-1m=<N> retry-after=<S>s
```

The `本进程权重上限` figure is DERIVED from the shared pacer, never hard-coded: `Math.round(60000 / BINANCE_MIN_INTERVAL_MS)` request starts per minute × the klines weight (2 for the LIMITs this project uses — 100 for the scan, 150 for the charts) = ≤1090 weight/min, roughly 45% of 2400. Jitter only widens the interval, so it is an upper bound (hence the `≤`); comparing it against the observed per-IP weight is what tells "our own traffic" apart from "another client shares this exit IP". Endpoint weights and the 2400 ceiling are sourced in `.trellis/tasks/09-14-binance-rate-limit-diagnostics/research/binance-rate-limits.md`. Responses without the header (OKX/Bitget) observe `null` and do nothing. The header alone is not a sufficient switch for the limit line, though: `recordLimit` keys off the HTTP status, and OKX answers its own rate limits with 429, so `defaultFetchJson` (the OKX path) injects a silent monitor rather than the shared one — otherwise an OKX 429 would print a `[binance]` line for a limit Binance never raised. Coverage is in `tests/binance-weight-monitor.test.ts`.
