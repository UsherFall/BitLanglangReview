# Coin Scan (选币)

## 1. Scope / Trigger

The 选币 (Coin Scan) module finds instruments by pluggable scan methods. V1 ships only the **shrink** (收敛) method. It scans a parameterized universe of **Binance USDT-M perpetuals** by default (switchable to OKX SWAP via `MARKET_DATA_SOURCE=okx`) and ranks them by pure-price convergence: how much their volatility has compressed against their own recent past and is still narrowing toward the present. **Volume plays no role** — the user's stance is "看裸 K". The pool is derived from the ticker source (all USDT-M perpetuals above the `minQuoteVolume24h` floor, taking the top `topN`), so the precious-metal perpetual **XAUUSDT** (gold) is in the pool by default.

**One click scans all 5 timeframes** (5m/15m/1H/4H/1D). The result is **one row per coin** with a 收敛周期 (convergence timeframe) column; a coin appears when it converges on at least one timeframe. This replaces the single-timeframe scan entirely (user decision 2026-08-06): case-library C5 showed that a box which looks "flattened" (latestTrend ≈ 1) on 15m is a clear 收窄 on 1H — each coin shows up on its natural timeframe, no `latestTrend` default change needed.

This contract covers `src/server/coin-scan-service.ts`, the `/api/scan` route in `src/server/app-plugin.ts`, the pure algorithm in `src/domain/coin-scan.ts`, and the UI in `src/ui/CoinScanPanel.tsx`.

## 2. Signatures

- Route: `GET /api/scan` (no `timeframe` param — the scan always covers `scanTimeframes`)
- Service: `CoinScanService.scanShrink(params: ShrinkScanParams): Promise<ScanResponse>`
- Pure per-window gate: `computeQuietMetrics(candles, { boxWindow, maxCompression, maxLatestTrend, trendWindow }): QuietMetrics | null`
- Pure plateau gate: `computePlateau(candles, { maxCompression, maxLatestTrend, trendWindow, plateauMin }): PlateauResult | null`

## 3. Contracts

### Request (query params)

| Field | Type | Default | Constraint |
| --- | --- | --- | --- |
| `method` | string | — | must be `shrink`; anything else → 400 |
| `topN` | number | 50 | `>= 1` |
| `minQuoteVolume24h` | number | 10_000_000 | `>= 0`; instruments below this 24h quote volume are filtered before Top-N selection |
| `anchor` | number (optional) | now | epoch ms; bars whose close time (`timestamp + timeframe`) is `<= anchor` are treated as completed, so a past anchor scans "as of" that instant (e.g. `2026-08-04T00:00:00Z` → newest completed 1D bar is 08-03). Applied to **every** timeframe. Absent / empty / NaN → `Date.now()`. Present and `<= 0` → 400 |
| `maxCompression` | number (optional) | `DEFAULT_MAX_COMPRESSION` = 0.8 | `> 0`; volatility-compression threshold: recent mean amplitude must be `<= maxCompression ×` prior mean amplitude. Absent / empty / NaN → `DEFAULT_MAX_COMPRESSION`; present and `<= 0` → 400 |
| `maxLatestTrend` | number (optional) | `DEFAULT_MAX_LATEST_TREND` = 0.9 | `> 0`; latest-trend threshold: latest `trendWindow` mean amplitude must be `<= maxLatestTrend ×` the `trendWindow` mean amplitude before it (波动仍在收窄). Absent / empty / NaN → `DEFAULT_MAX_LATEST_TREND`; present and `<= 0` → 400 |
| `trendWindow` | number (optional) | `DEFAULT_TREND_WINDOW` = 3 | `>= 1`; number of trailing completed bars for the latest-trend windows. Per box window the effective trend window is `tr(bw) = min(trendWindow, boxWindow)`; at `bw=3` with the default tr the latest-trend windows coincide with the box windows (`latestTrend == compression`, compression gate carries it). Absent / empty / NaN → `DEFAULT_TREND_WINDOW`; present and `< 1` → 400 |
| `plateauMin` | number (optional) | `DEFAULT_PLATEAU_MIN` = 2 | `>= 1`; minimum consecutive qualified box windows (of `PLATEAU_BOX_WINDOWS` = `[3, 4, 5, 6]`) required to qualify. Absent / empty / NaN → `DEFAULT_PLATEAU_MIN`; present and `< 1` → 400 |

