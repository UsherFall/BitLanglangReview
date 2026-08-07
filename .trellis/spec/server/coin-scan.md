# Coin Scan (选币)

## 1. Scope / Trigger

The 选币 (Coin Scan) module finds instruments by pluggable scan methods. V1 ships only the **shrink** (收敛结构) method. It scans a parameterized universe of **Binance USDT-M perpetuals** by default (switchable to OKX SWAP via `MARKET_DATA_SOURCE=okx`) and detects **convergence structures** — 收敛三角 (converging triangles, direction not locked) and 低波动箱体 (low-volatility horizontal boxes) — via swing-point structure analysis. **Volume plays no role** — the user's stance is "看裸 K". The pool is derived from the ticker source (all USDT-M perpetuals above the `minQuoteVolume24h` floor, taking the top `topN`), so the precious-metal perpetual **XAUUSDT** (gold) is in the pool by default.

**One click scans all 5 timeframes** (5m/15m/1H/4H/1D). The result is **one row per coin** with a 收敛结构 column; a coin appears when it converges on at least one timeframe. A coin can carry different structures on different timeframes (e.g. 5m triangle + 1H box), which covers a consolidation growing from a small scale to a large scale.

**This replaces the old "compression + plateau" shrink mechanism** (compression/latestTrend/plateau windows). The old mechanism only measured *relative volatility contraction* with no structural verification — it misclassified 降/弹/平带 (dip-rebound-flat) patterns as triangles and saturated scores near 1.0. The new mechanism validates actual swing geometry.

This contract covers `src/server/coin-scan-service.ts`, the `/api/scan` route in `src/server/app-plugin.ts`, the pure algorithm in `src/domain/coin-scan.ts`, and the UI in `src/ui/CoinScanPanel.tsx`.

## 2. Signatures

- Route: `GET /api/scan` (no `timeframe` param — the scan always covers `scanTimeframes`)
- Service: `CoinScanService.scanShrink(params: ShrinkScanParams): Promise<ScanResponse>`
- Pure swing detection: `detectSwings(candles, n): SwingPoint[]` (single fractal width `n`)
- Pure structure classifier: `classifyStructure(swings, params): StructureResult | null`
- Probing entry point: `probeStructure(candles, params): StructureResult | null` (tries every candidate N, returns the most regular structure)
- Defaults: `defaultStructureParams(overrides?): StructureParams`

## 3. Contracts

### Request (query params)

| Field | Type | Default | Constraint |
| --- | --- | --- | --- |
| `method` | string | — | must be `shrink`; anything else → 400 |
| `topN` | number | 50 | `>= 1` |
| `minQuoteVolume24h` | number | 10_000_000 | `>= 0`; instruments below this 24h quote volume are filtered before Top-N selection |
| `anchor` | number (optional) | now | epoch ms; bars whose close time (`timestamp + timeframe`) is `<= anchor` are treated as completed. Absent / empty / NaN → `Date.now()`. Present and `<= 0` → 400 |
| `minScore` | number (optional) | 0 | `>= 0`; a timeframe counts as converged only when its structure is qualified AND `score >= minScore`. The 宁少勿滥 strength knob — raise it to keep only the strongest structures. Absent → 0 (gate reduces to the qualified maturity gate). Present and `< 0` → 400 |

Removed in this rewrite: `maxCompression`, `maxLatestTrend`, `trendWindow`, `plateauMin`, and the old v5/v6 volume params. Non-numeric params fall back to the default (see `parseScanParam`). Invalid final values → 400.

### Response (`ScanResponse`)

```ts
type ConvergenceStructure = 'triangle' | 'box';
type StructureResult = {
  structure: ConvergenceStructure | null; // null = this timeframe has no convergence structure
  position: number;                       // 0..1: box = (lastPrice - boxLow)/(boxHigh - boxLow); triangle = price between the two trend lines at the CURRENT bar
  score: number;                          // convergence strength, larger = stronger, normalized to [0,1]
  touchCount: number;                     // sum of swing points on both edges
  qualified: boolean;                     // passed the maturity gate (touchMin per edge) + structure gates
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
};
```

### Algorithm: swing detection (`detectSwings`)

Fractal swing points over completed candles, sorted ascending by timestamp:

```
swing high at bar i ⟺ high[i] strictly greater than the n highs on each side
swing low  at bar i ⟺ low[i]  strictly less   than the n lows  on each side
```

- Pure and deterministic: the input is never mutated (a copy is sorted ascending).
- Consecutive same-direction swings are collapsed to the extreme (a wide bar can be both a swing high and a swing low).
- Returns `[]` when fewer than `2n+1` bars (not enough fractal context) or any price is non-positive.

### Algorithm: structure classifier (`classifyStructure`)

Windows to the most recent `DEFAULT_MAX_STRUCTURE_SWINGS` (8) swings (older regime swings would tilt the edge regressions). Classifies:

- **Box**: both edge regressions flat (`edge total drift across swing span / meanPrice <= slopeTolerance`), each edge's `(max-min)/mean` spread `<= boxRangeTolerance` (0.05), box height narrow relative to the coin's own past amplitude (`boxRelativeHeight / priorAmplitude < maxBoxRelativeHeight`, the 天生安静 rejection), each edge touched `>= touchMin`.
- **Triangle**: highs falling + lows rising (symmetric), or one side flat (rising: flat highs + rising lows; falling: falling highs + flat lows). The flat side must stay in a narrow band (`(max-min)/mean <= boxRangeTolerance`). The trending edges must be point-by-point monotonic (`isDirectionalMonotonic` within `monotonicTolerance` 0.02) — an outlier swing can pull the OLS slope into the right sign while the edge is not actually monotonic. Channel width must be positive and narrowing at the current bar (`widthCurrent > 0 && widthCurrent < widthStart`) — a resolved/crossed triangle (已突破) is rejected.

**Everything is anchored to the CURRENT bar** (`params.currentIndex`, the last candle index), not the last swing: trend lines are extrapolated to where price is now. A structure whose apex is already behind the current bar (`widthCurrent <= 0`) is rejected as resolved. Position and convergence score use the width at the current bar, which also prevents score saturation.

**Gates** (any failure → null):
1. `highs.length >= touchMin && lows.length >= touchMin` (each edge needs enough touches to feed a regression)
2. Recency: `currentIndex - lastSwing.index <= maxRecentBars` (12) — a structure whose most recent touch is far in the past has already resolved
3. Price-in-structure: `lastPrice` within ±10% of the structure width/height at the current bar — a price that punched through one side has broken out, no longer 蓄力待突破
4. Triangle: monotonicity + flat-side range + positive narrowing width
5. Box: flat regressions + range gate + low-volatility gate + price-in-structure

### Algorithm: probing (`probeStructure`)

Every coin/timeframe discovers its own structure scale — no fixed window:

```
candidate N = STRUCTURE_SWING_N = [2, 3, 4, 5, 6, 8, 10, 12]
for n in candidates:
  swings = detectSwings(candles, n)
  result = classifyStructure(swings, params)
pick the most regular: 有结构 > touchCount 多 > swing 对数多 > score 强 > N 小
```

`priorAmplitude`, `lastPrice`, `currentIndex` are measured from the candles and injected into `classifyStructure` (which stays a pure function of swings + params).

### Calibration constants (`src/domain/coin-scan.ts`, all exported)

| Constant | Value | Meaning |
| --- | --- | --- |
| `STRUCTURE_SWING_N` | `[2,3,4,5,6,8,10,12]` | candidate fractal widths |
| `DEFAULT_SLOPE_TOLERANCE` | 0.02 | box edge total-drift / meanPrice flatness bound |
| `DEFAULT_TOUCH_MIN` | 2 | min touch points per edge |
| `DEFAULT_MAX_BOX_RELATIVE_HEIGHT` | 0.8 | box height / priorAmplitude must be strictly less (天生安静 rejection) |
| `DEFAULT_MAX_STRUCTURE_SWINGS` | 8 | window to most recent swings |
| `DEFAULT_MAX_RECENT_BARS` | 12 | recency gate (last touch within this many bars) |
| `DEFAULT_MONOTONIC_TOLERANCE` | 0.02 | triangle trending-edge per-step monotonicity slack |
| `DEFAULT_BOX_RANGE_TOLERANCE` | 0.05 | box/triangle-flat-edge `(max-min)/mean` spread bound |

