# Coin Scan (选币)

## 1. Scope / Trigger

The 选币 (Coin Scan) module finds instruments by pluggable scan methods. V1 ships only the **shrink** (缩量) method. It scans a parameterized universe of OKX swap instruments and ranks them by how much their volume has shrunk.

This contract covers `src/server/coin-scan-service.ts`, the `/api/scan` route in `src/server/app-plugin.ts`, the pure algorithm in `src/domain/coin-scan.ts`, and the UI in `src/ui/CoinScanPanel.tsx`.

## 2. Signatures

- Route: `GET /api/scan`
- Service: `CoinScanService.scanShrink(params: ShrinkScanParams): Promise<ScanResponse>`
- Pure algorithm: `computeQuietMetrics(candles, { ratioThreshold, consecutive, window, boxWindow, maxBoxRatio, maxCompression, maxLatestTrend, trendWindow }): QuietMetrics | null`

## 3. Contracts

### Request (query params)

| Field | Type | Default | Constraint |
| --- | --- | --- | --- |
| `method` | string | — | must be `shrink`; anything else → 400 |
| `timeframe` | `ReviewTimeframe` | — | must be in `scanTimeframes` = `['5m','15m','1H','4H','1D']` → 400 otherwise |
| `topN` | number | 50 | `>= 1` |
| `ratioThreshold` | number | 0.7 | `> 0`; volume-ratio shrink threshold |
| `consecutive` | number | 3 | `>= 1` |
| `window` | number | 20 | `>= 1` |
| `minQuoteVolume24h` | number | 10_000_000 | `>= 0`; instruments below this 24h quote volume are filtered before Top-N selection |
| `boxWindow` | number (optional) | `DEFAULT_BOX_WINDOW` = 12 | `> 0`; number of trailing completed bars used to compute `boxTightness` and the recent compression window. Absent / empty / NaN → `DEFAULT_BOX_WINDOW`; present and `<= 0` → 400 |
| `maxBoxRatio` | number (optional) | `DEFAULT_MAX_BOX_RATIO` = 0.9 | `> 0`; box-shape tightness threshold. Absent / empty / NaN → `DEFAULT_MAX_BOX_RATIO`; present and `<= 0` → 400 |
| `maxCompression` | number (optional) | `DEFAULT_MAX_COMPRESSION` = 0.8 | `> 0`; volatility-compression threshold: recent mean amplitude must be `<= maxCompression ×` prior mean amplitude. Absent / empty / NaN → `DEFAULT_MAX_COMPRESSION`; present and `<= 0` → 400 |
| `maxLatestTrend` | number (optional) | `DEFAULT_MAX_LATEST_TREND` = 0.9 | `> 0`; latest-trend threshold: latest `trendWindow` mean amplitude must be `<= maxLatestTrend ×` the `trendWindow` mean amplitude before it (波动仍在收窄). Absent / empty / NaN → `DEFAULT_MAX_LATEST_TREND`; present and `<= 0` → 400 |
| `trendWindow` | number (optional) | `DEFAULT_TREND_WINDOW` = 4 | `>= 1` and `<= boxWindow` (resolved); number of trailing completed bars for the latest-trend windows. Absent / empty / NaN → `DEFAULT_TREND_WINDOW`; present and `<= 0` or `> resolved boxWindow` → 400 |

Non-numeric params fall back to the default (see `parseScanParam`). Invalid final values → 400.

> **Warning (known defect, pre-existing)**: `parseScanParam` treats an omitted param as `Number(null) === 0`, which is finite, so a missing `topN`/`window`/etc. yields `0` instead of the spec default and then trips the `400 Invalid scan parameters` guard. The UI always sends every param, so this is latent. If default-fallback for absent params matters, fix `parseScanParam` to distinguish `null` from a parsed value.
>
> `boxWindow`/`maxBoxRatio`/`maxCompression`/`maxLatestTrend`/`trendWindow` deliberately do **not** use `parseScanParam`; they are parsed with `parseOptionalNumber`, which maps `null`/empty/NaN → `undefined`, so an absent optional param falls back to its default instead of tripping the guard.

### Response (`ScanResponse`)