Removed in v6: `timeframe` (the scan always covers all 5 timeframes) and `boxWindow` (the plateau scans a fixed window set internally). Removed in v5: the volume params (`ratioThreshold`, `consecutive`, `window`). Non-numeric params fall back to the default (see `parseScanParam`). Invalid final values → 400.

> **Warning (known defect, pre-existing)**: `parseScanParam` treats an omitted param as `Number(null) === 0`, which is finite, so a missing `topN` yields `0` instead of the spec default and then trips the `400 Invalid scan parameters` guard. The UI always sends every param, so this is latent. If default-fallback for absent params matters, fix `parseScanParam` to distinguish `null` from a parsed value.
>
> `maxCompression`/`maxLatestTrend`/`trendWindow`/`plateauMin`/`anchor` deliberately do **not** use `parseScanParam`; they are parsed with `parseOptionalNumber`, which maps `null`/empty/NaN → `undefined`, so an absent optional param falls back to its default instead of tripping the guard.

### Response (`ScanResponse`)

```ts
type ScanTimeframeResult = {
  timeframe: ReviewTimeframe;    // one of scanTimeframes = ['5m','15m','1H','4H','1D']
  compression: number;           // compression of the best plateau window (bestBoxWindow)
  latestTrend: number;           // latestTrend of the best plateau window
  score: number;                 // compression + latestTrend of the best window
  plateauWidth: number;          // longest consecutive qualified window run on this timeframe
  bestBoxWindow: number;         // box window of the best window
  qualified: boolean;            // plateauWidth >= plateauMin
};
type ScanRow = {
  instrument: string;            // XAUUSDT / BTCUSDT (Binance), BTC-USDT-SWAP (OKX)
  lastPrice: number;             // from ticker `last`
  change24h: number;             // percent, (last - open24h) / open24h * 100
  quoteVolume24h: number;        // 24h quote volume in USDT (from ticker, not K-line volume; kept for the minQuoteVolume24h liquidity filter)
  timeframes: ScanTimeframeResult[];      // all 5 timeframes, scanTimeframes order
  convergenceTimeframes: ReviewTimeframe[]; // qualified subset (收敛周期 column data)
  qualifiedCount: number;        // = convergenceTimeframes.length
  bestScore: number;             // min score across qualified timeframes; a row always has >= 1
  qualified: boolean;            // always true (only converged coins appear); kept for compatibility
};
type ScanResponse = {
  scanned: ScanRow[];            // only coins with >= 1 qualified timeframe; sorted by qualifiedCount desc, then bestScore asc
  qualifiedCount: number;        // = scanned.length
  params: ShrinkScanParams;      // echoes the effective params, including the resolved anchor/maxCompression/maxLatestTrend/trendWindow/plateauMin
  scannedAt: string;             // ISO
};
```

### Per-window gate: `compression` and `latestTrend` (unchanged from v5)

`compression` is computed over two adjacent, equal-length windows of completed bars — the trailing `boxWindow` bars (`recent`) and the `boxWindow` bars immediately before them (`prior`):

```
N = boxWindow
meanAmp(w) = mean( per-bar (high - low) / low over the window w )
compression = meanAmp(prior) > 0
            ? meanAmp(recent) / meanAmp(prior)
            : meanAmp(recent) > 0 ? LARGE_RATIO : 0
```

Intuition: a coin that is converging has recently shrunk its own volatility (`meanAmp(recent) << meanAmp(prior)` → `compression < 1`). A coin that has always been quiet has `compression ≈ 1` — no "tension" — and is rejected. Because both windows use the instrument's own amplitudes, `compression` is scale-free: a 0.5%/bar coin and a 2%/bar coin compress with the same ratio. Boundary: a flat prior window with an active recent window ("woke up from flat") is not convergence and reports `LARGE_RATIO` (1e9 sentinel so JSON never serializes `Infinity` → `null`); two flat windows report `compression = 0` and the latestTrend gate carries the verdict.

