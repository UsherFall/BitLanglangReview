# Coin Scan (选币)

## 1. Scope / Trigger

The 选币 (Coin Scan) module finds instruments by pluggable scan methods. V1 ships only the **shrink** (收敛结构) method. It scans a parameterized universe of **Binance USDT-M perpetuals** by default (switchable to OKX SWAP via `MARKET_DATA_SOURCE=okx`) and detects **波动率收敛** (volatility convergence): a recent band whose per-bar volatility is meaningfully below the same-length stretch immediately before it — "波动率越来越小". **Volume plays no role** — the user's stance is "看裸 K". The pool is derived from the ticker source (all USDT-M perpetuals above the `minQuoteVolume24h` floor, taking the top `topN`).

**The fractal triangle module was removed** (8/13, user decision): swing detection, backscan, and geometry classification are gone. The scan is purely volatility-driven — there is only one structure kind, `'convergence'`. A rising/falling TREND is rejected by the band's flatness gate, not by a separate triangle detector.

**All measures are RELATIVE** (8/13, user decision): there is no coin-own "typical volatility" baseline and no absolute threshold — the band is compared only to the same-length preceding stretch, because each coin's volatility differs.

**One click scans all 5 timeframes** (5m/15m/1H/4H/1D) with a **uniform candle window** (100 bars for every timeframe; the lookback does not vary with the period). The result is **one row per coin** with a 收敛结构 column; a coin appears when it converges on at least one timeframe.

This contract covers `src/server/coin-scan-service.ts`, the `/api/scan` route in `src/server/app-plugin.ts`, the pure algorithm in `src/domain/coin-scan.ts`, and the UI in `src/ui/CoinScanPanel.tsx`.

## 2. Signatures

- Route: `GET /api/scan` (no `timeframe` param — the scan always covers `scanTimeframes`)
- Service: `CoinScanService.scanShrink(params: ShrinkScanParams): Promise<ScanResponse>`
- Pure volatility detector: `detectConvergence(candles, params): StructureResult | null` (band vs preceding stretch)
- Probing entry point: `probeStructure(candles, params): StructureResult | null` (forwards to `detectConvergence`)
- Defaults: `defaultStructureParams(overrides?): StructureParams`

## 3. Contracts

### Request (query params)

| Field | Type | Default | Constraint |
| --- | --- | --- | --- |
| `method` | string | — | must be `shrink`; anything else → 400 |
| `topN` | number | 50 | `>= 1` |
| `minQuoteVolume24h` | number | 10_000_000 | `>= 0`; instruments below this 24h quote volume are filtered before Top-N selection |
| `anchor` | number (optional) | now | epoch ms; bars whose close time (`timestamp + timeframe`) is `<= anchor` are treated as completed. Absent / empty / NaN → `Date.now()`. Present and `<= 0` → 400 |
| `minScore` | number (optional) | 0 | `>= 0`; a timeframe counts as converged only when `score >= minScore`. The 宁少勿滥 strength knob (UI default 0.7). Absent → 0. Present and `< 0` → 400 |

Non-numeric params fall back to the default. Invalid final values → 400.

### Response (`ScanResponse`)

