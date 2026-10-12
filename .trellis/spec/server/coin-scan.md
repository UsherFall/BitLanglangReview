# Instrument Scan (选品)

## 1. Scope / Trigger

The 选品 (Instrument Scan; renamed from 选币 09/16) module finds instruments by pluggable scan methods, split into two sub-modules: **Crypto Scope** (加密: crypto + indices + commodities) and **Equity Scope** (股票: US + Korean equities). The two pools are disjoint and scanned separately, each with its own parameter defaults. V1 ships only the **shrink** (收敛结构) method; 09/08 adds the **heat** (热度) method, which returns the review market-temperature reading (constant Binance Top80 pool, see `market-heat.md`) and exists **only in the crypto scope**. It scans a parameterized universe of **Bitget USDT-FUTURES perpetuals** by default (10/12). The source is selectable **per request** via the `source` query param (the panel's 行情源 selector, 10/12); `MARKET_DATA_SOURCE` / `.env` (shell env wins) / Bitget only decide the **default selection** — one of `binance` (USDT-M) / `okx` (SWAP) / `bitget` (USDT-FUTURES), see `market-data.md`. It detects **波动率收敛** (volatility convergence): a recent band whose per-bar volatility is meaningfully below the same-length stretch immediately before it — "波动率越来越小". **Volume plays no role** — the user's stance is "看裸 K". The pool is derived from the ticker source (all USDT-M perpetuals above the `minQuoteVolume24h` floor, taking the top `topN`) after three filters: the **scan pool policy** (which classes are covered at all), the requested **scan scope** (which sub-module), and **session gating** (which instruments are open at the anchor).

**Candle series is session-only** (09/16): for a session-gated instrument the detector never sees candles that contain no trading time — closed-market stretches are dropped from the series before `probeStructure` runs, and 2× the raw window is requested to compensate. Ungated classes (crypto, commodity) keep every candle. See "Design Decisions".

**The fractal triangle module was removed** (8/13, user decision): swing detection, backscan, and geometry classification are gone. The scan is purely volatility-driven — there is only one structure kind, `'convergence'`. A rising/falling TREND is rejected by the band's flatness gate, not by a separate triangle detector.

**All measures are RELATIVE** (8/13, user decision): there is no coin-own "typical volatility" baseline and no absolute threshold — the band is compared only to the same-length preceding stretch, because each coin's volatility differs.

**One click scans all 5 timeframes** (5m/15m/1H/4H/1D) with a **uniform candle window** (100 bars for every timeframe; the lookback does not vary with the period). The result is **one row per coin** with a 收敛结构 column; a coin appears when it converges on at least one timeframe.

This contract covers `src/server/coin-scan-service.ts`, the `/api/scan` route in `src/server/app-plugin.ts`, the pure algorithm in `src/domain/coin-scan.ts`, and the UI in `src/ui/CoinScanPanel.tsx`.

## 2. Signatures

- Route: `GET /api/scan` (no `timeframe` param — the scan always covers `scanTimeframes`)
- Bootstrap route: `GET /api/scan/config` → `{ source: MarketDataSource }` (the server's startup source; never touches the network). Registered **before** `/api/scan` — connect matches by path prefix, so the scan route would otherwise swallow it.
- Service: `CoinScanService.scanShrink(params: ShrinkScanParams): Promise<ScanResponse>`
- Pure volatility detector: `detectConvergence(candles, params): StructureResult | null` (band vs preceding stretch)
- Probing entry point: `probeStructure(candles, params): StructureResult | null` (forwards to `detectConvergence`)
- Defaults: `defaultStructureParams(overrides?): StructureParams`

## 3. Contracts

### Request (query params)

| Field | Type | Default | Constraint |
| --- | --- | --- | --- |
| `method` | string | — | `shrink` (收敛结构) or `heat` (热度); anything else → 400 |
| `scope` | string | `crypto` | `crypto` (加密: crypto + indices + commodities) or `equity` (股票: US + Korean equities); anything else → 400; `heat` + `equity` → 400 |
| `source` | string | server startup source (`.env` / `MARKET_DATA_SOURCE`, else `bitget`) | `binance` / `okx` / `bitget`; **absent or anything else falls back to the startup source** (never 400). Selects the ticker / candle / gate trio for THIS request and the `minQuoteVolume24h` default |
| `topN` | number | `crypto` 150 / `equity` 30 | `>= 1` (source-independent; crypto raised 60 → 150 on 10/11; see "Pool size and level weighting (10/11)") |
| `minQuoteVolume24h` | number | per `source × scope` (see "Per-request source and per-source volume floor (10/12)") | `>= 0`; instruments below this 24h quote volume are filtered before Top-N selection |
| `anchor` | number (optional) | now | epoch ms; bars whose close time (`timestamp + timeframe`) is `<= anchor` are treated as completed. Absent / empty / NaN → `Date.now()`. Present and `<= 0` → 400 |
| `minScore` | number (optional) | 0 | `>= 0`; the single 宁少勿滥 strength knob (UI default **0.6**). A timeframe counts as converged only when `score >= timeframeMinScore(tf, minScore)`, i.e. this knob shifted by the level's own offset: `max(0, minScore + TIMEFRAME_SCORE_OFFSET[tf])` (0 for 5m/15m/1H, −0.05 for 4H, −0.10 for 1D). Because `score` is the shrink depth and nothing else, the effective bar reads directly as an amplitude statement: at 0.6 the small timeframes demand ≤40% of the preceding stretch, 4H ≤45%, 1D ≤50%. `minScore = 0` (the SERVICE default; the UI always sends a value) degenerates every offset to 0, so an absent knob behaves exactly as before the offsets existed. Absent → 0. Present and `< 0` → 400 |

Non-numeric params fall back to the pair's default (never to 0 — an absent `topN` must not become `0` and 400). Invalid final values → 400. The defaults live in the private `SCAN_PARAM_DEFAULTS` table, read through `defaultScanParams(source, scope)` (`src/domain/scan-scope.ts`), and are mirrored by the panel's inputs. `MarketDataSource` / `MARKET_DATA_SOURCES` / `DEFAULT_MARKET_DATA_SOURCE` (`'bitget'`) / `isMarketDataSource` are exported from the same module and are the single source of truth for source literals.

`scope` decides the universe, not the data source: every source serves both scopes now. Binance classifies via `exchangeInfo` metadata, **Bitget (the default since 10/12) via the contracts endpoint's `isRwa` flag — two buckets, CRYPTO vs US_EQUITY** (see `market-data.md`), and OKX leaves instruments unclassified (everything reads as crypto-like, so its equity pool is empty). `crypto` = every scannable class that is not a US/Korean equity, **including instruments whose class is unknown** (metadata outage) — the pre-09/16 conservative fallback. `equity` = `US_EQUITY` + `KR_EQUITY` only. The two pools never overlap, and classes outside the pool policy appear in neither. Under the Bitget default, RWA contracts (US stocks, and — by the two-bucket rule — gold/oil/indices/FX/HK/JP/pre-IPO) sit in the equity scope gated to 04:00–20:00 ET.

`method=heat` responds with `MarketHeatResult` (`domain/market-heat.ts`) instead — the overall market-temperature reading for the fixed Top80 pool at `anchor`, computed against the **request-selected `source`** (the whole 选品 module moves together, 10/12; UI renders it through the shared `MarketHeatView`). Only `source` and `anchor` apply for heat (still crypto-scope only).

`source` is resolved **per request** in the route (validated with `isMarketDataSource`; absent/illegal → startup source), which picks a pre-built `{ tickerSource, candleSource, gate }` trio and the matching `CoinScanService` / `MarketHeatService` instance (`Record<MarketDataSource, …>`). Both services are stateless across requests; `MarketHeatService`'s anchor cache is therefore isolated per source. The echoed `params.source` rides along so the UI can label a result's venue and results from different sources are not silently compared.

### Response (`ScanResponse`)

```ts
type ConvergenceStructure = 'convergence'; // the only structure kind (triangle removed)
type StructureResult = {
  structure: ConvergenceStructure | null; // null = this timeframe has no convergence
  position: number;                       // 0..1: (lastPrice - rangeLow)/(rangeHigh - rangeLow)
  score: number;                          // shrink depth = clamp01(1 - runMed/preMed), larger = stronger, [0,1]
  touchCount: number;                     // always 0 (no swing touches; kept for the row contract)
  qualified: boolean;                     // passed the shrink + flatness + containment gates
};
type ScanRow = {
  instrument: string;            // XAUUSDT / BTCUSDT (Binance), BTC-USDT-SWAP (OKX)
  lastPrice: number;
  change24h: number;             // percent
  quoteVolume24h: number;        // 24h quote volume in USDT (liquidity floor)
  structures: Record<ReviewTimeframe, StructureResult>; // all 5 timeframes, scanTimeframes order
  convergedTimeframes: ReviewTimeframe[]; // qualified && score >= timeframeMinScore(tf, minScore); ASCENDING (scanTimeframes order), so the last element is the highest level
  qualifiedCount: number;        // = convergedTimeframes.length
  bestScore: number;             // max score across qualified timeframes (larger = stronger)
  qualified: boolean;            // always true (only converged coins appear)
};
type ScanResponse = {
  scanned: ScanRow[];            // only coins with >= 1 qualified timeframe; sorted by highest qualified level desc, then qualifiedCount desc, then bestScore desc
  qualifiedCount: number;        // = scanned.length
  params: ShrinkScanParams;      // echoes effective params, including resolved scope/anchor/source
  scannedAt: string;             // ISO
  skippedInstruments?: string[]; // closed-market instruments excluded before topN (present only when non-empty; pool-policy exclusions are NOT listed)
  metadataUnavailable?: boolean; // present only when the ticker snapshot carried no instrument classes => gating was off
};
```

### Algorithm: volatility convergence (`detectConvergence`)

Walks the RAW BARS looking for a recent band whose bar-to-bar volatility is meaningfully below the same-length stretch immediately before it — "波动率越来越小". Sliding scan over every possible band start (the band always ends at the last bar); a band must pass:

1. **Flatness** — the band is a quiet HORIZONTAL band, not a trend. Its low-edge and high-edge regression drifts must both be `<= flatRatio × runMed`, where `runMed` is the band's own median per-bar volatility (edge drift = total OLS drift / mean price, a relative measure). This also rejects a rising/falling trend whose relative amplitude naturally shrinks as price climbs (which would otherwise fake a "volatility shrink").
2. **Volatility shrink** — `runMed < convergenceRatio × preMed`, where `preMed` is the median per-bar volatility of the SAME-LENGTH segment immediately before the band. Internal spikes are absorbed by the median.
3. **Containment** — the newest bar's close must still sit inside the range the band was **CONFIRMED at**, with a 10% tolerance (relative to that range's own height): a price that broke out is no longer 蓄力. The confirmed range is built from the band's first `runLen - CONVERGENCE_CONFIRMED_TAIL` bars — i.e. deliberately WITHOUT the newest bar, which is the bar being tested. Including it makes the check vacuously true (a real candle's close always lies inside its own `[low, high]`), which is the bug fixed on 09/20 (see "Design Decisions"). Flatness and containment are independent: flatness asks whether the band is SLOPED, containment asks whether the price LEFT it.