`latestTrend` is the "is it still narrowing" (收窄趋势) gate over two adjacent, equal-length windows of completed bars — the trailing `trendWindow` bars (`latest`) and the `trendWindow` bars immediately before them (`middle`):

```
T = trendWindow
meanAmp(w) = mean( per-bar (high - low) / low over the window w )
latestTrend = meanAmp(middle) > 0
            ? meanAmp(latest) / meanAmp(middle)
            : meanAmp(latest) > 0 ? LARGE_RATIO : 0
```

Intuition: `compression` only asks "quieter than before", so a coin that flattened out or has been uniformly quiet passes it. `latestTrend` asks "still getting quieter toward the present": a still-converging coin scores `< 1`; a coin whose latest window is about the same as its middle window (`latestTrend ≈ 1`, flattened out) or is widening (`latestTrend > 1`) has no 收窄 feel and is rejected. Both windows use the instrument's own amplitudes, so `latestTrend` is scale-free and one `maxLatestTrend` works for any timeframe and volatility level. Boundary: a flat middle window with an active latest window reports `LARGE_RATIO` ("woke up from flat"); two flat windows report `latestTrend = 0` and the compression gate carries the verdict.

### Plateau gate: `computePlateau`

`computeQuietMetrics` stays a single-box-window gate. `computePlateau` runs it over **every box window in `PLATEAU_BOX_WINDOWS` = `[3, 4, 5, 6]`** on the same set of completed candles and requires `plateauMin` (default 2) **consecutive qualified windows**:

```
for bw in PLATEAU_BOX_WINDOWS:
  tr(bw) = min(trendWindow, boxWindow)           // bw=3 → tr=3 with default tr (latest == box, degenerate)
  metrics = computeQuietMetrics(candles, { boxWindow: bw, maxCompression, maxLatestTrend, trendWindow: tr(bw) })
  window.qualified = metrics?.qualified ?? false // null (insufficient history / non-positive price) never contributes
plateauWidth = longest consecutive run of qualified windows
qualified = plateauWidth >= plateauMin
best = qualified window with min score, else computed window with min score
```

- **`tr(bw) = min(trendWindow, boxWindow)`**: at `bw=3` with the default `trendWindow` 3 the latest-trend windows coincide with the box windows (`latestTrend == compression`) and the compression gate carries `bw=3`. This is deliberate — a 2-bar latest window at `bw=3` is too twitchy (HYPE 1H `latestTrend` 0.905 > 0.9 with tr=2, vs 0.669 == compression with tr=3) and broke the case-library plateau `{3,4}`. `tr` never exceeds the box window (no separate `<= boxWindow` check).
- **Insufficient history per window**: a window whose box needs more bars than are present (`bw=6` needs `2 × 6 = 12`) reports `qualified = false` and never breaks a consecutive run — a freshly listed coin still qualifies through its small windows.
- **`plateauWidth`** counts the longest run of **consecutive** qualified windows; a gap (e.g. `[T, T, F, T]`) is not merged, so an isolated mis-fit (case-library C4: only a single `bw=4` window qualifies) does not qualify.
- **Best window**: the qualified window with the smallest `score` (its `compression`/`latestTrend`/`score`/`boxWindow` fill `ScanTimeframeResult`); when nothing qualifies, the computed window with the smallest score is reported so the user can still calibrate thresholds.
- Returns `null` when no box window can be computed at all (fewer than `2 × 3` completed bars or a non-positive price) — the service maps that timeframe to `qualified = false`.

There is **no volume gate and no box-shape gate**: a slow-slope compression (price drifting while per-bar amplitude narrows) is a legitimate 收敛 and qualifies. That is exactly the gold 1D case — the user wants 08-03/08-04 (XAUUSDT 1D, a ~4040–4112 horizontal band with narrowing daily amplitude) to scan out, which the v4 volume gate (`consecutiveQuiet`) and the v2 `boxTightness` gate both mis-rejected.

### Service aggregation

