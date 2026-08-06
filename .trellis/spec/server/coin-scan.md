# Coin Scan (选币)

## 1. Scope / Trigger

The 选币 (Coin Scan) module finds instruments by pluggable scan methods. V1 ships only the **shrink** (收敛) method. It scans a parameterized universe of **Binance USDT-M perpetuals** by default (switchable to OKX SWAP via `MARKET_DATA_SOURCE=okx`) and ranks them by pure-price convergence: how much their volatility has compressed against their own recent past and is still narrowing toward the present. **Volume plays no role** — the user's stance is "看裸 K". The pool is derived from the ticker source (all USDT-M perpetuals above the `minQuoteVolume24h` floor, taking the top `topN`), so the precious-metal perpetual **XAUUSDT** (gold) is in the pool by default.

This contract covers `src/server/coin-scan-service.ts`, the `/api/scan` route in `src/server/app-plugin.ts`, the pure algorithm in `src/domain/coin-scan.ts`, and the UI in `src/ui/CoinScanPanel.tsx`.

## 2. Signatures

- Route: `GET /api/scan`
- Service: `CoinScanService.scanShrink(params: ShrinkScanParams): Promise<ScanResponse>`
- Pure algorithm: `computeQuietMetrics(candles, { boxWindow, maxCompression, maxLatestTrend, trendWindow }): QuietMetrics | null`

## 3. Contracts

### Request (query params)

| Field | Type | Default | Constraint |
| --- | --- | --- | --- |
| `method` | string | — | must be `shrink`; anything else → 400 |
| `timeframe` | `ReviewTimeframe` | — | must be in `scanTimeframes` = `['5m','15m','1H','4H','1D']` → 400 otherwise |
| `topN` | number | 50 | `>= 1` |
| `minQuoteVolume24h` | number | 10_000_000 | `>= 0`; instruments below this 24h quote volume are filtered before Top-N selection |
| `anchor` | number (optional) | now | epoch ms; bars whose close time (`timestamp + timeframe`) is `<= anchor` are treated as completed, so a past anchor scans "as of" that instant (e.g. `2026-08-04T00:00:00Z` → newest completed 1D bar is 08-03). Absent / empty / NaN → `Date.now()`. Present and `<= 0` → 400 |
| `boxWindow` | number (optional) | `DEFAULT_BOX_WINDOW` = 4 | `> 0`; number of trailing completed bars used as the compression window. Absent / empty / NaN → `DEFAULT_BOX_WINDOW`; present and `<= 0` → 400 |
| `maxCompression` | number (optional) | `DEFAULT_MAX_COMPRESSION` = 0.8 | `> 0`; volatility-compression threshold: recent mean amplitude must be `<= maxCompression ×` prior mean amplitude. Absent / empty / NaN → `DEFAULT_MAX_COMPRESSION`; present and `<= 0` → 400 |
| `maxLatestTrend` | number (optional) | `DEFAULT_MAX_LATEST_TREND` = 0.9 | `> 0`; latest-trend threshold: latest `trendWindow` mean amplitude must be `<= maxLatestTrend ×` the `trendWindow` mean amplitude before it (波动仍在收窄). Absent / empty / NaN → `DEFAULT_MAX_LATEST_TREND`; present and `<= 0` → 400 |
| `trendWindow` | number (optional) | `DEFAULT_TREND_WINDOW` = 3 | `>= 1` and `<= boxWindow` (resolved); number of trailing completed bars for the latest-trend windows. Absent / empty / NaN → `DEFAULT_TREND_WINDOW`; present and `<= 0` or `> resolved boxWindow` → 400 |

The volume-related params (`ratioThreshold`, `consecutive`, `window`) were removed in v5. Non-numeric params fall back to the default (see `parseScanParam`). Invalid final values → 400.

> **Warning (known defect, pre-existing)**: `parseScanParam` treats an omitted param as `Number(null) === 0`, which is finite, so a missing `topN` yields `0` instead of the spec default and then trips the `400 Invalid scan parameters` guard. The UI always sends every param, so this is latent. If default-fallback for absent params matters, fix `parseScanParam` to distinguish `null` from a parsed value.
>
> `boxWindow`/`maxCompression`/`maxLatestTrend`/`trendWindow` deliberately do **not** use `parseScanParam`; they are parsed with `parseOptionalNumber`, which maps `null`/empty/NaN → `undefined`, so an absent optional param falls back to its default instead of tripping the guard.

### Response (`ScanResponse`)