No coin-own "typical volatility" baseline: everything is judged against the preceding stretch only (8/13, user decision). A crash-then-pause band (a big dump followed by a quiet stretch) IS detected as a strong shrink because its band is far quieter than the dump; the band's flatness gate usually rejects such wide post-dump bands (their edges drift too much), which is how the CBRS 大跌后喘息 case stays out. Whether further exclusion is needed is flagged as an open calibration decision.

**Score is the shrink depth ALONE** (09/20 — the length bonus was removed):

```
relativeCalm = clamp01(1 - runMed / preMed)   // how much quieter the band is than before
score        = relativeCalm
```

Duration is deliberately unscored: see "Score is the shrink depth alone (09/20)" under Design Decisions. Because nothing else enters the score, the UI default `minScore` **0.6** reads directly as an amplitude statement — the band's median per-bar amplitude must be at most 40% of the preceding stretch's — and raising the knob is a direct tightening of that ratio.

**The knob is applied per timeframe** (10/11): the level's own offset (`TIMEFRAME_SCORE_OFFSET`) is subtracted before the comparison, so at the default 0.6 the effective bars are 0.60 (5m/15m/1H), 0.55 (4H) and 0.50 (1D). This is how "a contraction on a bigger level is a rarer setup" is expressed — deliberately WITHOUT adding a level term back into `score` (which would re-litigate 09/20).