```ts
type ScanRow = {
  instrument: string;          // BTC-USDT-SWAP
  lastPrice: number;           // from OKX ticker `last`
  change24h: number;           // percent, (last - open24h) / open24h * 100
  quoteVolume24h: number;      // 24h quote volume in USDT = `volCcy24h` (base coins) * `last`
  currentVolume: number;       // last completed candle volume
  averageVolume: number;       // mean of the `window` candles before it
  ratio: number;               // volume ratio of last bar = currentVolume / averageVolume
  amplitudeRatio: number;      // (high-low)/low of last bar over the `window` amplitude mean (reported, not gated)
  intensity: number;           // quiet score = mean over last `consecutive` bars of (volumeRatio + amplitudeRatio) / 2
  consecutiveQuiet: number;    // trailing count of bars that are calm (volumeRatio < ratioThreshold)
  boxTightness: number;        // scale-free box-shape score over the trailing `boxWindow` bars = R / (m * sqrt(boxWindow)); 0 when m <= 0
  compression: number;         // meanAmp(recent boxWindow) / meanAmp(prior boxWindow); LARGE_RATIO when prior is flat and recent is not
  latestTrend: number;         // meanAmp(latest trendWindow) / meanAmp(middle trendWindow); LARGE_RATIO when middle is flat and latest is not
  qualified: boolean;          // consecutiveQuiet >= consecutive AND boxTightness <= maxBoxRatio AND compression <= maxCompression AND latestTrend <= maxLatestTrend
};
type ScanResponse = {
  scanned: ScanRow[];          // sorted by intensity ascending (most shrunk first)
  qualifiedCount: number;
  params: ShrinkScanParams;    // echoes the effective params, including the resolved boxWindow/maxBoxRatio/maxCompression/maxLatestTrend/trendWindow
  scannedAt: string;           // ISO
};
```

`boxTightness` is computed over the trailing `boxWindow` completed bars (independent of the `consecutive` calm streak):

```
N = boxWindow
lastN = sorted trailing N completed bars
R = (max(high) - min(low)) / min(low)        // total range of the trailing N bars
m = mean( per-bar (high - low) / low )        // mean single-bar amplitude
boxTightness = m > 0 ? R / (m * sqrt(N)) : 0
```

Intuition: a genuine box oscillates in place so its bars overlap and the total range is ≈ a single bar's amplitude × √N → `boxTightness ≈ 1`. A one-sided trend drifts cumulatively so the total range is ≈ a single bar's amplitude × N → `boxTightness ≈ √N`. A large candle anywhere inside the window makes the total range large relative to the mean per-bar amplitude, pushing `boxTightness` well above 1. Because the score is divided by `√N` and normalized to the instrument's own amplitude, a single `maxBoxRatio` works for any `boxWindow`, any timeframe, and any absolute volatility level. `m <= 0` (all-flat bars) is treated as a perfect box → `boxTightness = 0`.

`compression` is computed over two adjacent, equal-length windows of completed bars — the trailing `boxWindow` bars (`recent`) and the `boxWindow` bars immediately before them (`prior`):

```
N = boxWindow
meanAmp(w) = mean( per-bar (high - low) / low over the window w )
compression = meanAmp(prior) > 0
            ? meanAmp(recent) / meanAmp(prior)
            : meanAmp(recent) > 0 ? LARGE_RATIO : 0
```

Intuition: a coin that is converging to a breakdown has recently shrunk its own volatility (`meanAmp(recent) << meanAmp(prior)` → `compression < 1`). A coin that has always been quiet has `compression ≈ 1` — no "tension" — and is rejected. Because both windows use the instrument's own amplitudes, `compression` is scale-free: a 0.5%/bar coin and a 2%/bar coin compress with the same ratio. Boundary: a flat prior window with an active recent window ("woke up from flat") is not convergence and reports `LARGE_RATIO` (1e9 sentinel so JSON never serializes `Infinity` → `null`); two flat windows report `compression = 0` and the volume-shrink gate carries the verdict.

`latestTrend` is the "is it still narrowing" (收窄趋势) gate over two adjacent, equal-length windows of completed bars — the trailing `trendWindow` bars (`latest`) and the `trendWindow` bars immediately before them (`middle`):

```
T = trendWindow
meanAmp(w) = mean( per-bar (high - low) / low over the window w )
latestTrend = meanAmp(middle) > 0
            ? meanAmp(latest) / meanAmp(middle)
            : meanAmp(latest) > 0 ? LARGE_RATIO : 0
```

