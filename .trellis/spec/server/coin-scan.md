# Coin Scan (选币)

## 1. Scope / Trigger

The 选币 (Coin Scan) module finds instruments by pluggable scan methods. V1 ships only the **shrink** (缩量) method. It scans a parameterized universe of OKX swap instruments and ranks them by how much their volume has shrunk.

This contract covers `src/server/coin-scan-service.ts`, the `/api/scan` route in `src/server/app-plugin.ts`, the pure algorithm in `src/domain/coin-scan.ts`, and the UI in `src/ui/CoinScanPanel.tsx`.

## 2. Signatures

- Route: `GET /api/scan`
- Service: `CoinScanService.scanShrink(params: ShrinkScanParams): Promise<ScanResponse>`
- Pure algorithm: `computeShrinkMetrics(candles, { ratioThreshold, consecutive, window }): ShrinkMetrics | null`

## 3. Contracts

### Request (query params)

| Field | Type | Default | Constraint |
| --- | --- | --- | --- |
| `method` | string | — | must be `shrink`; anything else → 400 |
| `timeframe` | `ReviewTimeframe` | — | must be in `scanTimeframes` = `['5m','15m','1H','4H','1D']` → 400 otherwise |
| `topN` | number | 50 | `>= 1` |
| `ratioThreshold` | number | 0.7 | `> 0` |
| `consecutive` | number | 3 | `>= 1` |
| `window` | number | 20 | `>= 1` |

Non-numeric params fall back to the default (see `parseScanParam`). Invalid final values → 400.

### Response (`ScanResponse`)

```ts
type ScanRow = {
  instrument: string;          // BTC-USDT-SWAP
  lastPrice: number;           // from OKX ticker `last`
  change24h: number;           // percent, (last - open24h) / open24h * 100
  lastCandleTime: number;      // ms, newest completed candle open time (forming bar excluded)
  currentVolume: number;       // last completed candle volume
  averageVolume: number;       // mean of the `window` candles before it
  ratio: number;               // currentVolume / averageVolume
  intensity: number;           // mean of the last `consecutive` volume ratios
  consecutiveShrunk: number;   // trailing count of ratios below ratioThreshold
  qualified: boolean;          // consecutiveShrunk >= consecutive
};
type ScanResponse = {
  scanned: ScanRow[];          // sorted by intensity ascending (most shrunk first)
  qualifiedCount: number;
  params: ShrinkScanParams;
  scannedAt: string;           // ISO
};
```

Instruments whose candles are too few (`< window + consecutive`) or have a zero window average are skipped and do not appear in `scanned`.

## 4. Validation & Error Matrix

| Condition | Error |
| --- | --- |
| non-GET method | 405 |
| `method` != `shrink` | 400 `Unsupported scan method` |
| `timeframe` not in `scanTimeframes` | 400 |
| `topN < 1` / `consecutive < 1` / `window < 1` / `ratioThreshold <= 0` | 400 `Invalid scan parameters` |
| OKX tickers or candlestick fetch fails | 502 with readable message |

## 5. Good/Base/Bad Cases

- **Good**: BTC volume ratio 0.2 for 3 consecutive bars, window avg 250 → `ratio 0.2`, `intensity 0.2`, `qualified true`.
- **Base**: 2 of 3 trailing ratios below threshold → `qualified false`, `intensity` still reported.
- **Bad**: fewer than `window + consecutive` completed candles → metrics `null`, instrument skipped.

## 6. Tests Required

- `tests/coin-scan.test.ts` — pure algorithm: ratio/average (sliding window), qualified/not, insufficient history → null, input order independence, zero-average → null.
- `tests/coin-scan-service.test.ts` — USDT-SWAP filter + Top-N order, forming bar dropped (`limit = window + consecutive + 1`, newest bar excluded), `lastCandleTime` = newest completed bar, `change24h` from last/open24h, insufficient candles skipped, intensity ascending sort.
- `tests/chart-time.test.ts` — `formatReviewInputTime` round-trips through `freeReplayProgressTimeForStart`.

## 7. Wrong vs Correct

#### Wrong

The scan keeps the still-forming bar; a partial candle with tiny volume qualifies the coin on noise, and the replay starts inside a bar that is still printing.

#### Correct

`candleSource.getCandlesticks` is called with `limit = window + consecutive + 1`, then `candles.slice(0, -1)` drops the newest (forming) bar before `computeShrinkMetrics`. The replay start time is the newest completed candle (`lastCandleTime`), so the Free Replay cursor sits on a finished bar.

## Design Decisions

### Extensible method dispatch

The route reads `method` and the UI exposes a method selector. Adding a new find-coin method = new branch in `CoinScanService`, a new `ScanResponse` variant, and a new case in `CoinScanPanel`. V1 deliberately ships only `shrink` to keep the extensibility seam without speculative UI.

### Volume ratio vs raw volume

`ratio` is normalized against each candle's own sliding window so instruments with very different absolute volumes are comparable in one ranking.