```ts
type ConvergenceStructure = 'convergence'; // the only structure kind (triangle removed)
type StructureResult = {
  structure: ConvergenceStructure | null; // null = this timeframe has no convergence
  position: number;                       // 0..1: (lastPrice - rangeLow)/(rangeHigh - rangeLow)
  score: number;                          // convergence strength, larger = stronger, normalized [0,1]
  touchCount: number;                     // always 0 (no swing touches; kept for the row contract)
  qualified: boolean;                     // passed the shrink + flatness + containment gates
};
type ScanRow = {
  instrument: string;            // XAUUSDT / BTCUSDT (Binance), BTC-USDT-SWAP (OKX)
  lastPrice: number;
  change24h: number;             // percent
  quoteVolume24h: number;        // 24h quote volume in USDT (liquidity floor)
  structures: Record<ReviewTimeframe, StructureResult>; // all 5 timeframes, scanTimeframes order
  convergedTimeframes: ReviewTimeframe[]; // timeframes with structure.qualified && score >= minScore
  qualifiedCount: number;        // = convergedTimeframes.length
  bestScore: number;             // max score across qualified timeframes (larger = stronger)
  qualified: boolean;            // always true (only converged coins appear)
};
type ScanResponse = {
  scanned: ScanRow[];            // only coins with >= 1 qualified timeframe; sorted by qualifiedCount desc, then bestScore desc
  qualifiedCount: number;        // = scanned.length
  params: ShrinkScanParams;      // echoes effective params, including resolved anchor
  scannedAt: string;             // ISO
  skippedInstruments?: string[]; // closed-market contracts excluded before topN (present only when non-empty)
};
```

### Algorithm: volatility convergence (`detectConvergence`)

Walks the RAW BARS looking for a recent band whose bar-to-bar volatility is meaningfully below the same-length stretch immediately before it — "波动率越来越小". Sliding scan over every possible band start (the band always ends at the last bar); a band must pass:

1. **Flatness** — the band is a quiet HORIZONTAL band, not a trend. Its low-edge and high-edge regression drifts must both be `<= flatRatio × runMed`, where `runMed` is the band's own median per-bar volatility (edge drift = total OLS drift / mean price, a relative measure). This also rejects a rising/falling trend whose relative amplitude naturally shrinks as price climbs (which would otherwise fake a "volatility shrink").
2. **Volatility shrink** — `runMed < convergenceRatio × preMed`, where `preMed` is the median per-bar volatility of the SAME-LENGTH segment immediately before the band. Internal spikes are absorbed by the median.
3. **Containment** — the current price is inside the band's `[min low, max high]` with a 10% tolerance: a price that broke out is no longer 蓄力.

No coin-own "typical volatility" baseline: everything is judged against the preceding stretch only (8/13, user decision). A crash-then-pause band (a big dump followed by a quiet stretch) IS detected as a strong shrink because its band is far quieter than the dump; the band's flatness gate usually rejects such wide post-dump bands (their edges drift too much), which is how the CBRS 大跌后喘息 case stays out. Whether further exclusion is needed is flagged as an open calibration decision.

**Score is calm-dominant** (length no longer dominates):

```
relativeCalm        = clamp01(1 - runMed / preMed)   // how much quieter than before
lengthContribution  = clamp01(runLen / lengthScale)
score               = clamp01(0.7 × relativeCalm + 0.3 × lengthContribution)
```

With the UI default minScore 0.7 this surfaces only strong contractions (≈2×+ shrinks); mild real shrinks (BR 5m at ~1.3×, score ≈ 0.6) are detected but hidden until the user lowers the knob.

### Calibration constants (`src/domain/coin-scan.ts`, all exported)