Intuition: `compression` only asks "quieter than before", so a coin that flattened out or has been uniformly quiet passes it. `latestTrend` asks "still getting quieter toward the present": a still-converging coin scores `< 1`; a coin whose latest window is about the same as its middle window (`latestTrend ≈ 1`, flattened out — e.g. CRCL 0.93) or is widening (`latestTrend > 1` — e.g. NBIS 1.39) has no 收窄 feel and is rejected. A narrowing coin (e.g. GIGGLE 0.70) passes. Because both windows use the instrument's own amplitudes, `latestTrend` is scale-free, and one `maxLatestTrend` works for any timeframe and volatility level. Boundary: a flat middle window with an active latest window reports `LARGE_RATIO` ("woke up from flat"); two flat windows report `latestTrend = 0` and the other gates carry the verdict. `trendWindow` must be `<= boxWindow` (enforced by the route), so both latest-trend windows sit inside the trailing box window.

The calm gate is **volume-only** (`volumeRatio < ratioThreshold`). Amplitude no longer gates calm, so a coin that has been quiet for a long time (amplitude ≈ its own window mean → `amplitudeRatio ≈ 1`) is not rejected for not being "freshly" quiet; shape is carried by `boxTightness`, tension by `compression`, and "still narrowing" by `latestTrend`.

Instruments whose candles are too few (`< window + consecutive`, `< 2 × boxWindow` so both compression windows exist, or `< 2 × trendWindow` so both latest-trend windows exist) or have a zero window average are skipped and do not appear in `scanned`.

## 4. Validation & Error Matrix

| Condition | Error |
| --- | --- |
| non-GET method | 405 |
| `method` != `shrink` | 400 `Unsupported scan method` |
| `timeframe` not in `scanTimeframes` | 400 |
| `topN < 1` / `consecutive < 1` / `window < 1` / `ratioThreshold <= 0` / `minQuoteVolume24h < 0` | 400 `Invalid scan parameters` |
| `boxWindow` present and `<= 0` | 400 `Invalid scan parameters` |
| `maxBoxRatio` present and `<= 0` | 400 `Invalid scan parameters` |
| `maxCompression` present and `<= 0` | 400 `Invalid scan parameters` |
| `maxLatestTrend` present and `<= 0` | 400 `Invalid scan parameters` |
| `trendWindow` present and `<= 0` | 400 `Invalid scan parameters` |
| `trendWindow` present and `> resolved boxWindow` | 400 `Invalid scan parameters` |
| OKX tickers or candlestick fetch fails | 502 with readable message |

## 5. Good/Base/Bad Cases