```ts
type ScanRow = {
  instrument: string;          // XAUUSDT / BTCUSDT (Binance), BTC-USDT-SWAP (OKX)
  lastPrice: number;           // from ticker `last`
  change24h: number;           // percent, (last - open24h) / open24h * 100
  quoteVolume24h: number;      // 24h quote volume in USDT (from ticker, not K-line volume; kept for the minQuoteVolume24h liquidity filter)
  compression: number;         // meanAmp(recent boxWindow) / meanAmp(prior boxWindow); LARGE_RATIO when prior is flat and recent is not
  latestTrend: number;         // meanAmp(latest trendWindow) / meanAmp(middle trendWindow); LARGE_RATIO when middle is flat and latest is not
  score: number;               // compression + latestTrend; sort key, lower = converging harder
  qualified: boolean;          // compression <= maxCompression AND latestTrend <= maxLatestTrend
};
type ScanResponse = {
  scanned: ScanRow[];          // sorted by score ascending (most converged first)
  qualifiedCount: number;
  params: ShrinkScanParams;    // echoes the effective params, including the resolved anchor/boxWindow/maxCompression/maxLatestTrend/trendWindow
  scannedAt: string;           // ISO
};
```

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

Intuition: `compression` only asks "quieter than before", so a coin that flattened out or has been uniformly quiet passes it. `latestTrend` asks "still getting quieter toward the present": a still-converging coin scores `< 1`; a coin whose latest window is about the same as its middle window (`latestTrend ≈ 1`, flattened out) or is widening (`latestTrend > 1`) has no 收窄 feel and is rejected. Because both windows use the instrument's own amplitudes, `latestTrend` is scale-free, and one `maxLatestTrend` works for any timeframe and volatility level. Boundary: a flat middle window with an active latest window reports `LARGE_RATIO` ("woke up from flat"); two flat windows report `latestTrend = 0` and the compression gate carries the verdict. `trendWindow` must be `<= boxWindow` (enforced by the route), so both latest-trend windows sit inside the trailing box window.

There is **no volume gate and no box-shape gate**: a slow-slope compression (price drifting while per-bar amplitude narrows) is a legitimate 收敛 and qualifies. That is exactly the gold 1D case — the user wants 08-03/08-04 (XAUUSDT 1D, a ~4040–4112 horizontal band with narrowing daily amplitude) to scan out, which the v4 volume gate (`consecutiveQuiet`) and the v2 `boxTightness` gate both mis-rejected.

Instruments whose candles are too few (`< 2 × boxWindow` so both compression windows exist, or `< 2 × trendWindow` so both latest-trend windows exist) or have a non-positive price are skipped and do not appear in `scanned`.

## 4. Validation & Error Matrix

| Condition | Error |
| --- | --- |
| non-GET method | 405 |
| `method` != `shrink` | 400 `Unsupported scan method` |
| `timeframe` not in `scanTimeframes` | 400 |
| `topN < 1` / `minQuoteVolume24h < 0` | 400 `Invalid scan parameters` |
| `anchor` present and `<= 0` | 400 `Invalid scan parameters` |
| `boxWindow` present and `<= 0` | 400 `Invalid scan parameters` |
| `maxCompression` present and `<= 0` | 400 `Invalid scan parameters` |
| `maxLatestTrend` present and `<= 0` | 400 `Invalid scan parameters` |
| `trendWindow` present and `<= 0` | 400 `Invalid scan parameters` |
| `trendWindow` present and `> resolved boxWindow` | 400 `Invalid scan parameters` |
| Binance/OKX tickers or candlestick fetch fails | 502 with readable message |

## 5. Good/Base/Bad Cases

- **Good**: the recent `boxWindow` bars compress to `≈ 0.3×` the prior `boxWindow` bars' mean amplitude (`compression <= 0.8`) and the trailing `trendWindow` bars narrow to `≈ 0.7×` the `trendWindow` bars before them (`latestTrend <= 0.9`) → `qualified true`, `compression`/`latestTrend`/`score` reported. Gold-style: a slow-slope compression (wide price band, amplitude still narrowing) qualifies the same way — no box-shape gate, no volume gate.
- **Base**: `compression ≈ 0.9` (recent ≈ prior, a coin that has always been quiet → no tension) → `qualified false`, `compression` still reported. Also: `latestTrend ≈ 0.93` (flattened out) or `> 1` (widening) → `qualified false`, `latestTrend` still reported. Also: a large candle inside the recent box window lifts the recent mean amplitude so `compression > 0.8` (a fresh flag — big candle + small follow-up) → `qualified false`, `compression` still reported.
- **Bad**: fewer than `2 × boxWindow` completed candles, fewer than `2 × trendWindow` completed candles, or a non-positive price → metrics `null`, instrument skipped.

