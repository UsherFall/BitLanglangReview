# Market Data

## Data-Source Seam (Coin Scan + Market Heat)

`src/server/market-data.ts` defines the normalized contracts shared by the coin scan and the market-heat service, so those consumers stay data-source-agnostic:

- `Ticker { instrument, quoteVolume24h, lastPrice, change24h, marketClass? }` — normalized ticker; `quoteVolume24h` is in USDT (each source computes it from its native payload), `change24h` is a percent. Optional `marketClass` (a `MarketClass` from `src/domain/market-session.ts`) marks contracts whose market can be closed; absent = ungated (crypto/commodity/pre-IPO, OKX, or metadata unavailable).
- `TickerSource.listTickers(): Promise<Ticker[]>` — full-market snapshot.
- `CandleRequest { instrument, timeframe, anchor, direction: 'earlier' | 'later', limit }` and `CandleSource.getCandlesticks(request): Promise<Candlestick[]>` — same contract as `CandlestickService`.

`app-plugin.ts` wires the selected source via `marketDataSource` option (default `'binance'`) with `process.env.MARKET_DATA_SOURCE` as fallback:

```ts
const marketDataSource = options.marketDataSource ?? process.env.MARKET_DATA_SOURCE ?? 'binance';
const tickerSource = marketDataSource === 'okx' ? new OkxTickerSource() : new BinanceTickerSource(undefined, binanceInstrumentMetadata());
const scanCandleSource = marketDataSource === 'okx' ? candleService : new BinanceCandleSource(candleStore);
```

The coin scan and the market-heat service consume the selected `tickerSource`; the scan also consumes `scanCandleSource`. **FreeReplay and the workbook TradeReview default to the OKX `CandlestickService`** and the OKX instrument list regardless of the setting. The personal review mode (Bitget-sourced trades, tab「个人交割单复盘」) is the exception: its charts pass `source=binance` and are served by the shared `BinanceCandleSource` (see "Personal Review Candle Source").

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
- For `later` requests, map intra-candle anchors to the containing candlestick boundary before calculating the OKX `after` parameter.
- Treat daily candles with the existing Shanghai/UTC offset handling in `boundaryAnchor`.
- Do not return later candles if the first candle after the anchor is missing; gaps break contiguity.

Coverage is in `tests/candlestick-cache.test.ts`.

## Binance Candles (Coin Scan)

`src/server/binance-candles.ts` provides `BinanceCandleSource implements CandleSource`, backed by `fapi/v1/klines`, used by the coin scan when the data source is Binance (the default).

- `timestamp = openTime` — Binance klines open at **UTC 0:00** boundaries, which aligns daily candles with the user's chart view. **No OKX-style -8h offset** is applied (unlike `CandlestickService.boundaryAnchor`).
- Interval mapping: `5m/15m/1H→1h/4H→4h/1D→1d/...` (see `toBinanceInterval`).
- Forming-bar filter: `earlier` requests drop `openTime + intervalMs > anchor`; `later` requests set `startTime = boundaryAnchor(anchor) + intervalMs` so the containing candle is excluded.
- Contiguity: reuses the same `contiguousCandles` logic as the OKX service. The boundary seed is `Math.floor(anchor / step) * step` for **both** directions. This differs from the OKX `boundaryAnchor`, whose `earlier` case uses `Math.ceil` — the OKX fetch keeps the still-forming bar (dropped downstream), while the Binance fetch drops it by time before saving to the cache, so a ceil seed for `earlier` would double-count the missing forming bar and break a contiguous run. Do not change this without re-running the contiguity tests.
- Caching: reuses the shared `CandlestickStore`. Binance instrument names (`XAUUSDT`, `BTCUSDT`) differ from OKX (`XAU-USDT-SWAP`, `BTC-USDT-SWAP`), so the `(instrument, timeframe, timestamp)` primary keys never collide across sources.

Coverage is in `tests/binance-candles.test.ts`.

## Personal Review Candle Source: Binance (09/07)