- **Good**: volume ratio 0.2 for each of 3 consecutive bars, the trailing 12 bars form a tight box (`boxTightness ≈ 0.87 <= 0.9`), the recent 12 bars compress to `≈ 0.3×` the prior 12 bars' mean amplitude (`compression <= 0.8`), and the trailing 4 bars narrow to `≈ 0.7×` the 4 bars before them (`latestTrend <= 0.9`) → each bar calm, `consecutiveQuiet 3`, `qualified true`, `intensity`/`compression`/`latestTrend` reported.
- **Base**: 2 of 3 trailing bars calm (one bar's volume ratio above `ratioThreshold`) → `qualified false`, `intensity` still reported. Also: 3 trailing bars all calm but the trailing 12 bars are stretched by a large candle inside the window (`boxTightness > 0.9`) → `qualified false`, `boxTightness` still reported. Also: tight box and volume shrink but `compression ≈ 0.9` (recent ≈ prior, a coin that has always been quiet → no tension) → `qualified false`, `compression` still reported. Also: tight box, volume shrink, and compression green but `latestTrend ≈ 0.93` (flattened out) or `> 1` (widening) → `qualified false`, `latestTrend` still reported.
- **Bad**: fewer than `window + consecutive` completed candles, fewer than `2 × boxWindow` completed candles, fewer than `2 × trendWindow` completed candles, or a zero volume-window average → metrics `null`, instrument skipped.

## 6. Tests Required

- `tests/coin-scan.test.ts` — pure algorithm: ratio/average (sliding window), qualified/not, insufficient history → null (the `window + consecutive`, `2 × boxWindow`, and `2 × trendWindow` guards), input order independence, zero-average → null, `boxTightness`: real tight box → qualified, large candle inside the box window → rejected, wide oscillation ≈ 1.0 rejected / nested tight box < 1.0 passes, scale-free (2%/bar vs 0.5%/bar same threshold), long-quiet coin with `amplitudeRatio ≈ 1` not rejected, dead coin (volume never shrinks) rejected, omitted `boxWindow`/`maxBoxRatio`/`maxCompression` fall back to defaults; `compression`: recent clearly below prior → qualified, recent ≈ prior → rejected, prior flat + recent active → `LARGE_RATIO` rejected, both flat → `0` passes, scale-free (0.5%/bar vs 2%/bar same ratio); `latestTrend`: latest clearly below middle → qualified, latest ≈ middle (0.93×) → rejected, latest > middle (1.4×) → rejected, middle flat + latest active → `LARGE_RATIO` rejected, both flat → `0` passes, scale-free, omitted `maxLatestTrend`/`trendWindow` fall back to defaults.
- `tests/coin-scan-service.test.ts` — USDT-SWAP filter + Top-N order, forming bar dropped (`limit = max(window + consecutive, 2 × boxWindow) + 1`, newest bar excluded), `change24h` from last/open24h, insufficient candles skipped, intensity ascending sort, `boxTightness`/`compression`/`latestTrend` carried on rows, `params.boxWindow`/`params.maxBoxRatio`/`params.maxCompression`/`params.maxLatestTrend`/`params.trendWindow` echoed.
- `tests/chart-time.test.ts` — `formatReviewInputTime` round-trips through `freeReplayProgressTimeForStart`.

## 7. Wrong vs Correct

#### Wrong

The scan keeps the still-forming bar; a partial candle with tiny volume qualifies the coin on noise. The amplitude gate (`amplitudeRatio < volatilityThreshold`) rejects long-quiet coins (amplitude ≈ mean → ratio ≈ 1) and lets fresh flags through (big candle inflates the window mean → later ratio tiny), which is the opposite of "坐实窄箱".

#### Correct

`candleSource.getCandlesticks` is called with `limit = max(window + consecutive, 2 × boxWindow) + 1`, then the still-forming bar is dropped **by time** (`candle.timestamp + timeframeMs(timeframe) > anchor`) before `computeQuietMetrics`, so every metric (including `boxTightness`, `compression`, and `latestTrend`) is computed only over completed candles. Do not `slice(0, -1)` unconditionally: the candle cache may contain no forming bar, and slicing then wrongly drops the newest **completed** bar (the scan silently lags one bar). Calm is volume-only; shape is enforced by `boxTightness` over the trailing `boxWindow` bars, tension by `compression` over the recent-vs-prior `boxWindow` windows, and "still narrowing" by `latestTrend` over the latest-vs-middle `trendWindow` windows, so only coins that have actually sat in a tight box with shrinking volume, shrinking volatility, and shrinking-toward-present volatility qualify.

## Design Decisions

### Extensible method dispatch

The route reads `method` and the UI exposes a method selector. Adding a new find-coin method = new branch in `CoinScanService`, a new `ScanResponse` variant, and a new case in `CoinScanPanel`. V1 deliberately ships only `shrink` to keep the extensibility seam without speculative UI.

### Volume ratio vs raw volume

`ratio` is normalized against each candle's own sliding window so instruments with very different absolute volumes are comparable in one ranking.

### Scale-free box-shape instead of amplitude gates

Fixed absolute amplitude floors (e.g. `maxAbsAmplitude`) misclassify high-volatility altcoins (2% amplitude is convergence for them) and miss low-volatility majors/equities (0.5%). `boxTightness = R / (m × √N)` is scale-free: it only measures "oscillate in place vs drift", not the absolute level of movement. A 2%-per-bar box and a 0.5%-per-bar box both score ≈ 1 and pass the same threshold; a one-sided trend scores ≈ √N regardless of its per-bar amplitude and is rejected. `maxBoxRatio` is a single global threshold (`DEFAULT_MAX_BOX_RATIO = 0.9`) with no per-timeframe table because the √N normalization makes one value work for any `boxWindow` and timeframe.

### Box window independent of the calm streak

`boxTightness` uses `boxWindow` (default 12), not `consecutive`, so the two knobs are decoupled: `consecutive` controls the volume-shrink streak length, `boxWindow` controls how far back the box must be "坐实". A long `boxWindow` also naturally excludes fresh flags — a large candle anywhere in the last 12 bars stretches the range and pushes `boxTightness` over the threshold, so there is no separate "no recent big candle" check.

### Remove the amplitude relative gate

The old `amplitudeRatio < volatilityThreshold` gate was the source of both false positives (fresh flags: a big candle inflates the window mean, so the next few tiny bars show a tiny ratio and pass) and false negatives (long-quiet coins: current ≈ mean → ratio ≈ 1 → rejected). `boxTightness` carries the shape duty; `volatilityThreshold` was removed from the contract.

### Volume-shrink gate kept as the 蓄力 signal

`volumeRatio < ratioThreshold` still gates calm, so a dead coin whose volume never shrinks (ratio ≈ 1) is rejected — the scan looks for volume shrinking toward a floor, not just any quiet price.

### Volatility compression: the tension gate

v2's `boxTightness` only measures "oscillate in place vs drift"; it does not distinguish a genuinely converging coin from one that has always been quiet. `compression = meanAmp(recent boxWindow) / meanAmp(prior boxWindow)` adds the user's "现在的波动明显比之前小" criterion: the coin must be quieter **relative to its own recent past**. A flat coin has `compression ≈ 1` and is rejected for lacking tension; a converging coin scores `< 1`. The ratio is scale-free (instrument's own amplitude in both windows), a single `maxCompression` threshold works for any timeframe/volatility level, and the prior window is adjacent to recent so older noise does not dilute the comparison.

### `compression` is a hard gate + a display column

Qualification requires `compression <= maxCompression`, and the panel shows the raw 压缩比 on every row so the user can calibrate the threshold by eye after each scan (even for rejected coins). This is a strictness knob — more gates mean fewer results, which matches the user's "宁少勿滥" stance.

### Latest-trend: the "still narrowing" gate

v3's `compression` asks "quieter than before", which lets a coin that flattened out (latest ≈ middle) or has always been quiet slip through with `compression < 1`. The user's 1H scan found CRCL (`latestTrend ≈ 0.93`, flattened) and NBIS (`≈ 1.39`, widening) that 12/12 compression did not catch, while GIGGLE (`≈ 0.70`) was the true 收窄. `latestTrend = meanAmp(latest trendWindow) / meanAmp(middle trendWindow)` adds the "现在的波动是不是还在变小" criterion: the trailing `trendWindow` (default 4) bars must be meaningfully narrower than the `trendWindow` bars right before them. The ratio is scale-free (instrument's own amplitude in both windows), one `maxLatestTrend` threshold works for any timeframe/volatility level, and the middle window is adjacent to latest so older noise does not dilute the comparison.

### `latestTrend` is a hard gate + a display column

Qualification requires `latestTrend <= maxLatestTrend`, and the panel shows the raw 收窄趋势 on every row (even for rejected coins) so the user can calibrate the threshold by eye. The tradeoff is accepted: a uniformly quiet small box has `latestTrend ≈ 1` and is rejected by the default 0.9 — the user explicitly wants "越来越小" tension, and the threshold is adjustable.

### Optional params are echoed

The route resolves an absent/empty/NaN `boxWindow`/`maxBoxRatio`/`maxCompression`/`maxLatestTrend`/`trendWindow` to its default via `parseOptionalNumber` (never `parseScanParam`, whose `Number(null) === 0` defect would turn an absent param into a `400`). The service passes the resolved values through and `response.params` echoes the effective values, so old clients that omit them still see the values actually used.

### JSON serialization of the flat-window boundary

`compression` and `latestTrend` could each be `Infinity` when their denominator window is all-flat and the numerator window is not, and `JSON.stringify` maps `Infinity` → `null`. The domain uses the existing `LARGE_RATIO` sentinel (1e9) instead, so both fields are always finite numbers on the wire and the UI renders each as `—` (dash) rather than a blank cell.

### Sorting unchanged

`boxTightness`, `compression`, and `latestTrend` are gates, not ranks. Rows are still sorted by relative `intensity` ascending; box-shaped and trend-shaped coins within the qualified pool rank by quietness.