```
scanShrink(params):
  tickers = tickerSource.listTickers()                        // once
  top = filter(quoteVolume24h >= minQuoteVolume24h).slice(0, topN)
  anchor = params.anchor ?? Date.now()
  tasks = top × scanTimeframes                                // topN × 5 fetch tasks
  results = mapLimit(tasks, concurrency 10, ({ticker, timeframe}) => {
    candles = candleSource.getCandlesticks({ instrument, timeframe, anchor, direction: 'earlier', limit: 13 })
    completed = candles.filter(c => c.timestamp + timeframeMs(timeframe) <= anchor)   // drop forming bar by time
    return computePlateau(completed, plateauParams)
  })
  for coin in top:
    timeframes = scanTimeframes.map(toScanTimeframeResult)    // plateau null → qualified false
    converged = timeframes.filter(qualified)
    if converged.length == 0: continue                        // 宁少勿滥 — non-converged coins are not shown
    rows.push({ ...coin fields, timeframes, convergenceTimeframes, qualifiedCount, bestScore: min(converged.score) })
  rows.sort(qualifiedCount desc, bestScore asc)
  return { scanned: rows, qualifiedCount: rows.length, params, scannedAt }
```

- **`limit` is always 13** (`2 × max(PLATEAU_BOX_WINDOWS) + 1 = 2 × 6 + 1`): 12 completed bars feed the largest `bw=6` window plus one bar for the still-forming candle, which is dropped by time before `computePlateau`.
- The forming bar is dropped **by time** (`timestamp + timeframeMs(timeframe) <= anchor`), applied to every timeframe, so a historical anchor scans each timeframe "as of" that instant. Do not `slice(0, -1)` unconditionally: the candle cache may contain no forming bar, and slicing then wrongly drops the newest **completed** bar (the scan silently lags one bar).
- **Concurrency**: 10 in-flight candle fetches (mapLimit-style) cap Binance rate usage; `topN × 5` first-scan latency is ~4–5s (< the 15s budget) and repeat scans reuse the shared candle cache.
- **Sorting** is done by the service: `qualifiedCount` descending (cross-timeframe consistency is a stronger signal), then `bestScore` ascending (hardest convergence first). The UI renders rows as-is.

## 4. Validation & Error Matrix

| Condition | Error |
| --- | --- |
| non-GET method | 405 |
| `method` != `shrink` | 400 `Unsupported scan method` |
| `topN < 1` / `minQuoteVolume24h < 0` | 400 `Invalid scan parameters` |
| `anchor` present and `<= 0` | 400 `Invalid scan parameters` |
| `maxCompression` present and `<= 0` | 400 `Invalid scan parameters` |
| `maxLatestTrend` present and `<= 0` | 400 `Invalid scan parameters` |
| `trendWindow` present and `< 1` | 400 `Invalid scan parameters` |
| `plateauMin` present and `< 1` | 400 `Invalid scan parameters` |
| Binance/OKX tickers or candlestick fetch fails | 502 with readable message |

## 5. Good/Base/Bad Cases

- **Good**: a coin whose recent bars compress to `≈ 0.3×` their prior mean amplitude (`compression <= 0.8`) and keep narrowing toward the present (`latestTrend <= 0.9`) across `>= plateauMin` consecutive box windows → the timeframe's `qualified` is true and the coin appears with that timeframe in `convergenceTimeframes`. Gold-style: a slow-slope compression (wide price band, amplitude still narrowing) qualifies the same way — no box-shape gate, no volume gate. Case C5: HYPE 15m looks flattened (`latestTrend ≈ 1.1`, rejected) but 1H aggregates away the intraday noise (`plateau {3,4}`, qualified) → the row shows 收敛周期 `1H`.
- **Base**: `compression ≈ 0.9` (recent ≈ prior, a coin that has always been quiet → no tension) or `latestTrend ≈ 0.93` (flattened out) / `> 1` (widening) fails the per-window gate; a large candle inside a small box window lifts its recent mean amplitude so `compression > 0.8`. If no window run reaches `plateauMin` (e.g. case C4 HYPE-now: a single isolated `bw=4` window), the timeframe does not qualify and a coin with no qualifying timeframe is **not shown at all** (宁少勿滥).
- **Bad**: fewer than `2 × 3 = 6` completed candles (or a non-positive price) → `computePlateau` returns `null` → every timeframe `qualified = false` → coin skipped.