### Calibration constants (`src/domain/coin-scan.ts`, all exported)

| Constant | Value | Meaning |
| --- | --- | --- |
| `scanTimeframes` | `['5m','15m','1H','4H','1D']` | the 5 scanned timeframes; also defines the LEVEL order (index 0 = 5m … 4 = 1D) used for sorting |
| `TIMEFRAME_SCORE_OFFSET` | `{ 5m:0, 15m:0, 1H:0, 4H:-0.05, 1D:-0.10 }` (typed `Partial<Record<ReviewTimeframe, number>>`) | per-level shift applied to the single `minScore` knob (10/11). Only the 5 scanned timeframes carry an entry; a lookup miss reads as 0 |
| `timeframeMinScore` | `(tf, minScore) => Math.max(0, minScore + (TIMEFRAME_SCORE_OFFSET[tf] ?? 0))` | the effective per-timeframe threshold — the ONLY place the offset is applied |
| `DEFAULT_CONVERGENCE_MIN_RUN` | 5 | min band length (K bars) for a convergence. Load-bearing since 09/20: with duration unscored the best band tends to be short, so this is the only floor keeping bands from being a couple of bars |
| `DEFAULT_CONVERGENCE_RATIO` | 0.9 | shrink gate: band median vol must be `< this ×` preceding median vol (0.9 admits mild real shrinks; the score ranks them) |
| `DEFAULT_CONVERGENCE_FLAT_RATIO` | 2.0 | band flatness: edge regression drift `<= this × runMed` (the band's own noise) |
| `CONVERGENCE_CONFIRMED_TAIL` | 1 | bars at the band's tail EXCLUDED from the containment range (1 = test the newest bar against the `runLen - 1` bars before it). Structural, not a calibration knob |

### Service aggregation

```
scanShrink(params):
  tickers = tickerSource.listTickers()
  anchor = params.anchor ?? Date.now()
  scope = params.scope ?? 'crypto'
  pooled = filter(quoteVolume24h >= minQuoteVolume24h)
  for ticker in pooled:                                  // pool policy (09/16) + scope (09/16) + session gating (09/06)
    if not isScannable(ticker.marketClass): continue     // HK/CN/pre-IPO: not in the universe, not a skip
    if scanScopeOf(ticker.marketClass) !== scope: continue // belongs to the other sub-module, not a skip either
    if isMarketOpen(ticker.marketClass ?? 'CRYPTO', anchor): open.push(ticker)
    else skippedInstruments.push(ticker.instrument)
  top = open.slice(0, topN)                              // closed markets never occupy a topN slot
  minScore = params.minScore ?? 0
  tasks = top × scanTimeframes
  results = mapLimit(tasks, concurrency 5, ({ticker, timeframe}) => {
    // Request starts are paced GLOBALLY in `defaultBinanceFetchJson` (~9 req/s),
    // shared with every other Binance caller; the scan no longer paces itself.
    step = timeframeMs(timeframe)
    limit = session-gated ? 2 × SCAN_WINDOW : SCAN_WINDOW
    candles = candleSource.getCandlesticks({ instrument, timeframe, anchor, direction: 'earlier', limit, refresh: anchor === undefined })
    completed = candles.filter(c => c.timestamp + step <= anchor            // drop forming bar by time
                              && isCandleInSession(marketClass, c.timestamp, step)) // drop untraded candles
    return probeStructure(completed, defaultStructureParams())
  })
  for coin in top:
    structures = scanTimeframes.map(tf => result ?? neutral { structure: null, position:0, score:0, touchCount:0, qualified:false })
    converged = scanTimeframes.filter(tf => structures[tf].qualified && structures[tf].score >= timeframeMinScore(tf, minScore))
    if converged.length == 0: continue        // 宁少勿滥
    rows.push({ ..., structures, convergedTimeframes, qualifiedCount, bestScore: max(converged.score) })
  highestLevel(row) = max(scanTimeframes.indexOf(tf) for tf in row.convergedTimeframes)  // converged is non-empty (the push is behind the `continue` above)
  rows.sort(highestLevel desc, qualifiedCount desc, bestScore desc)   // score larger = stronger; equal keys keep the ticker (24h-volume) order (stable sort)
  if tickerSource.metadataAvailable?.() === false: response.metadataUnavailable = true
  return { scanned: rows, qualifiedCount: rows.length, params: { ...params, anchor }, scannedAt, ... }
```

- **Uniform candle window**: `SCAN_WINDOW = 100` **tradable** bars for EVERY timeframe (8/13, user decision: the lookback must not vary with the period). The detector needs a band + a same-length preceding stretch, so the window holds both. Session-gated instruments request `2 × SCAN_WINDOW` RAW bars because the untraded ones are dropped — 2× keeps a weekday window full and a Monday-morning window ~2/3 full, while staying in Binance's cheapest klines weight band (`< 500` → weight 2). Cover this with a test that asserts the requested `limit` per class.
- **Scan pool policy** (09/16): `isScannable(marketClass)` in `src/domain/scan-pool.ts` decides the universe — crypto / indices / commodities / US equities / Korean equities are IN; HK equities, A-shares and pre-IPO are OUT (no trustworthy session, and pre-IPO has no underlying market at all). Symbols outside the policy are **not** reported in `skippedInstruments`; they are a pool definition, not a per-scan skip. An absent class stays IN the pool so a metadata outage cannot empty a scan.
- **Session gating** (09/06, widened 09/16): instruments whose underlying **Market Session** is closed at `anchor` are dropped AFTER the 24h-volume gate and BEFORE the `topN` slice, so a closed **TradFi Instrument** never consumes a topN slot nor fires klines requests. Class comes from the ticker's optional `marketClass` (Binance `exchangeInfo` metadata, TTL-cached). The US window is **04:00–20:00 ET** (pre-market + regular + after-hours; the thin overnight session is treated as closed). Skipped symbols are echoed as `skippedInstruments` and shown in the UI as 「已跳过 N 个休市标的」. Pure session math lives in `src/domain/market-session.ts`.
- **Session-only series** (09/16): `isCandleInSession(marketClass, open, barMs)` keeps a candle only when part of its span falls inside a session window. Ungated classes short-circuit to `true`. The span test (not an "open time inside the window" test) is what makes the UTC-aligned **daily** candles work: Binance daily candles open at 20:00 ET, so an open-time test would drop every one of them, while a span test keeps exactly the days containing a session and drops weekends and holidays.
- **Metadata degradation is visible** (09/16): `BinanceTickerSource.metadataAvailable()` reports whether the last snapshot attached classes; when it did not, the response carries `metadataUnavailable` and the UI states that closed-market filtering was off. A silent outage would judge closed equity contracts as crypto.
- The forming bar is dropped **by time** (`timestamp + timeframeMs(timeframe) <= anchor`). Do not `slice(0, -1)` unconditionally — the candle cache may contain no forming bar.
- **Concurrency**: 5 in-flight candle fetches (mapLimit-style). Binance request *starts* are paced by the SHARED `binanceRatePacer` (`src/server/http.ts`, `BINANCE_MIN_INTERVAL_MS=110`, jitter 15ms → ~9 req/s) inside `defaultBinanceFetchJson`, so the whole pipeline — one click = 750 forced-fresh klines requests (topN 150 × 5 timeframes) plus any concurrent market-heat fetch — shares a single rate budget well under Binance's IP auto-ban (418) threshold. 50ms/20 req/s (the old per-scan pacer) still tripped 418 occasionally; 110ms is the agreed conservative ceiling (09/07, user decision). 150 × 5 klines = 1500 weight per cold scan spread over ~82s, and the 110ms pacer caps the process at ~1090 weight/min (≈45% of the 2400 IP ceiling), so the raised topN adds LATENCY, not 418 risk (10/11). OKX-path scans are not paced by this budget.
- **Sorting** is done by the service: `highestLevel` descending first (a contraction on a bigger level is rarer, so a lone 1D convergence outranks a lone 5m one — 10/11), then `qualifiedCount` descending (cross-timeframe consistency), then `bestScore` descending. `highestLevel` = the max `scanTimeframes` index over `convergedTimeframes`, derived at sort time — `ScanRow` carries no level field. Equal keys keep the original ticker (24h-volume) order (`Array#sort` is stable).

### Candle cache freshness

`BinanceCandleSource` (and the OKX `CandlestickService`) keep a shared SQLite candle cache. A full cache is reused only when it covers the moment being read:

- A **"current" scan** (anchor near `Date.now()`) whose newest cached bar lags the anchor by more than two steps is STALE — a previous scan populated the store, and repeat scans would otherwise return old bars forever. Such a cache is refreshed from the exchange before use.
- A **historical anchor** (a fixed point in the past) is always fresh: that data never changes, and the cache is reused.

## 4. Validation & Error Matrix

| Condition | Error |
| --- | --- |
| non-GET method | 405 |
| `method` not in {`shrink`,`heat`} | 400 `Unsupported scan method` |
| `topN < 1` / `minQuoteVolume24h < 0` | 400 `Invalid scan parameters` |
| `anchor` present and `<= 0` | 400 `Invalid scan parameters` |
| `minScore` present and `< 0` | 400 `Invalid scan parameters` |
| `source` absent or not one of `binance`/`okx`/`bitget` | **no error** — falls back to the server startup source |
| Binance/OKX tickers or candlestick fetch fails | 502 with readable message |

## 5. Good/Base/Bad Cases

- **Good**: a coin whose recent band is meaningfully quieter than the same-length stretch before it (e.g. 16 volatile bars then 16 flat calm bars → band/preceding ≈ 0.16, score ≈ 0.84). The score IS that complement, so the default `minScore 0.6` admits any band at ≤40% of its preceding stretch on 5m/15m/1H, ≤45% on 4H and ≤50% on 1D (the per-level offsets).
- **Base**: a uniformly calm coin (band vol ≈ preceding vol → ratio ≈ 1) has no "越来越小" tension and is rejected. A band with no preceding stretch (too few bars) returns null. A price that has broken out of the band is rejected by containment — and containment must compare the newest bar against a range built WITHOUT it (`CONVERGENCE_CONFIRMED_TAIL`), otherwise the check is vacuous.
- **Bad**: a rising/falling trend (whose relative amplitude shrinks as price climbs) is rejected by the band's flatness gate. A crash-then-pause band is detected as a strong shrink by the pure band-vs-preceding rule; its wide post-dump edges usually fail the flatness gate, but if a narrow post-crash band shows up it will qualify — an open calibration decision flagged in the task notes.

## 6. Tests Required

- `tests/coin-scan.test.ts` — pure algorithm:
  - `detectConvergence`: band quieter than preceding → convergence ≥0.7; uniformly calm → null; short mild band → <0.7; **`score` is the shrink depth alone, independent of band length** (09/20 — same amplitude ratio on a 5-bar vs an 11-bar band, fixtures carrying 5 vs 16 quiet bars after an identical lead, must score identically and must equal `1 - bandMedian/precedingMedian`; under the removed length bonus those two were 0.68 vs 0.89, so the test fails if a duration term returns); **breakout rejected only when the newest bar left the CONFIRMED range** (09/20 — a paired control/breakout fixture differing in one legal bar, whose comment records the flatness/shrink margins proving containment is the rejecting gate); **`position` read off the confirmed range, not the whole band** (09/20, `position = 0.6` where the whole-band range would give 0.5); too few bars → null; non-positive price → null; crash-then-pause detected (known consequence); mild shrink (band ≈ 60% of preceding) → <0.7; stricter `convergenceRatio` filters more. Fixtures must be LEGAL candles (`low <= open/close <= high`) — an illegal `close` is what let the old containment test reach a gate that real data never reaches.
  - `probeStructure`: forwards to the convergence detector; trending channel → null.
  - defaults: constants + `defaultStructureParams` fills all thresholds.
  - `timeframeMinScore` (10/11): default 0.6 → 1D 0.50 / 4H 0.55 / 5m·15m·1H 0.60; `minScore = 0` degenerates to 0 for every timeframe; a negative shift is floored at 0; an unscanned timeframe (1m/1W/1M) reads as offset 0. The literal `TIMEFRAME_SCORE_OFFSET` is asserted so a typo in the table fails the build.
- `tests/coin-scan-service.test.ts` — aggregation: Top-N + all 5 timeframes, **uniform window (limit 100 for every timeframe)**, forming bar dropped by time, `change24h` carried, non-converged coins hidden, **sort `highestLevel desc → qualifiedCount desc → bestScore desc`** (a lone-1D row ranks ahead of a lone-5m+15m+1H row — the case that fails if the sort reverts to `qualifiedCount` first; equal keys keep the ticker order), **per-timeframe threshold** (a band at 1D 0.51 / 4H 0.44 yields `convergedTimeframes = ['1D']` at minScore 0.6; a 0.576 band is the only fixture between the 4H bar 0.55 and the small-timeframe bar 0.60, so it isolates the 4H offset — it converges on 4H+1D only), `minScore` gate (0.4 admits the weak fixture at 0.415, 0.7 filters it — the permissive value moved from 0.5 when the score became the shrink depth alone), neutral zeros, past anchor echoed, one coin converging on multiple timeframes as a single row, insufficient history → empty. Plus the 09/16 blocks: session gating (closed equity dropped, kept out of topN, candles never requested; historical weekend anchor behaves the same), **session-only series** (identical candle fixture converges for crypto and yields nothing for an equity whose only bars sit in the closed overnight window), **per-class window** (gated class requests `limit` 200, ungated 100), and **`metadataUnavailable`** (present only when the ticker source reports no classes).
- `tests/market-session.test.ts` — session math: the 04:00–20:00 US window incl. the DST switch, weekends, NYSE holidays/early closes, HK/KR/CN windows, ungated classes, the current-year coverage assertion, and `isCandleInSession` (edge candles that only partly overlap, the UTC-aligned daily candles that would all be dropped by an open-time test, and ungated classes that never lose a candle).
- `tests/scan-pool.test.ts` — `isScannable`: crypto/commodity/US/KR in; HK/CN/pre-IPO out; unclassified in.
- `tests/scan-scope.test.ts` — `ScanScope` narrowing, `scanScopeOf` (US/KR → equity, everything else incl. unclassified → crypto), `MarketDataSource` guards (`isMarketDataSource` accepts the three literals, rejects others), and the `defaultScanParams` matrix (binance 10M/10M, bitget 0.5M/3M, okx 1M/1M; topN 150/30).
- `tests/coin-scan-panel.test.tsx` — the sub-module switch: current scope marked, 热度 offered only in the crypto scope, parameters reset to the scope's defaults on switch, 热度 selection dropped when switching to equities, no `onScopeChange` when re-clicking the active scope. Plus the 行情源 selector: `/api/scan/config` stubbed to a non-default source seeds the selector and re-derives the inputs; switching 行情源 re-derives `topN`/`minQuoteVolume24h` from `defaultScanParams`; a scan sends `source`.
- `tests/binance-candles.test.ts` — cache freshness: a stale "now" cache is refreshed; a fresh "now" cache is reused; a historical anchor always reuses the cache.

## 7. Wrong vs Correct

#### Wrong

```ts
// Old model: geometric swing triangles + a coin-own "typical volatility" baseline.
const structure = probeStructure(completed, { …slopeTolerance, touchMin, priorAmplitude… });
// → triangle labels misled the user; coinVol baseline felt opaque and unused.
```

#### Correct

```ts
// Pure relative volatility shrink: band vs the same-length preceding stretch.
const structure = detectConvergence(completed, defaultStructureParams());
// → only "波动率越来越小" verdicts, all reported as 收敛.
```

## Design Decisions

### Volatility shrink replaces swing geometry (8/13)

The fractal triangle detector (swing points, backscan, geometry classification) was removed. It produced labels (三角) that misdescribed what are really volatility convergences (e.g. BR 5m/15m are calm bands, not wedges) and the user rejected the concept outright. The scan now answers one question per timeframe: is the recent band quieter than the stretch before it?

### Everything relative to the preceding stretch — no coin-own baseline (8/13)

No `coinVol` "typical volatility" and no absolute thresholds: every measure is a ratio of the band to the same-length preceding segment. Rationale: each coin's volatility differs (BTC ~0.15% per 5m bar vs a small cap ~5%), so an absolute "how big is a bar" test is meaningless; and the user explicitly dropped the coin-own baseline as opaque. The lookback window is also uniform across timeframes (100 bars) per user decision.

### Calm-dominant score with a strict default threshold

`score = 0.7 × relativeCalm + 0.3 × length` — the degree of the shrink drives the score; length is a maturity bonus. The UI default minScore (0.7) surfaces only strong contractions; mild real shrinks score ~0.5-0.6 and are hidden until the knob is lowered. The previous length-dominant formula (`0.85×length`) let any long mediocre band score ~0.9 — that inflation is gone.

> **Superseded 09/20** — the length term was removed entirely, and the UI default threshold was re-read as 0.6 (the "0.7" in this entry was stale; see the next entry).

### Score is the shrink depth alone (09/20)

The length term was removed: `score = relativeCalm = clamp01(1 - runMed/preMed)`. The reason is that `clamp01(runLen / lengthScale)` **cannot do the job it was kept for**. With `lengthScale = 16` it is a constant `1.0` for every band of 16 bars or more — so it never ranked two long bands against each other ("maturity bonus" was unachievable) — and it is strictly below 1.0 for shorter bands, so its only observable effect was to push SHORT bands down. That is precisely backwards for a scan whose point is to surface convergence EARLY: at `minScore 0.6` the old formula demanded `calm ≥ 0.723` from a 5-bar band but only `0.429` from a 16-bar band, so "quiet for 5 bars but 4× quieter than before" scored below "quiet for 16 bars but merely half as quiet".

Threshold calibration is offline only (the local `data/review.sqlite` candle cache; repeated Binance probing had triggered HTTP 418). Measured over 86 USDT instruments × 5 timeframes = 352 windows, three thresholds were compared for the new score, with the OLD formula frozen as a mirror:

| threshold | qualified | early (<16 bars) | added | dropped |
| --- | --- | --- | --- | --- |
| 0.43 (old formula's long-band equivalent) | 87 | 64 | +52 | **0** (superset) |
| 0.50 | 54 | 45 | +34 | 15 |
| **0.60 (chosen)** | **19** | **15** | **+8** | **24** |
| old baseline (0.7/0.3 + 0.6) | 35 | 9 | — | — |

The superset property is provable and was measured: old-qualified ⟹ `calm ≥ (0.6 − 0.3L)/0.7 ≥ 0.4286`, so a 0.43 threshold cannot lose a single existing result. It was **rejected anyway** in favour of 0.60 — a purer list (宁少勿滥) at the cost of dropping 24 of the 35 existing results. **That churn is expected, not a regression**: any future reader seeing the list shrink by two thirds should read this entry rather than hunt for a bug. The numeric default happened to stay `0.6`, so the panel needed no change.

Two consequences to keep in mind:

- **The chosen band gets systematically shorter** — median band length went from 17 bars to 6 (measured). `minRun` therefore became load-bearing, but raising it was measured and **rejected**: at `minRun ≥ 8` the early-stage gain collapses to zero, 5m goes to zero rows and 1D to one or none. Short bands are the price of early detection, accepted deliberately (the user's stance: what a convergence is worth depends on WHERE it happened, not how long it lasted).
- The volatility measures were left untouched, so a band that still qualifies scores exactly as its shrink depth — no separate re-calibration of `flatRatio` / `convergenceRatio` / the 10% containment tolerance was needed.

Numbers, probes and the frozen old-formula mirror live in `09-20-early-convergence-calibration/research/` (`threshold-calibration.md`, `minrun-sweep.md`, `applied-measurement.md`). The probe also cross-checks the shipped `detectConvergence` against the calibrated mirror: 0 mismatches over 352 windows.

### Flatness gate doubles as the crash-pause rejection

The band must be a quiet horizontal band (edge drift ≤ 2× its own noise). Beyond rejecting trends, this also rejects the wide post-dump bands (CBRS 大跌后喘息) whose edges drift too much — so the pure band-vs-preceding rule does not flood the scan with crash-aftermaths.

Measured 09/20: flatness was ALSO the de-facto breakout filter all along — appending one legal upside breakout bar to a converging series makes every candidate band fail the flatness gate (edge drift 0.099–0.229 against `flatTol = 2 × runMed = 0.020`), so "a broken-out coin drops off the list" held even while the containment gate was dead code (next entry).

### Containment must exclude the bar it tests (09/20)

The containment gate spent its whole life as dead code. The band always ends at the last bar, and a real candle's close always lies inside its own `[low, high]`, so `min(band.low) <= lastPrice <= max(band.high)` held by construction and the gate could never reject anything. Measured over 60 crypto instruments × 5 timeframes: **0 rejections out of 28200 candidate bands**. Two consequences: the breakout protection silently fell through to the flatness gate, and the only test covering containment could reach it solely by supplying an impossible candle (`high 100.5` with `close 130`).

Fix: the confirmed range is now built from the band's first `runLen - CONVERGENCE_CONFIRMED_TAIL` bars (`CONVERGENCE_CONFIRMED_TAIL = 1`), and `position` reads that same range — one range, one meaning (`src/domain/coin-scan.ts`). The volatility measures (`runMed` / `preMed` / edge drift) deliberately keep the FULL band: they measure "how quiet is it now" and must include the newest bar, whereas the range is a judgement BASELINE and must not contain the object it judges. Keeping the volatility measures unchanged also means a band that still passes scored exactly as before *this* fix, which is what makes the impact measurable (the SCORE formula itself changed separately, later on 09/20 — see "Score is the shrink depth alone (09/20)").

Measured impact (60 crypto instruments × 5 timeframes, `minScore 0.6`, four independent samples): containment rejections **0 → 103~155**, coins on the list Δ ∈ {0, −1}, qualified (coin × timeframe) pairs Δ ∈ {0, −2}. So this is a correctness/semantics fix, not a tightening — real breakouts were already caught by flatness. `research/containment-delta.md` in `09-20-shrink-containment-breakout` holds the numbers, and also records the one user-visible side effect: the panel's 「位置」 percentage (`CoinScanPanel.tsx`, `position × 100`) is unchanged for 36 of 41 qualified rows, moves by up to 25 points on 5, and can read exactly 0%/100% where the newest bar left the confirmed range but stayed inside the tolerance (the pre-existing `clamp01`).

### Sub-modules split the POOL, not the data source (09/16)

Both scopes read Binance USDT-M candles; what differs is the universe and the session semantics. The split is driven by a measurement: with one merged pool ranked by 24h quote volume, **19 of the top 60 slots** went to TradFi contracts (MUUSDT 310M, MSTRUSDT 225M, SAMSUNGUSDT 140M…), crowding live crypto out of the scan. It also keeps the crypto scope free of session math — it never drops a candle and never consults a calendar. `ReviewMode` stays `'scan'` and the route stays `/api/scan`; only the labels (选品, 加密/股票) and the `scope` parameter are new, and the absent-scope path is byte-identical to the pre-09/16 behaviour.

### Session gating + session-only series: keep closed markets out of the scan (09/06, reworked 09/16)

Binance USDT-M lists 191 TradFi perpetuals (US/HK/KR/CN equities + commodities + pre-IPO). They print 24/7 candlesticks that simply go quiet when the underlying exchange is closed, so a volatility-shrink scan would otherwise flag a closed market as "extremely converged" — the result list filling with dormant NVDA/TSLA-style contracts. Gate order is 成交额门槛 → 池子策略 → 休市剔除 → topN (a closed contract must not steal a slot or burn klines budget). The domain is pure (`market-session.ts`): IANA-timezone windows + built-in NYSE holiday/early-close tables (maintained yearly, coverage asserted in tests), no calendar npm dependency. The market-heat module applies the same pool policy and gate (see `market-heat.md`).

09/16 rework, all measured (`09-16-coin-scan-equity-source/research/session-pollution-measurements.md`):

- **US window widened to 04:00–20:00 ET** — pre-market included. Measured: the 04:00 ET hour carries the highest non-regular volatility (MUUSDT median 5m range 0.222%, 3–4× the 17:00–19:00 ET trough), so the old 09:30–16:00 window was discarding the liveliest extended-session hour. The 20:00–04:00 overnight session stays closed.
- **Session-only series added** — a closed stretch must not be *measurable*, not merely *unlisted*. Measured on 1H: dropping untraded candles removes ~96 windows whose "convergence" was an artifact of the closed stretch, at the cost of changing the verdict on others (the relative band-vs-preceding test reads differently once both sides hold only traded bars). On 5m the filter is a no-op (the window rarely spans a closure).
- **Why a calendar and not a smarter source** (all verified): Yahoo's free chart API is the only free source covering US + Korean equities with pre/post bars, and it rate-limits after ~40 requests (429 for >15 min). Binance Stocks' real-session equity K-lines exist **only** as a live WebSocket feed (`{symbol}@kline_5m`, public) with no REST history and no 15m/4h; Binance equity perps are 24/5 in reality (only weekends collapse to 1–2% of peak volume, a US holiday keeps ~half), so "closed" cannot be derived from the data. Hong Kong / A-share / pre-IPO instruments are therefore out of the pool rather than guessed at.

### Pool size and level weighting (10/11)

Trigger: STRKUSDT, which started a run in early October after a quiet late-September. Replaying the scan around 2026-09-29 showed the coin was missed by THREE independent gates, not one, so all three were revisited (user decisions):

1. **Pool was too small** — the scan pool is selected from the CURRENT 24h quote volume (the anchor only picks the candles), so at the time STRK sat at ~16.8M USDT, rank 169/740, while the top-60 cutoff that day was ~110M. `crypto.topN` was therefore raised **60 → 150**, reaching the mid-cap tier that only converges on 4H/1D. This adds LATENCY (~33s → ~82s cold, 1500 weight), not 418 risk — the shared 110ms pacer still caps the process at ~1090 weight/min.
2. **The threshold ignored the level** — STRK's service-口径 1D score at 12:00Z was **0.5522**, short of the flat 0.6 bar, while its 4H was 0.4424. A single knob is kept (the UI still has exactly one 结构强度阈值 input) but it is now shifted per level by `TIMEFRAME_SCORE_OFFSET` (4H −0.05, 1D −0.10), so at 0.6 the 1D bar is 0.50 and STRK qualifies. `-0.10` rather than `-0.05` on purpose: 0.5522 against a 0.55 bar would be razor-thin.
3. **Ordering buried the rare setup** — the sort was `qualifiedCount` first, which ranks "5m+15m+1H converged" above "1D converged". Order is now **highest qualified level** first, then count, then score.

The key boundary kept intact: `score` itself is UNCHANGED — no level term was added back (that would re-litigate 09/20). The level is expressed through the THRESHOLD and the ORDER only, so the 强度分 column still reports the raw shrink depth.

Expected, not a regression: the list gets longer (a 1D/4H-only convergence now qualifies) and the order changes for existing rows. Both are the point of the change.

### Per-request source and per-source volume floor (10/12)

Trigger: the scan's default source moved to Bitget, and the pool visibly collapsed. Measured 2026-10-12, Bitget's 24h quote volume on overlapping instruments is ≈**0.10** of Binance's, so Binance's `10_000_000` floor — a no-op on Binance, where 189 instruments clear it and `topN` (top-150 cutoff ≈15.7M) binds first — left Bitget with only **33** crypto instruments (top-150 cutoff ≈0.75M) and **12** equity ones. The floor, not `topN`, was deciding the pool.

Two coupled decisions:

1. **The floor is source × scope.** It must stay BELOW that venue's own `topN` cutoff so `topN` remains the only hard gate. `defaultScanParams(source, scope)` returns:

   | source | scope | topN | minQuoteVolume24h |
   | --- | --- | --- | --- |
   | binance | crypto / equity | 150 / 30 | 10_000_000 / 10_000_000 |
   | bitget | crypto / equity | 150 / 30 | **500_000** / **3_000_000** |
   | okx | crypto / equity | 150 / 30 | 1_000_000 / 1_000_000 |

   Each value was picked so the floor clears ≥ `topN` instruments on that venue (Bitget crypto: 189 ≥ 0.5M vs top-150 cutoff 0.75M; Bitget equity: 36 ≥ 3M vs top-30 cutoff 3.86M; OKX: 232 ≥ 1M vs 2.81M). OKX lists no RWA/equity contracts and classifies nothing, so its equity scope is empty and its floor is a placeholder for symmetry.

2. **The source is a REQUEST param, not a startup binding.** `MARKET_DATA_SOURCE` / the plugin option now only set the default. `/api/scan` resolves `source` per request and picks a pre-built `{ tickerSource, candleSource, gate }` trio plus that source's `CoinScanService` / `MarketHeatService`. The panel's 行情源 selector (币安 / OKX / Bitget) initialises from `GET /api/scan/config` (the startup source) and sends `source` with every scan; switching it re-derives `topN` / `minQuoteVolume24h` from `defaultScanParams`. The `/api/market-heat` route (the review 市场热度 popover) deliberately stays on the startup source.

An illegal `MARKET_DATA_SOURCE` now degrades to Bitget (was Binance), so "no source" and "bad source" mean the same thing.
