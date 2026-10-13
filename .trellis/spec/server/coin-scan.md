# Instrument Scan (选品)

## 1. Scope / Trigger

The 选品 (Instrument Scan; renamed from 选币 09/16) module finds instruments by pluggable scan methods, split into two sub-modules: **Crypto Scope** (加密: crypto + indices + commodities) and **Equity Scope** (股票: US + Korean equities). The two pools are disjoint and scanned separately, each with its own parameter defaults. V1 ships only the **shrink** (收敛结构) method; 09/08 adds the **heat** (热度) method, which returns the review market-temperature reading (constant Binance Top80 pool, see `market-heat.md`) and exists **only in the crypto scope**. It scans a parameterized universe of **Bitget USDT-FUTURES perpetuals** by default (10/12). The source is selectable **per request** via the `source` query param (the panel's 行情源 selector, 10/12); `MARKET_DATA_SOURCE` / `.env` (shell env wins) / Bitget only decide the **default selection** — one of `binance` (USDT-M) / `okx` (SWAP) / `bitget` (USDT-FUTURES), see `market-data.md`. It detects **波动率收敛** (volatility convergence): a recent band whose per-bar volatility is meaningfully below the same-length stretch immediately before it — "波动率越来越小". **Volume plays no role** — the user's stance is "看裸 K". The pool is derived from the ticker source after three filters: the **scan pool policy** (which classes are covered at all), the requested **scan scope** (which sub-module), and **session gating** (which instruments are open at the anchor). The 24h-volume floor is a low rail, NOT a selector, and `topN` is only an optional cap — the pool is the whole scannable universe of the scope (10/13; see "The pool is the whole scope universe, screened on 1D percentiles (10/13)").

**The scan runs in two stages** (10/13): the coarse timeframe (1D) is fetched for the WHOLE candidate pool and screened on its own percentiles ("盘得够久 + 收住了 + 不在趋势中"), and only the survivors pay for the remaining four timeframes. Row inclusion IS that 1D coarse screen — the per-timeframe convergence columns are still computed and reported for the survivors, but they no longer decide who is in the list.

**Candle series is session-only** (09/16): for a session-gated instrument the detector never sees candles that contain no trading time — closed-market stretches are dropped from the series before `probeStructure` runs, and 2× the raw window is requested to compensate. Ungated classes (crypto, commodity) keep every candle. See "Design Decisions".

**The fractal triangle module was removed** (8/13, user decision): swing detection, backscan, and geometry classification are gone. The scan is purely volatility-driven — there is only one structure kind, `'convergence'`. A rising/falling TREND is rejected by the band's flatness gate, not by a separate triangle detector.

**All measures are RELATIVE** (8/13, user decision): there is no coin-own "typical volatility" baseline and no absolute threshold — the band is compared only to the same-length preceding stretch, because each coin's volatility differs.

**One click scans all 5 timeframes** (5m/15m/1H/4H/1D) with a **uniform candle window** (100 bars for every timeframe; the lookback does not vary with the period). The coarse timeframe is fetched FIRST and alone; the other four only for its survivors. The result is **one row per coarse-screen survivor** with a 结构 column (the 1D measures) and a 收敛结构 column; a surviving coin appears even when it converges on no timeframe at all.

This contract covers `src/server/coin-scan-service.ts`, the `/api/scan` route in `src/server/app-plugin.ts`, the pure algorithm in `src/domain/coin-scan.ts`, and the UI in `src/ui/CoinScanPanel.tsx`.

## 2. Signatures

- Route: `GET /api/scan` (no `timeframe` param — the scan always covers `scanTimeframes`)
- Bootstrap route: `GET /api/scan/config` → `{ source: MarketDataSource }` (the server's startup source; never touches the network). Registered **before** `/api/scan` — connect matches by path prefix, so the scan route would otherwise swallow it.
- Service: `CoinScanService.scanShrink(params: ShrinkScanParams): Promise<ScanResponse>`
- Pure coarse screen (1D, pool-relative): `coarseStructure(candles, params): CoarseMeasures | null`, `coarseScreen(measures, params): { screen, passes }`
- Pure volatility detector: `detectConvergence(candles, params): StructureResult | null` (band vs preceding stretch)
- Probing entry point: `probeStructure(candles, params): StructureResult | null` (forwards to `detectConvergence`)
- Defaults: `defaultStructureParams(overrides?): StructureParams`, `DEFAULT_COARSE_PARAMS: Required<CoarseParams>`

## 3. Contracts

### Request (query params)

| Field | Type | Default | Constraint |
| --- | --- | --- | --- |
| `method` | string | — | `shrink` (收敛结构) or `heat` (热度); anything else → 400 |
| `scope` | string | `crypto` | `crypto` (加密: crypto + indices + commodities) or `equity` (股票: US + Korean equities); anything else → 400; `heat` + `equity` → 400 |
| `source` | string | server startup source (`.env` / `MARKET_DATA_SOURCE`, else `bitget`) | `binance` / `okx` / `bitget`; **absent or anything else falls back to the startup source** (never 400). Selects the ticker / candle / gate trio for THIS request and the `minQuoteVolume24h` default |
| `topN` | number | **absent = no cap** (the whole open pool) | optional CAP (上限保护) since 10/13; when present, `>= 1`. It used to be the hard pool gate (top-150 crypto / 30 equity, raised 60 → 150 on 10/11) — superseded, see "The pool is the whole scope universe, screened on 1D percentiles (10/13)". `0` → 400 |
| `minQuoteVolume24h` | number | per `source × scope` (see "Per-request source and per-source volume floor (10/12)" and the 10/13 "low rail" section) | `>= 0`; instruments below this 24h quote volume are filtered before the coarse screen |
| `anchor` | number (optional) | now | epoch ms; bars whose close time (`timestamp + timeframe`) is `<= anchor` are treated as completed. Absent / empty / NaN → `Date.now()`. Present and `<= 0` → 400 |
| `minScore` | number (optional) | 0 | `>= 0`; the single 宁少勿滥 strength knob (UI default **0.6**). A timeframe counts as converged only when `score >= timeframeMinScore(tf, minScore)`, i.e. this knob shifted by the level's own offset: `max(0, minScore + TIMEFRAME_SCORE_OFFSET[tf])` (0 for 5m/15m/1H, −0.05 for 4H, −0.10 for 1D). Because `score` is the shrink depth and nothing else, the effective bar reads directly as an amplitude statement: at 0.6 the small timeframes demand ≤40% of the preceding stretch, 4H ≤45%, 1D ≤50%. `minScore = 0` (the SERVICE default; the UI always sends a value) degenerates every offset to 0, so an absent knob behaves exactly as before the offsets existed. Absent → 0. Present and `< 0` → 400 |

Non-numeric params fall back to the pair's default — `minQuoteVolume24h` to the table below, and `topN` to ABSENT (never to 0, which would 400 and silently scan nothing). Invalid final values → 400. The defaults live in the private `SCAN_PARAM_DEFAULTS` table, read through `defaultScanParams(source, scope)` (`src/domain/scan-scope.ts`), and are mirrored by the panel's inputs. `MarketDataSource` / `MARKET_DATA_SOURCES` / `DEFAULT_MARKET_DATA_SOURCE` (`'bitget'`) / `isMarketDataSource` are exported from the same module and are the single source of truth for source literals.

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
  convergedTimeframes: ReviewTimeframe[]; // qualified && score >= timeframeMinScore(tf, minScore); ASCENDING (scanTimeframes order), so the last element is the highest level. EMPTY when a coarse-screen survivor converges nowhere
  qualifiedCount: number;        // = convergedTimeframes.length (0 for a survivor with no convergence)
  bestScore: number;             // max score across converged timeframes (larger = stronger); 0 when there are none
  qualified: boolean;            // always true (rows only contain coarse-screen survivors)
  coarse?: CoarseRow;            // 10/13 — the 1D screen's verdict, measures and this scan's cuts
};
type CoarseRow = {
  pass: boolean;                 // always true on a returned row: row inclusion IS the coarse screen
  rangePct: number;              // (max high − min low) / lastClose over the window
  netPct: number;                // |close_last − close_first| / close_first over the same window
  rangePctThreshold: number;     // RECOMPUTED from this scan's pool — identical on every row of one scan
  netPctThreshold: number;
};
type ScanResponse = {
  scanned: ScanRow[];            // the coarse-screen survivors; sorted by highest converged level desc (a survivor with no convergence reads as level -1, so it sinks below every converging row), then qualifiedCount desc, then bestScore desc
  qualifiedCount: number;        // = scanned.length
  params: ShrinkScanParams;      // echoes effective params, including resolved scope/anchor/source; `topN` is absent when it was not sent
  scannedAt: string;             // ISO
  coarse?: CoarseSummary;        // 10/13 — what the 1D screen ran on and with
  warnings?: string[];           // rate-limit backoffs observed during this scan
  skippedInstruments?: string[]; // closed-market instruments (pool-policy exclusions are NOT listed)
  metadataUnavailable?: boolean; // present only when the ticker snapshot carried no instrument classes => gating was off
};
type CoarseSummary = {
  windowDays: number;            // T = 23 (1D bars)
  pctRange: number;              // qR = 0.7370689655172413
  pctNet: number;                // qN = 0.4849137931034483
  poolSize: number;              // instruments that HAD a full window => the percentile base N
  rangePctThreshold: number;     // the cuts derived from that pool for this scan (never constants)
  netPctThreshold: number;
  candidates: number;            // the candidate pool the screen ran on (open pool, capped by topN when given)
};
```

Backward compatibility: `structures` / `convergedTimeframes` / `qualifiedCount` / `bestScore` / `qualified` keep their definitions — only the ROW SET moved (it is now the coarse screen's survivors, so `qualifiedCount` can be 0). `coarse` is optional in the type so a pre-10/13 payload still type-checks; the service always sets it.

### Algorithm: 1D coarse screen (`coarseStructure` + `coarseScreen`)

The row criterion. On the 1D series (≤ 90 bars, see `market-data.md`) each instrument gets two pool-relative measures over the newest **T = 23** bars:

```
rangePct = (max high − min low) / lastClose      // 收住了 — the window's own amplitude
netPct   = |close_last − close_first| / close_first   // 不在趋势中 — direction-free drift
```

and the screen keeps the instruments whose measure ranks fall in the pool's lowest `qR` / `qN` fraction:

```
pass ⟺ rank_asc(rangePct) ≤ floor(qR · N)  ∧  rank_asc(netPct) ≤ floor(qN · N)
N = instruments with a full window; ranks are 1..N and a TIE GROUP TAKES ITS MAXIMUM RANK
```

**The cuts are recomputed from the current pool on every scan and are never written down.** `qR = 0.7370689655172413`, `qN = 0.4849137931034483` and `T = 23` are the only constants (`COARSE_SCREEN_*` in `src/domain/scan-scope.ts`); freezing an absolute `rangePct` / `netPct` threshold instead is what makes a screen decay as the market moves — measured pool-rate drift over 15 anchors **31.2pp → 4.7pp** when the cut became pool-relative (`research/coarse-1d-percentile.md`). `CoarseSummary.rangePctThreshold` / `netPctThreshold` report the cut values of the current scan for display; the DECISION uses the ranks (at a tie straddling the cut, a value equal to the reported threshold can still be rejected).

Three properties are deliberate and must not be "improved":

- **No full window ⇒ excluded, silently.** A 次新币 with fewer than `T` bars has no usable measure, is not part of `N`, and cannot pass. Real data has these (the 10/13 probe: median 89 bars, minimum 12).
- **The screen is WIDE** (≈44% of a 465-name pool) and has **no extra discriminative power**: `AND(qR, qN)` is mathematically an "adaptive absolute box" (measured: the selected count differs from the equivalent absolute box by 0–2 of 465). It exists to shrink the candidate set without dropping a label — precision is the small-timeframe stage's job. Do not raise the thresholds to make it "better"; that was measured to trade the 7/7 coverage for negative-label contamination (8/8, i.e. including ACE, costs pool rate 44% → 61.8% AND lets WLD/MOVR in).
- **A tiny pool degenerates to "nobody passes"**: `floor(q · N)` is 0 for N ≤ 2 and 1–2 for N ≈ 3, so a unit-test-sized pool needs ~10–20 members before the cut means anything. That is a property of the percentile form, not a bug.

**Known residual — component drift.** The pool RATE is stable, the MEMBERSHIP is not: measured over 15 anchors the 7 covered labels hold for ~8 anchors and then start dropping (and WLD — the one borderline negative — starts entering around the 10th). `T` is a SHARP optimum (`T ± 1` loses 1–2 labels), so a change to it needs a re-calibration, not a guess. ACE is a **structural mismatch** (its 23-day range is as wide as the pool's 74th percentile and its drift is far outside the net gate) and is deliberately NOT covered by stage 1 — the user confirmed that, so do NOT loosen a threshold for it.

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
  pooled = filter(quoteVolume24h >= minQuoteVolume24h)      // low rail, not a selector
  for ticker in pooled:                                  // pool policy (09/16) + scope (09/16) + session gating (09/06)
    if not isScannable(ticker.marketClass): continue     // HK/CN/pre-IPO: not in the universe, not a skip
    if scanScopeOf(ticker.marketClass) !== scope: continue // belongs to the other sub-module, not a skip either
    if isMarketOpen(ticker.marketClass ?? 'CRYPTO', anchor): open.push(ticker)
    else skippedInstruments.push(ticker.instrument)
  candidates = params.topN === undefined ? open : open.slice(0, params.topN)   // optional cap only
  minScore = params.minScore ?? 0
  refresh = params.anchor === undefined

  // ---- stage 1: the coarse timeframe for the WHOLE candidate pool ----
  coarseFetches = mapLimit(candidates, concurrency 5, ticker =>
    { ticker, completed: completedCandles(ticker, '1D', anchor, refresh) })  // 1 request each
  measures = coarseFetches.map(({completed}) => coarseStructure(completed, DEFAULT_COARSE_PARAMS))
  { screen, passes } = coarseScreen(measures, DEFAULT_COARSE_PARAMS)         // cuts from THIS pool

  // ---- stage 2: the other four timeframes, only for the survivors ----
  tasks = survivors × {5m,15m,1H,4H}
  results = mapLimit(tasks, concurrency 5, ({ticker, timeframe}) =>
    ({ ticker, timeframe, structure: probeStructure(completed(ticker, timeframe, anchor, refresh), defaultStructureParams()) }))

  for [i, {ticker, completed}] in coarseFetches:
    if not passes[i]: continue                     // 行入选 = 粗筛通过
    structures['1D'] = probeStructure(completed) ?? neutral   // stage-1 series reused, no extra request
    structures[tf]  = results[tf] ?? neutral                  // the other four
    converged = scanTimeframes.filter(tf => structures[tf].qualified && structures[tf].score >= timeframeMinScore(tf, minScore))
    rows.push({ ..., structures, convergedTimeframes: converged, qualifiedCount: converged.length,
                bestScore: converged.length ? max(score) : 0, qualified: true,
                coarse: { pass: true, rangePct, netPct, rangePctThreshold: screen.rangePctThreshold, netPctThreshold: screen.netPctThreshold } })
  highestLevel(row) = converged.length ? max(scanTimeframes.indexOf(tf)) : -1   // no convergence sinks below every converging row
  rows.sort(highestLevel desc, qualifiedCount desc, bestScore desc)   // equal keys keep the ticker (24h-volume) order (stable sort)
  if tickerSource.metadataAvailable?.() === false: response.metadataUnavailable = true
  response.coarse = { windowDays, pctRange, pctNet, poolSize: screen.poolSize, rangePctThreshold, netPctThreshold, candidates: candidates.length }
  return { scanned: rows, qualifiedCount: rows.length, params: { ...params, anchor, scope }, scannedAt, coarse, ... }
```

`completedCandles(ticker, tf, anchor, refresh)` is the one shared fetch helper: it requests `scanWindowFor(ticker.marketClass)` bars through the candle source, then drops the still-forming bar BY TIME (`timestamp + timeframeMs(tf) <= anchor`) and any untraded bar (`isCandleInSession`). Both filters are needed — see "Session-only series" below.

- **Uniform candle window**: `SCAN_WINDOW = 100` **tradable** bars for EVERY timeframe (8/13, user decision: the lookback must not vary with the period). The detector needs a band + a same-length preceding stretch, so the window holds both. Session-gated instruments request `2 × SCAN_WINDOW` RAW bars because the untraded ones are dropped — 2× keeps a weekday window full and a Monday-morning window ~2/3 full, while staying in Binance's cheapest klines weight band (`< 500` → weight 2). Cover this with a test that asserts the requested `limit` per class. On Bitget, the 1D `limit` of 100 really yields **≤ 90** bars (hard exchange cap, see `market-data.md`) — the coarse window `T = 23` fits, but nothing may assume a full 100.
- **Scan pool policy** (09/16): `isScannable(marketClass)` in `src/domain/scan-pool.ts` decides the universe — crypto / indices / commodities / US equities / Korean equities are IN; HK equities, A-shares and pre-IPO are OUT (no trustworthy session, and pre-IPO has no underlying market at all). Symbols outside the policy are **not** reported in `skippedInstruments`; they are a pool definition, not a per-scan skip. An absent class stays IN the pool so a metadata outage cannot empty a scan.
- **Session gating** (09/06, widened 09/16): instruments whose underlying **Market Session** is closed at `anchor` are dropped AFTER the 24h-volume gate, so a closed **TradFi Instrument** never fires a klines request (and, when `topN` is used, never holds a slot). Class comes from the ticker's optional `marketClass` (Binance `exchangeInfo` metadata, TTL-cached). The US window is **04:00–20:00 ET** (pre-market + regular + after-hours; the thin overnight session is treated as closed). Skipped symbols are echoed as `skippedInstruments` and shown in the UI as 「已跳过 N 个休市标的」. Pure session math lives in `src/domain/market-session.ts`.
- **Session-only series** (09/16): `isCandleInSession(marketClass, open, barMs)` keeps a candle only when part of its span falls inside a session window. Ungated classes short-circuit to `true`. The span test (not an "open time inside the window" test) is what makes the UTC-aligned **daily** candles work: Binance daily candles open at 20:00 ET, so an open-time test would drop every one of them, while a span test keeps exactly the days containing a session and drops weekends and holidays.
- **Metadata degradation is visible** (09/16): `BinanceTickerSource.metadataAvailable()` reports whether the last snapshot attached classes; when it did not, the response carries `metadataUnavailable` and the UI states that closed-market filtering was off. A silent outage would judge closed equity contracts as crypto.
- The forming bar is dropped **by time** (`timestamp + timeframeMs(timeframe) <= anchor`). Do not `slice(0, -1)` unconditionally — the candle cache may contain no forming bar.
- **Concurrency**: 5 in-flight candle fetches (mapLimit-style) shared by both stages. Binance request *starts* are paced by the SHARED `binanceRatePacer` (`src/server/http.ts`, `BINANCE_MIN_INTERVAL_MS=110`, jitter 15ms → ~9 req/s) inside `defaultBinanceFetchJson`, and Bitget's by `bitgetMarketRatePacer` (50ms + 10ms jitter, ~20 req/s) inside `defaultBitgetMarketFetchJson` — so one click shares a single rate budget with every other caller (market heat included) and the scan never paces itself. 50ms/20 req/s for BINANCE (the old per-scan pacer) still tripped 418 occasionally; 110ms is the agreed conservative ceiling (09/07, user decision). Measured budget after the 10/13 pool expansion (Bitget crypto, 13 Oct 2026, live): **408 candidates → 407 measurable → 179 survivors → 1124 klines requests (408 stage-1 + 716 stage-2) in 58s**, versus 750 requests ≈82s for the old top-150 × 5 cold scan — same order, and unrejected instruments cost exactly one request.
- **Sorting** is done by the service: `highestLevel` descending first (a contraction on a bigger level is rarer, so a lone 1D convergence outranks a lone 5m one — 10/11), then `qualifiedCount` descending (cross-timeframe consistency), then `bestScore` descending. `highestLevel` = the max `scanTimeframes` index over `convergedTimeframes`, derived at sort time — `ScanRow` carries no level field. A survivor with NO convergence reads as **-1**, so it sinks below every converging row while keeping its ticker (24h-volume) order among its peers. Equal keys keep the original ticker (24h-volume) order (`Array#sort` is stable).

### Candle cache freshness

`BinanceCandleSource` (and the OKX `CandlestickService`) keep a shared SQLite candle cache. A full cache is reused only when it covers the moment being read:

- A **"current" scan** (anchor near `Date.now()`) whose newest cached bar lags the anchor by more than two steps is STALE — a previous scan populated the store, and repeat scans would otherwise return old bars forever. Such a cache is refreshed from the exchange before use.
- A **historical anchor** (a fixed point in the past) is always fresh: that data never changes, and the cache is reused.

## 4. Validation & Error Matrix

| Condition | Error |
| --- | --- |
| non-GET method | 405 |
| `method` not in {`shrink`,`heat`} | 400 `Unsupported scan method` |
| `topN` present and `< 1` | 400 `Invalid scan parameters` |
| `anchor` present and `<= 0` | 400 `Invalid scan parameters` |
| `minQuoteVolume24h < 0` | 400 `Invalid scan parameters` |
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
- `tests/coin-scan-coarse.test.ts` — the pure coarse screen:
  - `coarseStructure`: measures exactly the newest `T` bars (a 30-bar series whose first 7 bars are wild measures 0.02 at T=23 and 0.51 at T=30); order-insensitive; `netPct` is direction-free while `rangePct` divides by the LAST close (so rising and falling windows differ there on purpose); `null` for < T bars (次新币), non-positive prices and non-finite input; and it is INDEPENDENT of the detector (a uniformly calm series measures fine while `detectConvergence` returns null — the screen must not inherit "越来越小").
  - `coarseScreen`: rank cuts are `floor(q·N)` on a 20-name pool (14 range / 9 net, 9 pass); the cuts are the POOL's own values, recomputed per pool (two pools in the same order but on a 10× scale pass identically while the thresholds scale); a TIE GROUP takes its MOST CONSERVATIVE rank, so 19 identical members all fail; the boundary is `≤` (rank 5 passes with cut 5, rank 6 does not); an unmeasurable member is excluded from `N` and never passes; a pool too small for the cut degenerates to `nobody passes` (cut 0, threshold `-Infinity`); the defaults are the three documented constants.
- `tests/coin-scan-service.test.ts` — aggregation: **row inclusion is the coarse screen** (a 1D-trending coin is dropped even when its 5m converges, and its 5m is never requested; a coarse-tight coin that converges nowhere still gets a row with `qualifiedCount` 0 / `bestScore` 0); **two-stage fetching** (1D for all 20 candidates, the other four only for the survivors — 28 requests — and no filler gets a second timeframe); the `coarse` echo (`poolSize`, `candidates`, thresholds); `topN` as a CAP (5 candidates requested, `coarse.candidates` 5, `params.topN` echoed); the volume floor filters before the screen (`coarse.poolSize` counts only the above-floor instruments). Plus the pre-10/13 blocks, all built on a ~20-name pool because the cut degenerates below that: all-5-timeframe scan, uniform window (limit 100 / 200 for gated), forming bar dropped by time, `change24h`/`lastPrice` carried, sort `highestLevel desc → qualifiedCount desc → bestScore desc` (a coarse survivor with no convergence sinks below every converging row), the lone-1D-vs-three-small-timeframes case, per-timeframe threshold (1D 0.51 / 4H 0.44 → `['1D']`; the 0.576 band isolates the 4H offset), `minScore` gate, neutral zeros, past anchor echoed, one coin on multiple timeframes as one row, insufficient history → empty (and `coarse.poolSize` 0), rate-limit warnings, session gating (closed equity never requested, kept out, skipped), session-only series (identical candles converge for crypto and yield nothing for an equity sitting in the closed window), per-class window, and `metadataUnavailable`.
- `tests/market-session.test.ts` — session math: the 04:00–20:00 US window incl. the DST switch, weekends, NYSE holidays/early closes, HK/KR/CN windows, ungated classes, the current-year coverage assertion, and `isCandleInSession` (edge candles that only partly overlap, the UTC-aligned daily candles that would all be dropped by an open-time test, and ungated classes that never lose a candle).
- `tests/scan-pool.test.ts` — `isScannable`: crypto/commodity/US/KR in; HK/CN/pre-IPO out; unclassified in.
- `tests/scan-scope.test.ts` — `ScanScope` narrowing, `scanScopeOf` (US/KR → equity, everything else incl. unclassified → crypto), `MarketDataSource` guards (`isMarketDataSource` accepts the three literals, rejects others), the `defaultScanParams` matrix (binance 10M/10M, bitget 100k/3M, okx 1M/1M — **all floors positive, no `topN` default**), and the coarse constants (`T` 23, `qR` ≈ 0.7371 > `qN` ≈ 0.4849, both inside (0,1)).
- `tests/coin-scan-panel.test.tsx` — the sub-module switch: current scope marked, 热度 offered only in the crypto scope, parameters reset to the scope's defaults on switch, 热度 selection dropped when switching to equities, no `onScopeChange` when re-clicking the active scope. Plus the 行情源 selector: `/api/scan/config` stubbed to a non-default source seeds the selector and re-derives the inputs; switching 行情源 re-derives the floor from `defaultScanParams`; a scan sends `source`. Plus the 10/13 cap semantics: `扫描数量` starts EMPTY and the scan request carries no `topN`; a filled value is sent as `topN`; a `0` is a parameter error and issues no request.
- `tests/coin-scan-results.test.tsx` — the results surface: the skipped-instrument hint stays inside the detail header, the grid keeps exactly two top-level children, the server order is rendered as-is, manual demotion sinks/greys rows without re-ranking, and (10/13) the 结构 column renders the coarse measures with the scan's cuts in its title while the header reports 候选 vs 收敛.
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

Binance USDT-M lists 191 TradFi perpetuals (US/HK/KR/CN equities + commodities + pre-IPO). They print 24/7 candlesticks that simply go quiet when the underlying exchange is closed, so a volatility-shrink scan would otherwise flag a closed market as "extremely converged" — the result list filling with dormant NVDA/TSLA-style contracts. Gate order is 成交额门槛 → 池子策略 → 休市剔除 (a closed contract must not burn klines budget on the 1D stage). The domain is pure (`market-session.ts`): IANA-timezone windows + built-in NYSE holiday/early-close tables (maintained yearly, coverage asserted in tests), no calendar npm dependency. The market-heat module applies the same pool policy and gate (see `market-heat.md`).

09/16 rework, all measured (`09-16-coin-scan-equity-source/research/session-pollution-measurements.md`):

- **US window widened to 04:00–20:00 ET** — pre-market included. Measured: the 04:00 ET hour carries the highest non-regular volatility (MUUSDT median 5m range 0.222%, 3–4× the 17:00–19:00 ET trough), so the old 09:30–16:00 window was discarding the liveliest extended-session hour. The 20:00–04:00 overnight session stays closed.
- **Session-only series added** — a closed stretch must not be *measurable*, not merely *unlisted*. Measured on 1H: dropping untraded candles removes ~96 windows whose "convergence" was an artifact of the closed stretch, at the cost of changing the verdict on others (the relative band-vs-preceding test reads differently once both sides hold only traded bars). On 5m the filter is a no-op (the window rarely spans a closure).
- **Why a calendar and not a smarter source** (all verified): Yahoo's free chart API is the only free source covering US + Korean equities with pre/post bars, and it rate-limits after ~40 requests (429 for >15 min). Binance Stocks' real-session equity K-lines exist **only** as a live WebSocket feed (`{symbol}@kline_5m`, public) with no REST history and no 15m/4h; Binance equity perps are 24/5 in reality (only weekends collapse to 1–2% of peak volume, a US holiday keeps ~half), so "closed" cannot be derived from the data. Hong Kong / A-share / pre-IPO instruments are therefore out of the pool rather than guessed at.

### Pool size and level weighting (10/11) — pool part superseded 10/13

Trigger: STRKUSDT, which started a run in early October after a quiet late-September. Replaying the scan around 2026-09-29 showed the coin was missed by THREE independent gates, not one, so all three were revisited (user decisions):

1. **Pool was too small** — the scan pool is selected from the CURRENT 24h quote volume (the anchor only picks the candles), so at the time STRK sat at ~16.8M USDT, rank 169/740, while the top-60 cutoff that day was ~110M. `crypto.topN` was therefore raised **60 → 150**, reaching the mid-cap tier that only converges on 4H/1D. This adds LATENCY (~33s → ~82s cold, 1500 weight), not 418 risk — the shared 110ms pacer still caps the process at ~1090 weight/min.

   > **Superseded 10/13** — 150 ranks still far too high: the user-approved labels sit as deep as #319. `topN` is no longer a gate at all (the pool is the whole scope universe) and the volume floor is a low rail; see "The pool is the whole scope universe, screened on 1D percentiles (10/13)". The measurement above is kept as the reason the raised cut was NOT enough, not as a description of current behaviour.
2. **The threshold ignored the level** — STRK's service-口径 1D score at 12:00Z was **0.5522**, short of the flat 0.6 bar, while its 4H was 0.4424. A single knob is kept (the UI still has exactly one 结构强度阈值 input) but it is now shifted per level by `TIMEFRAME_SCORE_OFFSET` (4H −0.05, 1D −0.10), so at 0.6 the 1D bar is 0.50 and STRK qualifies. `-0.10` rather than `-0.05` on purpose: 0.5522 against a 0.55 bar would be razor-thin.
3. **Ordering buried the rare setup** — the sort was `qualifiedCount` first, which ranks "5m+15m+1H converged" above "1D converged". Order is now **highest qualified level** first, then count, then score.

The key boundary kept intact: `score` itself is UNCHANGED — no level term was added back (that would re-litigate 09/20). The level is expressed through the THRESHOLD and the ORDER only, so the 强度分 column still reports the raw shrink depth.

Expected, not a regression: the list gets longer (a 1D/4H-only convergence now qualifies) and the order changes for existing rows. Both are the point of the change.

### Per-request source and per-source volume floor (10/12)

Trigger: the scan's default source moved to Bitget, and the pool visibly collapsed. Measured 2026-10-12, Bitget's 24h quote volume on overlapping instruments is ≈**0.10** of Binance's, so Binance's `10_000_000` floor — a no-op on Binance, where 189 instruments clear it and `topN` (top-150 cutoff ≈15.7M) binds first — left Bitget with only **33** crypto instruments (top-150 cutoff ≈0.75M) and **12** equity ones. The floor, not `topN`, was deciding the pool.

Two coupled decisions:

1. **The floor is source × scope.** Originally it had to stay BELOW that venue's own `topN` cutoff so `topN` remained the only hard gate. `defaultScanParams(source, scope)` returns:

   | source | scope | minQuoteVolume24h (10/13) |
   | --- | --- | --- |
   | binance | crypto / equity | 10_000_000 / 10_000_000 |
   | bitget | crypto / equity | **100_000** / 3_000_000 |
   | okx | crypto / equity | 1_000_000 / 1_000_000 |

   Measured 10/12 for the original values (Bitget crypto 189 ≥ 0.5M vs the top-150 cutoff 0.75M; Bitget equity 36 ≥ 3M vs the top-30 cutoff 3.86M; OKX 232 ≥ 1M vs 2.81M). **Bitget crypto was lowered 500_000 → 100_000 on 10/13**, because with `topN` gone the floor is a rail, and at 500k it was still SELECTING: it kept only 224 of the 465 crypto contracts and dropped KAVA (287k), CATI (245k) and ACE (433k) — three of the eight user-approved labels (BLESS at 493k only just cleared). At 100_000 the pool is 408 of 465 and every approved label has ≥2.4× headroom. OKX lists no RWA/equity contracts and classifies nothing, so its equity scope is empty and its floor is a placeholder for symmetry.

2. **The source is a REQUEST param, not a startup binding.** `MARKET_DATA_SOURCE` / the plugin option now only set the default. `/api/scan` resolves `source` per request and picks a pre-built `{ tickerSource, candleSource, gate }` trio plus that source's `CoinScanService` / `MarketHeatService`. The panel's 行情源 selector (币安 / OKX / Bitget) initialises from `GET /api/scan/config` (the startup source) and sends `source` with every scan; switching it re-derives `minQuoteVolume24h` (and clears the `扫描数量` cap) from `defaultScanParams`. The `/api/market-heat` route (the review 市场热度 popover) deliberately stays on the startup source.

An illegal `MARKET_DATA_SOURCE` now degrades to Bitget (was Binance), so "no source" and "bad source" mean the same thing.

### The pool is the whole scope universe, screened on 1D percentiles (10/13)

Trigger: the calibration for "1D 粗筛 + 小级别绝对收敛" found the real bottleneck was not the detector but the **scan pool**. Of the 8 labels the user approved as "structurally good" (2026-10-12 判读), four were unreachable at ANY detector quality because their 24h-volume ranks sit far below the top-150 cutoff — measured 10/13 on Bitget crypto: BLESS #224 (493k), ACE #247 (433k), KAVA #298 (287k), CATI #319 (245k). Only PROM/RIVER/BGB/TRX ever reached the scan. The user therefore approved scanning the WHOLE crypto universe, and the pool definition changed as follows:

- **`topN` stops being a gate.** Defaults carry no `topN`; the pool is the whole open universe of the scope. The parameter survives as an optional CAP (上限保护) the panel can set — when it is present it must still be `>= 1`, because `0` would silently scan nothing. This SUPERSEDES the 10/11 "raise topN 60 → 150" decision (kept above with a note): the tier that cut reached was still ~150 ranks too high.
- **The volume floor becomes a low rail.** Its only job is to keep empty/dust contracts out of the candle budget. Bitget crypto 500_000 → 100_000 (see the 10/12 section) — at 500k the floor itself was hiding KAVA/CATI/ACE.
- **The row criterion moves to a pool-relative 1D coarse screen** (盘得够久 + 收住了 + 不在趋势中): the newest 23 1D bars, `rangePct` and `|netPct|` ranked INSIDE the current pool, keep the lowest `qR` / `qN` fraction. Constants live in `scan-scope.ts`; the cuts are recomputed every scan. The full definition is in "Algorithm: 1D coarse screen". `minScore` and the per-timeframe convergence machinery are untouched — they still describe each survivor's structure, they just no longer decide inclusion.
- **Two-stage fetching keeps the expanded pool affordable**: 1D for every candidate, the other four timeframes only for the survivors. Measured 10/13 live: 408 candidates → 407 measurable → 179 rows (44.0%) → **1124 requests in 58s** (vs 750 ≈82s for the old top-150 cold scan), the same order as before.

Verified on real data (10/13, Bitget crypto, live) — and this is the part a future reader must not misread:

- **Pool membership is fixed.** All four formerly-unreachable labels are IN the candidate pool (and SYN, a negative, is in it too — it is rejected by the screen, not by the pool).
- **The screen reproduces its calibration exactly.** Rolling the same fetched 1D series back day by day (d1..d8) gives 7/7 covered labels with **0 negative-label contamination**, which is precisely what `research/coarse-1d-percentile.md` reported for the 465-pool calibration at `T=23/0.7371/0.4849`.
- **Known residual — component drift, NOT a defect.** Membership decays with the anchor: measured over 15 anchors the coverage is 7/7 for d1–d8, 6/7 at d9, then 6/7 with WLD (the one borderline negative) entering at d11–d13 and 3/7 at d14. The newest live anchor (d0) covers **5/7** (PROM/RIVER/KAVA/BGB/TRX) with 0 negatives: the extra day of data widened CATI's drift to 11.6% and BLESS's to 10.6% against a cut of 9.7% (they PASS at d1, where the same windows measured 5.7% / 9.2%). This is the drift the percentile form does NOT remove (it only removes pool-RATE decay), it is documented in the calibration, and it is what the small-timeframe stage is for.
- **ACE is not covered, by decision.** Its 23-day range sits at the pool's 74th percentile and its drift is far outside the net gate — a structural mismatch, confirmed by the user, deliberately NOT bought back by loosening a threshold (8/8 coverage was measured to cost pool rate 44% → 61.8% AND to admit WLD/MOVR).