## 6. Tests Required

- `tests/coin-scan.test.ts` — pure algorithm. `computeQuietMetrics` (v5 regression): input order independence, insufficient history → null (the `2 × boxWindow` and `2 × trendWindow` guards), non-positive price → null, scale-free (2%/bar vs 0.5%/bar same threshold); `compression`: recent clearly below prior → qualified, recent ≈ prior → rejected, prior flat + recent active → `LARGE_RATIO` rejected, both flat → `0` passes; `latestTrend`: latest clearly below middle → qualified, latest ≈ middle (0.93×) → rejected, latest > middle (1.4×) → rejected, middle flat + latest active → `LARGE_RATIO` rejected, both flat → `0` passes, scale-free, a single wider bar rejected at tr=2 but averaged out (qualified) at tr=3; `score = compression + latestTrend` and lower score = stronger convergence; defaults (`DEFAULT_MAX_COMPRESSION` = 0.8, `DEFAULT_MAX_LATEST_TREND` = 0.9, `DEFAULT_TREND_WINDOW` = 3, `DEFAULT_PLATEAU_MIN` = 2, `PLATEAU_BOX_WINDOWS` = `[3, 4, 5, 6]`) and omitted-params fallback; gold-style 1D convergence qualifies with `boxWindow` 3 and 4. `computePlateau`: consecutive-run counting (`[T,T,F,T]` → width 2, gaps not merged), all-windows-qualify → width 4, best window = qualified min-score (and bestBoxWindow), `tr(bw) = min(trendWindow, boxWindow)` (bw=3 collapses latest onto box), `plateauMin` thresholds (2 qualifies a width-2 run, 3 does not; plateauMin=1 degenerates to a single window), insufficient history (bw=6 needs 12 bars; short history still lets small windows qualify), returns null with `< 6` bars or a non-positive price.
- `tests/coin-scan-service.test.ts` — multi-timeframe aggregation: USDT-SWAP filter + Top-N order, all 5 timeframes fetched per coin with `limit` 13 and the forming bar dropped by time, `change24h` from last/open24h, insufficient candles skipped, rows sorted `qualifiedCount` desc then `bestScore` asc with non-converged coins hidden, per-timeframe `qualified`/`convergenceTimeframes`/`qualifiedCount`/`bestScore` carried, `params.maxCompression`/`params.maxLatestTrend`/`params.trendWindow`/`params.plateauMin` echoed, a past anchor applied to every timeframe, gold-style 1D convergence qualifies at the anchor.
- `tests/chart-time.test.ts` — `formatReviewInputTime` round-trips through `freeReplayProgressTimeForStart`.

## 7. Wrong vs Correct

#### Wrong