| Constant | Value | Meaning |
| --- | --- | --- |
| `scanTimeframes` | `['5m','15m','1H','4H','1D']` | the 5 scanned timeframes |
| `DEFAULT_CONVERGENCE_MIN_RUN` | 5 | min band length (K bars) for a convergence |
| `DEFAULT_CONVERGENCE_RATIO` | 0.9 | shrink gate: band median vol must be `< this ×` preceding median vol (0.9 admits mild real shrinks; the score ranks them) |
| `DEFAULT_CONVERGENCE_FLAT_RATIO` | 2.0 | band flatness: edge regression drift `<= this × runMed` (the band's own noise) |
| `DEFAULT_CONVERGENCE_LENGTH_SCALE` | 16 | score length scale (this many bars = full length marks) |
| `CONVERGENCE_SCORE_CALM_WEIGHT` | 0.7 | calm-dominant score weight |
| `CONVERGENCE_SCORE_LENGTH_WEIGHT` | 0.3 | length (maturity bonus) score weight |

### Service aggregation

```
scanShrink(params):
  tickers = tickerSource.listTickers()
  anchor = params.anchor ?? Date.now()
  pooled = filter(quoteVolume24h >= minQuoteVolume24h)
  for ticker in pooled:                                  // session gating (09/06)
    if isMarketOpen(ticker.marketClass ?? 'CRYPTO', anchor): open.push(ticker)
    else skippedInstruments.push(ticker.instrument)
  top = open.slice(0, topN)                              // closed markets never occupy a topN slot
  minScore = params.minScore ?? 0
  tasks = top × scanTimeframes
  results = mapLimit(tasks, concurrency 5, ({ticker, timeframe}) => {
    pacer.pace()   // ≥50ms between request starts → ≤20 req/s, avoids Binance 418 IP ban
    candles = candleSource.getCandlesticks({ instrument, timeframe, anchor, direction: 'earlier', limit: SCAN_WINDOW, refresh: anchor === undefined })
    completed = candles.filter(c => c.timestamp + timeframeMs(timeframe) <= anchor)   // drop forming bar by time
    return probeStructure(completed, defaultStructureParams())
  })
  for coin in top:
    structures = scanTimeframes.map(tf => result ?? neutral { structure: null, position:0, score:0, touchCount:0, qualified:false })
    converged = scanTimeframes.filter(tf => structures[tf].qualified && structures[tf].score >= minScore)
    if converged.length == 0: continue        // 宁少勿滥
    rows.push({ ..., structures, convergedTimeframes, qualifiedCount, bestScore: max(converged.score) })
  rows.sort(qualifiedCount desc, bestScore desc)   // score larger = stronger
  return { scanned: rows, qualifiedCount: rows.length, params: { ...params, anchor }, scannedAt }
```

- **Uniform candle window**: `SCAN_WINDOW = 100` bars for EVERY timeframe (8/13, user decision: the lookback must not vary with the period). The detector needs a band + a same-length preceding stretch, so the window holds both.
- **Session gating** (09/06): instruments whose underlying **Market Session** is closed at `anchor` are dropped AFTER the 24h-volume gate and BEFORE the `topN` slice, so a closed TradFi contract never consumes a topN slot nor fires klines requests. Class comes from the ticker's optional `marketClass` (Binance `exchangeInfo` metadata, TTL-cached; absent = ungated). Metadata outage degrades to no gating (scan runs unfiltered). Skipped symbols are echoed as `skippedInstruments` (present only when non-empty) and shown in the UI as 「已跳过 N 个休市标的」. Pure session math lives in `src/domain/market-session.ts` (only `EQUITY`/`HK_EQUITY`/`KR_EQUITY`/`CN_EQUITY` are gated; crypto/commodity/pre-IPO never close).
- The forming bar is dropped **by time** (`timestamp + timeframeMs(timeframe) <= anchor`). Do not `slice(0, -1)` unconditionally — the candle cache may contain no forming bar.
- **Concurrency**: 5 in-flight candle fetches (mapLimit-style). A module-scope **pacer** (`createRequestPacer`, `SCAN_MIN_INTERVAL_MS=50`) spaces request *starts* ≥50ms apart across all workers and concurrent scans — one click = 300 forced-fresh klines requests (topN 60 × 5 timeframes), and without pacing that burst trips Binance's IP auto-ban (HTTP 418). `SCAN_CONCURRENCY=5`, min-interval 50ms (~20 req/s, well under the 2400 weight/min budget), jitter 15ms.
- **Sorting** is done by the service: `qualifiedCount` descending (cross-timeframe consistency is a stronger signal), then `bestScore` descending.

### Candle cache freshness

`BinanceCandleSource` (and the OKX `CandlestickService`) keep a shared SQLite candle cache. A full cache is reused only when it covers the moment being read:

- A **"current" scan** (anchor near `Date.now()`) whose newest cached bar lags the anchor by more than two steps is STALE — a previous scan populated the store, and repeat scans would otherwise return old bars forever. Such a cache is refreshed from the exchange before use.
- A **historical anchor** (a fixed point in the past) is always fresh: that data never changes, and the cache is reused.

## 4. Validation & Error Matrix

| Condition | Error |
| --- | --- |
| non-GET method | 405 |
| `method` != `shrink` | 400 `Unsupported scan method` |
| `topN < 1` / `minQuoteVolume24h < 0` | 400 `Invalid scan parameters` |
| `anchor` present and `<= 0` | 400 `Invalid scan parameters` |
| `minScore` present and `< 0` | 400 `Invalid scan parameters` |
| Binance/OKX tickers or candlestick fetch fails | 502 with readable message |

## 5. Good/Base/Bad Cases

- **Good**: a coin whose recent band is meaningfully quieter than the same-length stretch before it (e.g. 16 volatile bars then 16 flat calm bars → band/preceding ≈ 0.15, score ≈ 0.9). Strong contractions (AKE 1D-style, score ≈ 0.79) appear at the default minScore 0.7.
- **Base**: a uniformly calm coin (band vol ≈ preceding vol → ratio ≈ 1) has no "越来越小" tension and is rejected. A band with no preceding stretch (too few bars) returns null. A price that has broken out of the band is rejected by containment.
- **Bad**: a rising/falling trend (whose relative amplitude shrinks as price climbs) is rejected by the band's flatness gate. A crash-then-pause band is detected as a strong shrink by the pure band-vs-preceding rule; its wide post-dump edges usually fail the flatness gate, but if a narrow post-crash band shows up it will qualify — an open calibration decision flagged in the task notes.

## 6. Tests Required

- `tests/coin-scan.test.ts` — pure algorithm:
  - `detectConvergence`: band quieter than preceding → convergence ≥0.7; uniformly calm → null; short mild band → <0.7; breakout rejected (containment); too few bars → null; non-positive price → null; crash-then-pause detected (known consequence); mild shrink (band ≈ 60% of preceding) → <0.7; stricter `convergenceRatio` filters more.
  - `probeStructure`: forwards to the convergence detector; trending channel → null.
  - defaults: constants + `defaultStructureParams` fills all thresholds.
- `tests/coin-scan-service.test.ts` — aggregation: Top-N + all 5 timeframes, **uniform window (limit 100 for every timeframe)**, forming bar dropped by time, `change24h` carried, non-converged coins hidden, sort `qualifiedCount desc → bestScore desc`, `minScore` gate (0.5 admits weak, 0.7 filters it), neutral zeros, past anchor echoed, one coin converging on multiple timeframes as a single row, insufficient history → empty.
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

### Flatness gate doubles as the crash-pause rejection

The band must be a quiet horizontal band (edge drift ≤ 2× its own noise). Beyond rejecting trends, this also rejects the wide post-dump bands (CBRS 大跌后喘息) whose edges drift too much — so the pure band-vs-preceding rule does not flood the scan with crash-aftermaths.

### Session gating: skip closed traditional-market contracts (09/06)

Binance USDT-M lists 191 TradFi perpetuals (US/HK/KR/CN equities + commodities + pre-IPO). They print 24/7 candlesticks that simply go quiet when the underlying exchange is closed, so a volatility-shrink scan would otherwise flag a closed market as "extremely converged" — the result list filling with dormant NVDA/TSLA-style contracts. Gate order is 成交额门槛 → 休市剔除 → topN (a closed contract must not steal a slot or burn klines budget). The domain is pure (`market-session.ts`): IANA-timezone windows + built-in NYSE holiday/early-close tables (maintained yearly, coverage asserted in tests), no calendar npm dependency. Commodities/pre-IPO are intentionally ungated (XAU trades 24/7 with real volume). Alert monitor is NOT gated — a price alert during a closed session is still meaningful.