The「个人交割单复盘」review mode (trades synced from Bitget) requests `source=binance` on `/api/candles`. The route converts the OKX-style instrument (`ZEC-USDT-SWAP`) to the Binance USDT-M symbol (`ZECUSDT`) with `okxInstrumentToBinanceSymbol` (`src/domain/instrument-symbol.ts`) and serves the request with the shared `BinanceCandleSource` instance (the one coin scan uses by default). No fallback: if Binance has no USDT-M perpetual for the instrument (or the mapping returns null) the chart shows the empty state.

Why not Bitget's own candles? Bitget `/api/v2/mix/market/candles` keeps only a **rolling window per granularity** (measured 09/07 on BTCUSDT): 5m ≈ 30 days, 15m ≈ 1–2 months, 1H ≈ 60–90 days, 4H ≈ a few months, while 1D/1W/1M go back years. Intraday charts for any but recent trades were therefore empty, so the personal review default was moved to Binance, whose `fapi/v1/klines` have no such rolling retention (5m data from 2021+). Historical notes kept for future reference:

- Bitget candle rows/caching follow the native-symbol isolation rule (`BTCUSDT` vs OKX `BTC-USDT-SWAP`), the same rule Binance uses.
- Bitget `startTime~endTime` span per request is capped at **90 days** (HTTP 400 code `00001`), so paging windows must not exceed it.
- A `BitgetCandleSource` existed for this mode and was removed when the source moved to Binance; do not re-introduce it without reconsidering the retention gap.

### Source selection notes

- `CandleRequest.instrument` is always the **native symbol of the chosen source**; the route converts from the review's OKX-style instrument (`src/domain/instrument-symbol.ts`).
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

`src/server/binance-instrument-metadata.ts` provides `BinanceInstrumentMetadataSource` (module-shared via `binanceInstrumentMetadata()`): it fetches `fapi/v1/exchangeInfo` once, maps `underlyingType` → `MarketClass` (`EQUITY`→`US_EQUITY`, `HK_EQUITY`/`KR_EQUITY`/`CN_EQUITY`, `COMMODITY`, `PREMARKET`→`PRE_IPO`, `COIN`/`INDEX`→`CRYPTO`, unknown → omitted), and returns a `symbol → MarketClass` map. TTL 6h + in-flight dedupe; any failure/non-array payload degrades to an EMPTY map (no gating), never an error. `BinanceTickerSource` attaches `marketClass` only for classes with a session spec (equities); the coin scan gates on it at the anchor instant using `isMarketOpen` from `src/domain/market-session.ts`. Coverage in `tests/binance-instrument-metadata.test.ts`.

Coverage is in `tests/binance-tickers.test.ts`.

## Error Handling

`defaultFetchJson` aborts OKX requests after 12 seconds and throws when the response is not OK; `defaultBinanceFetchJson` (`src/server/http.ts`) applies the same timeout/error contract to Binance `fapi` endpoints. Both wrap `fetchJsonWithRetry`, which retries Binance's rate-limit responses so a scan survives instead of dying on the first hit: 429 (transient weight-limit) gets exponential backoff honoring `Retry-After`; 418 (IP auto-ban) waits the FULL `Retry-After` (else 2min) then retries exactly ONCE — per Binance, retrying during a ban prolongs it (2min → up to 3 days), so a still-banned IP throws rather than hammer. Non-retryable statuses and network/timeout errors throw immediately. Route handlers convert service failures to HTTP 502 so the UI can show loading failure status without crashing.

### Shared request-rate budget (09/07)

Binance's IP auto-ban (418) is a request-RATE trigger, not only a weight-window one. `binanceRatePacer` (`BINANCE_MIN_INTERVAL_MS=110`, jitter 15ms → ~9 req/s) lives inside `defaultBinanceFetchJson` — the single choke point every Binance outbound passes through (klines/tickers/exchangeInfo) — so the coin scan, the market-heat service, and any future Binance caller share ONE request-start budget; cache hits never reach the fetch and OKX/Bitget requests are unpaced. The 429/418 gate (`binanceRateGate`) behavior is unchanged.