The scan keeps the still-forming bar; a partial candle with tiny amplitude qualifies the coin on noise. A single `boxWindow` scans only one box length, so a box whose length differs (or a coin with an isolated mis-fit window, e.g. HYPE-now) either misses or false-positives. The old v4 volume gate (`consecutiveQuiet >= consecutive`) mis-rejected gold 1D: 08-01/08-02 shrank volume (volR 0.09/0.29) but 08-03/08-04 volume rebounded (volR 0.86/1.25), so consecutive-quiet was 0 and the 08-04 convergence (the user's eye: "横盘该扫出") was rejected even though compression/latestTrend were green. The v2 `boxTightness` gate mis-rejects gold-style convergence too: a slow-slope compression (compression 0.18) fails the tight-box score (1.1–1.8) even though the user's eye says "波动明显比之前小".

#### Correct

`candleSource.getCandlesticks` is called with `limit = 2 × max(PLATEAU_BOX_WINDOWS) + 1 = 13`, then the still-forming bar is dropped **by time** (`candle.timestamp + timeframeMs(timeframe) > anchor`) before `computePlateau`, so every metric (including `compression` and `latestTrend`) is computed only over completed candles. Do not `slice(0, -1)` unconditionally: the candle cache may contain no forming bar, and slicing then wrongly drops the newest **completed** bar (the scan silently lags one bar). Qualification is pure price — per window `compression <= maxCompression && latestTrend <= maxLatestTrend`, and per timeframe `plateauWidth >= plateauMin`; volume plays no role. There is no box-shape gate — the objective is "现在在收敛且收敛到极致", which compression + latestTrend carry, and "每币在它的自然周期显形", which the all-timeframe scan carries. Rows sort by `qualifiedCount` descending then `score` ascending (most multi-timeframe-converged, hardest convergence first).

## Design Decisions

### Extensible method dispatch

The route reads `method` and the UI exposes a method selector. Adding a new find-coin method = new branch in `CoinScanService`, a new `ScanResponse` variant, and a new case in `CoinScanPanel`. V1 deliberately ships only `shrink` to keep the extensibility seam without speculative UI.

### Scale-free relative gates instead of absolute amplitude floors

Fixed absolute amplitude floors (e.g. `maxAbsAmplitude`) misclassify high-volatility altcoins (2% amplitude is convergence for them) and miss low-volatility majors/equities (0.5%). `compression` and `latestTrend` are scale-free: each is a ratio of the instrument's own mean amplitudes, so a 2%-per-bar coin and a 0.5%-per-bar coin compress with the same ratio and one threshold works for any timeframe and volatility level. Case F4: ONUSDT 4H's recent 4–7% amplitude (the user wants it) vs HYPE-now's 1.2–3.6% (the user does not) cannot be told apart by an absolute floor — structure (compression + plateau) decides.

### Multi-timeframe replaces single-timeframe (v6)

User decision 2026-08-06: one click scans 5m/15m/1H/4H/1D and returns one row per coin. The reason is case C5: HYPE 15m @08-03 19:00+08 is a box that has already compressed and holds uniformly tight (`latestTrend ≈ 1.1`), which the latest-trend gate rejects; the same box on 1H aggregates away the intraday noise against earlier wider 1H bars and shows `compression 0.61–0.67 / latestTrend 0.669` — a clean 收窄. Multi-timeframe makes "15m flattened = 1H narrowing" hold naturally without loosening `maxLatestTrend` (loosening it would let case CRCL-like "always quiet" coins back in, where latestTrend ≈ 1 on every timeframe and cannot be distinguished). Trade-off accepted: single-timeframe tuning is gone; per-timeframe values are still visible via the expandable row, so threshold calibration survives.

### Plateau: multi-window consecutive convergence

A single box window cannot know the box length of an arbitrary coin and can false-positive on isolated windows (case C4: HYPE-now qualifies only at `bw=4`, a breakthrough-then-flat box with no convergence). `computePlateau` scans the fixed window set `[3, 4, 5, 6]` and requires `>= plateauMin` (default 2) **consecutive** qualified windows. The case library validated the choice: good cases run width 2–3 (C1/C2 gold 1D `{3,4}` width 2, C3 ONUSDT 4H `{3,4,5}` width 3) while the bad case C4 is an isolated `bw=4` (width 1). The window set is fixed (no `bwRange` param — avoids over-tuning); `plateauMin` is exposed (`>= 1` degenerates back to a single window). Large windows with insufficient history are null and never break a run, so young instruments still qualify through their small windows.

### Per-window `tr(bw) = min(trendWindow, boxWindow)`

Each box window clamps the trend window to the box window, so at `bw=3` with the default `trendWindow` 3 the latest-trend windows coincide with the box windows and `latestTrend == compression` — the compression gate carries `bw=3`. Clamping to `bw - 1` instead (bw=3 → tr=2) was tried and rejected on real data: a 2-bar latest window is twitchy, and HYPE 1H `latestTrend` came out 0.905 (> 0.9, rejected) when it should be 0.669 == compression, breaking the case-library plateau `{3,4}`. The plateau consecutive-run requirement still cancels isolated twitch at larger boxes.

### Box-shape gate removed

v2's `boxTightness = R / (m × √N)` measured "oscillate in place vs drift" — a proxy for 收敛. It mis-fired on gold-style convergence: a slow-slope compression (per-bar amplitude narrowing while the price drifts) scores `boxTightness` 1.1–1.8 and was rejected even though `compression` was 0.18 (the user's eye: "波动明显比之前小"). v3.5 removes the box gate entirely; the objective is "现在在收敛且收敛到极致", carried by `compression` (quieter than before) + `latestTrend` (still narrowing). `maxBoxRatio` is gone from the contract.