## 6. Tests Required

- `tests/coin-scan.test.ts` — pure algorithm: input order independence, insufficient history → null (the `2 × boxWindow` and `2 × trendWindow` guards), non-positive price → null, scale-free (2%/bar vs 0.5%/bar same threshold); `compression`: recent clearly below prior → qualified, recent ≈ prior → rejected, prior flat + recent active → `LARGE_RATIO` rejected, both flat → `0` passes; `latestTrend`: latest clearly below middle → qualified, latest ≈ middle (0.93×) → rejected, latest > middle (1.4×) → rejected, middle flat + latest active → `LARGE_RATIO` rejected, both flat → `0` passes, scale-free, a single wider bar rejected at tr=2 but averaged out (qualified) at tr=3; `score = compression + latestTrend` and lower score = stronger convergence; defaults (`DEFAULT_BOX_WINDOW` = 4, `DEFAULT_MAX_COMPRESSION` = 0.8, `DEFAULT_MAX_LATEST_TREND` = 0.9, `DEFAULT_TREND_WINDOW` = 3) and omitted-params fallback; gold-style 1D convergence qualifies with `boxWindow` 3 and 4.
- `tests/coin-scan-service.test.ts` — USDT-SWAP filter + Top-N order, forming bar dropped (`limit = 2 × max(boxWindow, trendWindow) + 1`, newest bar excluded), `change24h` from last/open24h, insufficient candles skipped, score ascending sort, `compression`/`latestTrend` carried on rows, `params.boxWindow`/`params.maxCompression`/`params.maxLatestTrend`/`params.trendWindow` echoed, gold-style 1D convergence qualifies at the anchor.
- `tests/chart-time.test.ts` — `formatReviewInputTime` round-trips through `freeReplayProgressTimeForStart`.

## 7. Wrong vs Correct

#### Wrong

The scan keeps the still-forming bar; a partial candle with tiny amplitude qualifies the coin on noise. The volume gate (`consecutiveQuiet >= consecutive`) mis-rejects gold 1D: 08-01/08-02 shrank volume (volR 0.09/0.29) but 08-03/08-04 volume rebounded (volR 0.86/1.25), so consecutive-quiet was 0 and the 08-04 convergence (the user's eye: "横盘该扫出") was rejected even though compression/latestTrend were green. The v2 `boxTightness` gate mis-rejects gold-style convergence too: a slow-slope compression (compression 0.18) fails the tight-box score (1.1–1.8) even though the user's eye says "波动明显比之前小".

#### Correct

`candleSource.getCandlesticks` is called with `limit = 2 × max(boxWindow, trendWindow) + 1`, then the still-forming bar is dropped **by time** (`candle.timestamp + timeframeMs(timeframe) > anchor`) before `computeQuietMetrics`, so every metric (including `compression` and `latestTrend`) is computed only over completed candles. Do not `slice(0, -1)` unconditionally: the candle cache may contain no forming bar, and slicing then wrongly drops the newest **completed** bar (the scan silently lags one bar). Qualification is pure price — `compression <= maxCompression && latestTrend <= maxLatestTrend`; volume plays no role. There is no box-shape gate — the objective is "现在在收敛且收敛到极致", which compression + latestTrend carry. Rows sort by `score = compression + latestTrend` ascending (most converged first).

## Design Decisions

### Extensible method dispatch

The route reads `method` and the UI exposes a method selector. Adding a new find-coin method = new branch in `CoinScanService`, a new `ScanResponse` variant, and a new case in `CoinScanPanel`. V1 deliberately ships only `shrink` to keep the extensibility seam without speculative UI.

### Scale-free relative gates instead of absolute amplitude floors

Fixed absolute amplitude floors (e.g. `maxAbsAmplitude`) misclassify high-volatility altcoins (2% amplitude is convergence for them) and miss low-volatility majors/equities (0.5%). `compression` and `latestTrend` are scale-free: each is a ratio of the instrument's own mean amplitudes, so a 2%-per-bar coin and a 0.5%-per-bar coin compress with the same ratio and one threshold works for any timeframe and volatility level.

### Box-shape gate removed

v2's `boxTightness = R / (m × √N)` measured "oscillate in place vs drift" — a proxy for 收敛. It mis-fired on gold-style convergence: a slow-slope compression (per-bar amplitude narrowing while the price drifts) scores `boxTightness` 1.1–1.8 and was rejected even though `compression` was 0.18 (the user's eye: "波动明显比之前小"). v3.5 removes the box gate entirely; the objective is "现在在收敛且收敛到极致", carried by `compression` (quieter than before) + `latestTrend` (still narrowing). The `boxWindow` knob stays as the compression window length; `maxBoxRatio` is gone from the contract.

