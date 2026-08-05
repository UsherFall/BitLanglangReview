# Coin Scan (选币)

## 1. Scope / Trigger

The 选币 (Coin Scan) module finds instruments by pluggable scan methods. V1 ships only the **shrink** (缩量) method. It scans a parameterized universe of OKX swap instruments and ranks them by how much their volume has shrunk.

This contract covers `src/server/coin-scan-service.ts`, the `/api/scan` route in `src/server/app-plugin.ts`, the pure algorithm in `src/domain/coin-scan.ts`, and the UI in `src/ui/CoinScanPanel.tsx`.

## 2. Signatures

- Route: `GET /api/scan`
- Service: `CoinScanService.scanShrink(params: ShrinkScanParams): Promise<ScanResponse>`
- Pure algorithm: `computeQuietMetrics(candles, { ratioThreshold, consecutive, window, boxWindow, maxBoxRatio }): QuietMetrics | null`

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
| `boxWindow` | number (optional) | `DEFAULT_BOX_WINDOW` = 12 | `> 0`; number of trailing completed bars used to compute `boxTightness`. Absent / empty / NaN → `DEFAULT_BOX_WINDOW`; present and `<= 0` → 400 |
| `maxBoxRatio` | number (optional) | `DEFAULT_MAX_BOX_RATIO` = 0.9 | `> 0`; box-shape tightness threshold. Absent / empty / NaN → `DEFAULT_MAX_BOX_RATIO`; present and `<= 0` → 400 |

Non-numeric params fall back to the default (see `parseScanParam`). Invalid final values → 400.

> **Warning (known defect, pre-existing)**: `parseScanParam` treats an omitted param as `Number(null) === 0`, which is finite, so a missing `topN`/`window`/etc. yields `0` instead of the spec default and then trips the `400 Invalid scan parameters` guard. The UI always sends every param, so this is latent. If default-fallback for absent params matters, fix `parseScanParam` to distinguish `null` from a parsed value.
>
> `boxWindow`/`maxBoxRatio` deliberately do **not** use `parseScanParam`; they are parsed with `parseOptionalNumber`, which maps `null`/empty/NaN → `undefined`, so an absent `boxWindow`/`maxBoxRatio` falls back to its default instead of tripping the guard.

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
  qualified: boolean;          // consecutiveQuiet >= consecutive AND boxTightness <= maxBoxRatio
};
type ScanResponse = {
  scanned: ScanRow[];          // sorted by intensity ascending (most shrunk first)
  qualifiedCount: number;
  params: ShrinkScanParams;    // echoes the effective params, including the resolved boxWindow/maxBoxRatio
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

The calm gate is **volume-only** (`volumeRatio < ratioThreshold`). Amplitude no longer gates calm, so a coin that has been quiet for a long time (amplitude ≈ its own window mean → `amplitudeRatio ≈ 1`) is not rejected for not being "freshly" quiet; shape is carried entirely by `boxTightness`.

Instruments whose candles are too few (`< window + consecutive`, or `< boxWindow`) or have a zero window average are skipped and do not appear in `scanned`.

## 4. Validation & Error Matrix

| Condition | Error |
| --- | --- |
| non-GET method | 405 |
| `method` != `shrink` | 400 `Unsupported scan method` |
| `timeframe` not in `scanTimeframes` | 400 |
| `topN < 1` / `consecutive < 1` / `window < 1` / `ratioThreshold <= 0` / `minQuoteVolume24h < 0` | 400 `Invalid scan parameters` |
| `boxWindow` present and `<= 0` | 400 `Invalid scan parameters` |
| `maxBoxRatio` present and `<= 0` | 400 `Invalid scan parameters` |
| OKX tickers or candlestick fetch fails | 502 with readable message |

## 5. Good/Base/Bad Cases

- **Good**: volume ratio 0.2 for each of 3 consecutive bars, and the trailing 12 bars form a tight box (`boxTightness ≈ 0.87 <= 0.9`) → each bar calm, `consecutiveQuiet 3`, `qualified true`, `intensity` reported.
- **Base**: 2 of 3 trailing bars calm (one bar's volume ratio above `ratioThreshold`) → `qualified false`, `intensity` still reported. Also: 3 trailing bars all calm but the trailing 12 bars are stretched by a large candle inside the window (`boxTightness > 0.9`) → `qualified false`, `boxTightness` still reported.
- **Bad**: fewer than `window + consecutive` completed candles, or fewer than `boxWindow` completed candles, or a zero volume-window average → metrics `null`, instrument skipped.

## 6. Tests Required

- `tests/coin-scan.test.ts` — pure algorithm: ratio/average (sliding window), qualified/not, insufficient history → null (both `window + consecutive` and `boxWindow` guards), input order independence, zero-average → null, `boxTightness`: real tight box → qualified, large candle inside the box window → rejected, wide oscillation ≈ 1.0 rejected / nested tight box < 1.0 passes, scale-free (2%/bar vs 0.5%/bar same threshold), long-quiet coin with `amplitudeRatio ≈ 1` not rejected, dead coin (volume never shrinks) rejected, omitted `boxWindow`/`maxBoxRatio` fall back to defaults.
- `tests/coin-scan-service.test.ts` — USDT-SWAP filter + Top-N order, forming bar dropped (`limit = max(window + consecutive, boxWindow) + 1`, newest bar excluded), `change24h` from last/open24h, insufficient candles skipped, intensity ascending sort, `boxTightness` carried on rows, `params.boxWindow`/`params.maxBoxRatio` echoed.
- `tests/chart-time.test.ts` — `formatReviewInputTime` round-trips through `freeReplayProgressTimeForStart`.

## 7. Wrong vs Correct

#### Wrong

The scan keeps the still-forming bar; a partial candle with tiny volume qualifies the coin on noise. The amplitude gate (`amplitudeRatio < volatilityThreshold`) rejects long-quiet coins (amplitude ≈ mean → ratio ≈ 1) and lets fresh flags through (big candle inflates the window mean → later ratio tiny), which is the opposite of "坐实窄箱".

#### Correct

`candleSource.getCandlesticks` is called with `limit = max(window + consecutive, boxWindow) + 1`, then `candles.slice(0, -1)` drops the newest (forming) bar before `computeQuietMetrics`, so every metric (including `boxTightness`) is computed only over completed candles. Calm is volume-only; shape is enforced by `boxTightness` over the trailing `boxWindow` bars, so only coins that have actually sat in a tight box with shrinking volume qualify.

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

### `boxWindow`/`maxBoxRatio` are optional and echoed

The route resolves an absent/empty/NaN `boxWindow`/`maxBoxRatio` to its default via `parseOptionalNumber` (never `parseScanParam`, whose `Number(null) === 0` defect would turn an absent param into a `400`). The service passes the resolved values through and `response.params` echoes the effective values, so old clients that omit them still see the values actually used.

### Sorting unchanged

`boxTightness` is a gate, not a rank. Rows are still sorted by relative `intensity` ascending; box-shaped and trend-shaped coins within the qualified pool rank by quietness.