### Service aggregation

```
scanShrink(params):
  tickers = tickerSource.listTickers()
  top = filter(quoteVolume24h >= minQuoteVolume24h).slice(0, topN)
  anchor = params.anchor ?? Date.now()
  minScore = params.minScore ?? 0
  tasks = top × scanTimeframes
  results = mapLimit(tasks, concurrency 10, ({ticker, timeframe}) => {
    candles = candleSource.getCandlesticks({ instrument, timeframe, anchor, direction: 'earlier', limit: perTimeframeLimit(timeframe) })
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

- **Per-timeframe candle limit** (probe-type window, no fixed 13): `5m/15m/1H/4H` → 100 bars, `1D` → 40 bars. The window must hold a full consolidation plus fractal context at the largest candidate N.
- The forming bar is dropped **by time** (`timestamp + timeframeMs(timeframe) <= anchor`). Do not `slice(0, -1)` unconditionally — the candle cache may contain no forming bar.
- **Concurrency**: 10 in-flight candle fetches (mapLimit-style); repeat scans reuse the shared candle cache.
- **Sorting** is done by the service: `qualifiedCount` descending (cross-timeframe consistency is a stronger signal), then `bestScore` descending (strongest structure first — note this is *descending*, unlike the old ascending score). The UI renders rows as-is.

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

- **Good**: a coin whose swing structure forms a genuine converging triangle (rising lows + falling/flat highs, monotonic, positive narrowing width, current price inside) or a low-volatility box (both edges flat and in a narrow band, box compressed vs the coin's own past amplitude) → qualified on that timeframe, appears in the row with the structure type. A real MRVL 15m 上升三角 (lows 202→208→211→211 rising, highs ~215 flat) qualifies at score ≈ 0.93.
- **Base**: an always-quiet coin (box width ≈ its own amplitude → ratio ≈ 1) has no "从大波动收敛到小" tension and is rejected by the `maxBoxRelativeHeight` gate. A structure whose most recent touch is > 12 bars old is stale and rejected by the recency gate. A triangle whose trend lines have already crossed at the current bar (已突破) is rejected by `widthCurrent > 0`.
- **Bad**: a dip-rebound-flat pattern (HEI 5m lows `[0.1950, 0.1969, 0.1816, 0.1957]`, HFT 15m crash-then-narrow) must NOT qualify as a triangle. HEI regressed flat (drift 0.013 < 0.02) but spreads 8% — rejected by the flat-edge range gate. A "降/弹/平带" whose rebound low line extrapolates across the flat high line at the current bar is rejected by `widthCurrent <= 0`.

## 6. Tests Required

- `tests/coin-scan.test.ts` — pure algorithm:
  - `detectSwings`: known fractal layout at N=2, `< 2n+1` bars → `[]`, input not mutated, adjacent same-direction dedup, non-positive price → `[]`.
  - `classifyStructure`: box (both flat edges + narrow range + low-volatility pass), box rejected by quiet gate (priorAmplitude ≈ box height), symmetric/rising/falling triangles, monotonicity gate (HEI 0.1969→0.1816 −7.8% rejected), flat-edge range gate (spread > 5% rejected), resolved/crossed triangle (`widthCurrent <= 0`) rejected, stale structure (> 12 bars) rejected, `< touchMin` touches → null, `< 4` swings → null.
  - `probeStructure`: synthetic box → box, synthetic triangle → triangle, trending channel / random walk → null, small consolidation resolves at small N, `< 4` candles / non-positive price → null.
- `tests/coin-scan-service.test.ts` — aggregation: Top-N + all 5 timeframes, `perTimeframeLimit` (100 for 5m/15m/1H/4H, 40 for 1D), forming bar dropped by time, `change24h` carried, non-converged coins hidden, sort `qualifiedCount desc → bestScore desc`, `minScore` gate (0.8 admits score 0.812, 0.9 rejects), neutral zeros for null structures, past anchor echoed, one coin with different structures on different timeframes.

## 7. Wrong vs Correct

#### Wrong

```ts
// Old plateau gate: only relative amplitude contraction, no structural verification.
const plateau = computePlateau(completed, { maxCompression: 0.8, maxLatestTrend: 0.9 });
// → 降/弹/平带 misclassified as convergence; score saturates near 1.0.
```

#### Correct

```ts
// Probe every fractal N, classify the swing geometry, reject non-monotonic / non-narrow /
// resolved / stale / broken-out structures.
const structure = probeStructure(completed, defaultStructureParams());
// → genuine triangles and boxes qualify; dip-rebound-flat and crash-narrow patterns are rejected.
```

## Design Decisions

### Swing-based structure detection replaces relative-amplitude gates

The old shrink mechanism measured `compression` (recent/prior amplitude ratio) + `latestTrend` (still narrowing) with no structural verification. Real-data review showed it (a) saturated scores near 1.0 for any mature structure, (b) misclassified 降/弹/平带 dip-rebound patterns as triangles, (c) reported stale structures whose apex was behind the current bar. The rewrite detects actual swing points (fractal, probing N) and verifies triangle/box geometry with per-swing monotonicity, flat-edge range, recency, price-in-structure, and positive-narrowing-width gates. Real-data verified: MRVL/SNDK/SOXX genuine triangles qualify, HEI/HFT dip-rebound patterns are rejected, box detection confirmed on synthetic data.

### Probing N instead of a fixed window

The old `PLATEAU_BOX_WINDOWS = [3,4,5,6]` scanned fixed window lengths. The new `probeStructure` tries every candidate N in `STRUCTURE_SWING_N = [2,3,4,5,6,8,10,12]` and picks the most regular structure (有结构 > touchCount > pairs > score > smaller N). Each coin/timeframe discovers its own structure scale — a small consolidation resolves at a small N, a large one at a large N. This is the "探测型窗口" the user chose: the window is measured from the structure, not guessed.

### Absolute amplitude is not a gate

Different instruments have intrinsically different amplitudes (a $1000 coin vs a $0.1 coin). The box low-volatility gate is **relative to the coin's own past**: `boxHeight / priorAmplitude < maxBoxRelativeHeight`. A naturally quiet coin (amplitude ≈ box width) has no "从大波动收敛到小" tension and is rejected — the 蓄力 signal requires a contraction from larger volatility.

### Anchoring to the current bar

`classifyStructure` anchors trend lines, position, and convergence width to `params.currentIndex` (the last candle), not the last swing. A triangle whose apex is behind the current bar (`widthCurrent <= 0`) is already resolved and rejected. This also de-saturates the score: convergence = `(widthStart - widthCurrent)/widthStart` at the current bar, so a still-converging triangle scores below 1.0 instead of saturating at the narrowest swing point.

### Monotonicity + flat-edge range: guarding against regression outliers

An outlier swing (HEI's 0.1969 → 0.1816 deep-low dip) can pull an OLS slope into the right sign while the edge is not actually monotonic. The triangle's trending edges must be point-by-point monotonic within `monotonicTolerance` (0.02), and a triangle's flat side must stay in a narrow band (`(max-min)/mean <= boxRangeTolerance`, 0.05) — mirroring the box's range gate. A "flat" edge that merely regresses to ~0 slope but visibly spreads (8%) is not a flat edge.

### 宁少勿滥 + `minScore` strength knob

Only coins with ≥ 1 qualified timeframe appear (宁少勿滥). The `minScore` param is the UI's main strength knob: a qualified structure only counts toward `convergedTimeframes` when `score >= minScore` (default 0 = maturity gate only). Raise it to keep only the strongest structures. This is deliberately a second, output-strength filter on top of the structural maturity gates.

### Multi-timeframe, one row per coin

One click scans 5m/15m/1H/4H/1D and returns one row per coin (each timeframe independently probed). A coin can carry different structures on different timeframes (e.g. 5m triangle + 1H box), which covers a consolidation growing from a small scale to a large scale — the "小盘整成长为大级别" the user wanted to catch.

### UI: minimal params

Only 扫描数量 (topN), 最低成交额 (minQuoteVolume24h), 扫描时间点 (anchor), and 结构强度阈值 (minScore) are exposed. The structure thresholds (slope tolerance, touch minimum, box range, monotonic tolerance, recency) stay internal calibration constants — they are not UI knobs.