### Fresh-flag exclusion now lives in compression

A large candle inside the recent `boxWindow` lifts the recent mean amplitude, so `compression` climbs above `maxCompression` and the coin is rejected — the "no recent big candle" duty that `boxTightness` once served is folded into the compression gate.

### Volume dimension removed entirely (v5)

The v4 volume gate (`volumeRatio < ratioThreshold` gating calm, `consecutiveQuiet >= consecutive`) was the hard blocker for gold 1D: the 08-03/08-04 convergence failed on consecutive-quiet even though pure price was converging (compression 0.47–0.92, latestTrend 0.25–0.89). The user decided to drop volume: "我觉得不需要交易量这个东西,我们看裸k就可以". v5 removes `volumeRatio`/`calm`/`consecutiveQuiet`/`intensity`/`amplitudeRatio` and all their params and columns. `quoteVolume24h` survives as a liquidity floor only (`minQuoteVolume24h`), sourced from the ticker, not from K-line volume. Trade-off accepted: losing the 蓄力 signal (volume shrink often precedes a breakout) means a "long-term low-volatility, no-direction" coin can qualify, but the user explicitly prefers pure price.

### Small default boxWindow to catch short-term convergence

v4's `boxWindow` default 12 meant 12 trailing daily bars diluted the 08-01..08-04 gold convergence. v5 defaults `boxWindow` to 4 and `trendWindow` to 3 so a 3–4 day horizontal band compresses visibly. `trendWindow` is 3, not 2, because a 2-bar latest window is twitchy: one wider bar in the trailing pair flips the verdict even when the convergence is obvious (ONUSDT 4H @08-05 16:00 → latestTrend 1.16 with tr=2, 0.52 with tr=3). 3 bars average out the single-bar blip while still rejecting a genuinely flattened/widening coin (≈ 1.0+). Trade-off: on 5m/1H a `boxWindow` of 4 only requires "the last 4 bars are narrower than the 4 before", which is more sensitive and more short-sighted; the user can raise `boxWindow`.

### `compression` is a hard gate + a display column

Qualification requires `compression <= maxCompression`, and the panel shows the raw 压缩比 on every row so the user can calibrate the threshold by eye after each scan (even for rejected coins). This is a strictness knob — more gates mean fewer results, which matches the user's "宁少勿滥" stance.

### Latest-trend: the "still narrowing" gate

v3's `compression` asks "quieter than before", which lets a coin that flattened out (latest ≈ middle) or has always been quiet slip through with `compression < 1`. `latestTrend = meanAmp(latest trendWindow) / meanAmp(middle trendWindow)` adds the "现在的波动是不是还在变小" criterion: the trailing `trendWindow` bars must be meaningfully narrower than the `trendWindow` bars right before them. The ratio is scale-free (instrument's own amplitude in both windows), one `maxLatestTrend` threshold works for any timeframe/volatility level, and the middle window is adjacent to latest so older noise does not dilute the comparison.

### `latestTrend` is a hard gate + a display column

Qualification requires `latestTrend <= maxLatestTrend`, and the panel shows the raw 收窄趋势 on every row (even for rejected coins) so the user can calibrate the threshold by eye. The tradeoff is accepted: a uniformly quiet small box has `latestTrend ≈ 1` and is rejected by the default 0.9 — the user explicitly wants "越来越小" tension, and the threshold is adjustable.

### Optional params are echoed

The route resolves an absent/empty/NaN `boxWindow`/`maxCompression`/`maxLatestTrend`/`trendWindow` to its default via `parseOptionalNumber` (never `parseScanParam`, whose `Number(null) === 0` defect would turn an absent param into a `400`). The service passes the resolved values through and `response.params` echoes the effective values, so old clients that omit them still see the values actually used.

### JSON serialization of the flat-window boundary

`compression` and `latestTrend` could each be `Infinity` when their denominator window is all-flat and the numerator window is not, and `JSON.stringify` maps `Infinity` → `null`. The domain uses the existing `LARGE_RATIO` sentinel (1e9) instead, so both fields are always finite numbers on the wire and the UI renders each as `—` (dash) rather than a blank cell.

### Sorting by pure-price score

The old `intensity` rank (a mean of volume-ratio and amplitude-ratio) is gone. `score = compression + latestTrend` — both mean-amplitude ratios, same unit, additive — is the pure-price rank: lower score = converging harder. Rows sort by `score` ascending; in the UI qualified rows float to the top, then `score` ascending.