### Fresh-flag exclusion now lives in compression

A large candle inside the recent `boxWindow` lifts the recent mean amplitude, so `compression` climbs above `maxCompression` and the coin is rejected — the "no recent big candle" duty that `boxTightness` once served is folded into the compression gate.

### Volume dimension removed entirely (v5)

The v4 volume gate (`volumeRatio < ratioThreshold` gating calm, `consecutiveQuiet >= consecutive`) was the hard blocker for gold 1D: the 08-03/08-04 convergence failed on consecutive-quiet even though pure price was converging (compression 0.47–0.92, latestTrend 0.25–0.89). The user decided to drop volume: "我觉得不需要交易量这个东西,我们看裸k就可以". v5 removes `volumeRatio`/`calm`/`consecutiveQuiet`/`intensity`/`amplitudeRatio` and all their params and columns. `quoteVolume24h` survives as a liquidity floor only (`minQuoteVolume24h`), sourced from the ticker, not from K-line volume. Trade-off accepted: losing the 蓄力 signal (volume shrink often precedes a breakout) means a "long-term low-volatility, no-direction" coin can qualify, but the user explicitly prefers pure price.

### Default trendWindow 3 stays

`trendWindow` is 3, not 2, because a 2-bar latest window is twitchy: one wider bar in the trailing pair flips the verdict even when the convergence is obvious (ONUSDT 4H @08-05 16:00 → latestTrend 1.16 with tr=2, 0.52 with tr=3). 3 bars average out the single-bar blip while still rejecting a genuinely flattened/widening coin (≈ 1.0+).

### `compression` and `latestTrend` are hard gates + display columns

Qualification requires `compression <= maxCompression` AND `latestTrend <= maxLatestTrend` per window. The expandable row shows the raw 压缩比/收窄趋势 for every timeframe (even rejected ones) so the user can calibrate the thresholds by eye after each scan. This is a strictness knob — more gates mean fewer results, which matches the user's "宁少勿滥" stance.

### Latest-trend: the "still narrowing" gate

`compression` alone asks "quieter than before", which lets a coin that flattened out (latest ≈ middle) or has always been quiet slip through with `compression < 1`. `latestTrend = meanAmp(latest trendWindow) / meanAmp(middle trendWindow)` adds the "现在的波动是不是还在变小" criterion: the trailing `trendWindow` bars must be meaningfully narrower than the `trendWindow` bars right before them. The ratio is scale-free (instrument's own amplitude in both windows), one `maxLatestTrend` threshold works for any timeframe/volatility level, and the middle window is adjacent to latest so older noise does not dilute the comparison. The tradeoff is accepted: a uniformly quiet small box has `latestTrend ≈ 1` and is rejected by the default 0.9 — the user explicitly wants "越来越小" tension, and the threshold is adjustable.

### Optional params are echoed

The route resolves an absent/empty/NaN `maxCompression`/`maxLatestTrend`/`trendWindow`/`plateauMin` to its default via `parseOptionalNumber` (never `parseScanParam`, whose `Number(null) === 0` defect would turn an absent param into a `400`). The service passes the resolved values through and `response.params` echoes the effective values, so old clients that omit them still see the values actually used.

### JSON serialization of the flat-window boundary

`compression` and `latestTrend` could each be `Infinity` when their denominator window is all-flat and the numerator window is not, and `JSON.stringify` maps `Infinity` → `null`. The domain uses the existing `LARGE_RATIO` sentinel (1e9) instead, so both fields are always finite numbers on the wire and the UI renders each as `—` (dash) rather than a blank cell.

### Sorting by pure-price score, multi-timeframe first

`score = compression + latestTrend` — both mean-amplitude ratios, same unit, additive — is the pure-price rank: lower score = converging harder. Rows sort by `qualifiedCount` descending (a coin converging on several timeframes at once is a stronger, cross-timeframe-consistent signal), then `bestScore` ascending (hardest convergence first). The UI renders rows as-is (no client-side re-sort).
