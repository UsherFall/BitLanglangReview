# Journal - UsherFall (Part 1)

> AI development session journal
> Started: 2026-07-13

---



## Session 1: Finish flexible review sidebar

**Date**: 2026-07-13
**Task**: Finish flexible review sidebar
**Branch**: `master`

### Summary

Implemented resizable/collapsible review sidebar and collapsible filter section with localStorage persistence. Verified with npm test and npx tsc --noEmit.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `218f418` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 2: Free Replay no-future progress model

**Date**: 2026-07-28
**Task**: Free Replay no-future progress model
**Branch**: `master`

### Summary

Implemented exact Free Replay progressTime with no-future display cursor across timeframe switches, updated paper trading event timing, tests, specs, and archived the Trellis task.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `89a831f` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 3: Chart scale reset and timeframe zoom

**Date**: 2026-07-29
**Task**: Chart scale reset and timeframe zoom
**Branch**: `master`

### Summary

Implemented chart price scale reset/log toggle and logical-range timeframe switching for Trade Review and Free Replay.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `6843999` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 4: Free Replay chart trading tools

**Date**: 2026-07-29
**Task**: Free Replay chart trading tools
**Branch**: `master`

### Summary

Added Free Replay hover percentage readout, marker visibility toggles, and paper-trading stop loss with tests and frontend spec updates.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `ef6c377` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 5: Fix free replay timeframe chart fill

**Date**: 2026-08-03
**Task**: Free replay timeframe chart fill
**Branch**: `master`

### Summary

When a reviewer zooms the Free Replay chart out and switches timeframe, the preserved wide viewport was partly blank because the fixed initial history load could not cover it and autoload was suppressed during initialization. Added a switch-scoped backfill that reloads earlier candlesticks through the existing `/api/candles` mode=earlier path until the preserved visible bar count is covered, without revealing future candles and without moving the cursor.

### Main Changes

- `src/ui/free-replay-chart.ts`: added `shouldBackfillFreeReplayHistory()` pure helper (visible-through-cursor count vs preserved visible bars minus right padding).
- `src/ui/App.tsx` (FreeReplayChart): capture preserved visible bar count on timeframe switch; after destination data loads, evaluate the backfill decision and call `loadEarlierFreeReplayCandles()` under a uniqueness key until history covers the viewport or the API returns no new candles. Render earlier candles immediately; rely on lightweight-charts native rightOffset preservation instead of restoring an old visible time range (recorded as a design deviation).
- `src/ui/App.tsx` (TradeChart): earlier-load now renders immediately under `suppressAutoLoadRef`; earlier-load decision uses `barsInLogicalRange` via `shouldLoadEarlierByLogicalRange`.
- Bundled UI fixes: segment draft preview follows the pointer before the second click (`draftEndPoint`); Free Replay start-time picker closes on Enter instead of every edit.
- Spec: frontend component-guidelines records the backfill rule and required regression tests.

### Git Commits

| Hash | Message |
|------|---------|
| `b345e90` | feat: backfill Free Replay history after timeframe switch |

### Testing

- [OK] `npm test` full suite: 25 files, 108 tests passed.
- [OK] `npx tsc --noEmit` passed.
- [OK] trellis-check reviewed diff vs PRD/design/spec; all 5 acceptance criteria satisfied; no defects found.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 5: Free Replay session history + progress restore, sidebar collapse

**Date**: 2026-08-04
**Task**: Free Replay session history + progress restore, sidebar collapse
**Branch**: `master`

### Summary

Add Free Replay session history with progress restore: server store + /api/free-replay/sessions routes, auto-save with debounce+pagehide flush, restore/resume-by-key, delete-active guard, history list UI, explicit sidebar collapse button. Updated CONTEXT.md and specs. 115 tests green.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `9271072` | (see git log) |
| `e333232` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete

**Date**: 2026-08-04
**Task**: 选币模块(缩量方法 V1)
**Branch**: `master`

### Summary

New 选币 (Coin Scan) module as a third review mode alongside Trade Review and Free Replay. V1 ships only the shrink (缩量) method: `GET /api/scan` runs `CoinScanService` — one OKX tickers call filters USDT-settled swaps and takes top-N by 24h quote volume, then serial fetches recent candlesticks through the existing cache and computes sliding volume ratios (`computeShrinkMetrics` in domain). UI is a parameterized panel (timeframe/topN/ratioThreshold/consecutive/window, defaults 5m/50/0.7/3/20) with a ranked results table; qualified rows highlight first; clicking a row opens Free Replay from the newest completed candlestick. All new-module UI is Chinese; site-wide existing-English translation deferred to a separate task. Specs: new `server/coin-scan.md` + CONTEXT.md terms. 126 tests green.

### Main Changes

- `src/domain/coin-scan.ts` — types + `computeShrinkMetrics` (forming bar excluded by caller).
- `src/server/coin-scan-service.ts` — OKX tickers → Top-N → serial candle fetch → ranked rows.
- `src/server/app-plugin.ts` — `/api/scan` route (400/405/502 matrix).
- `src/ui/CoinScanPanel.tsx` — params panel + results table (Chinese).
- `src/ui/App.tsx` — `'scan'` mode, tab, `openScanReplay` click-through.
- `src/ui/chart-time.ts` — `formatReviewInputTime` round-trip helper.
- Specs: `server/coin-scan.md` (code-spec, 7 sections), api-plugin/market-data/index updated, CONTEXT.md terms.

### Git Commits

| Hash | Message |
|------|---------|
| (see git log) | feat: add 选币 module with shrink volume scan |

### Testing

- [OK] `npm test` — 28 files / 126 tests green (new coin-scan, coin-scan-service, chart-time round-trip).
- [OK] `tsc --noEmit` clean.
- [OK] Playwright manual: 选币 tab → scan (50 coins / 15 qualified / 5m) → ranked table → click DOGE → Free Replay at 11:40 (newest completed 5m bar), candles loaded, session auto-saved.

### Status

[OK] **Completed**

### Next Steps

- Separate task: translate existing English UI (Trade Review / Free Replay) to Chinese.
- Future coin scan methods (放量/突破) plug into the existing method dispatch.

**Date**: 2026-08-04
**Task**: 选币模块优化-复制币名与流动性筛选
**Branch**: `master`

### Summary

Reworked 选币 result interactions per user feedback. Removed row-click → Free Replay jump (it polluted Free Replay session history); each row now has a copy button that copies the lowercase short name (BTC-USDT-SWAP → btc) with a 已复制 confirmation. Added a liquidity floor: new `minQuoteVolume24h` param (default 10M USDT) filters the universe before Top-N selection, plus a 成交额 column. While verifying, discovered OKX ticker `volCcy24h` is base-coin volume (not USDT) — confirmed via XLM ratio 100 = contract multiplier — so 24h USDT turnover is now computed as `volCcy24h * last` for both ranking and the floor. Cleaned up now-unused openScanReplay / formatReviewInputTime / lastCandleTime. 126 tests green.

### Main Changes

- `src/domain/coin-scan.ts` — add `minQuoteVolume24h`; add `quoteVolume24h`; remove `lastCandleTime`.
- `src/server/coin-scan-service.ts` — USDT turnover = volCcy24h * last; floor filter before Top-N.
- `src/server/app-plugin.ts` — parse `minQuoteVolume24h` (default 10M).
- `src/ui/CoinScanPanel.tsx` — 最低成交额 input, 成交额 column, copy button (lowercase short + feedback); no row onClick.
- `src/ui/App.tsx` — remove openScanReplay + unused imports.
- `src/ui/chart-time.ts` — remove formatReviewInputTime.
- Specs: `server/coin-scan.md` + `server/market-data.md` (USDT turnover semantics).

### Git Commits

| Hash | Message |
|------|---------|
| (see git log) | feat: coin scan copy button and liquidity floor |

### Testing

- [OK] `npm test` — 126 tests green.
- [OK] `tsc --noEmit` clean.
- [OK] Playwright: scan 50/9 qualified; USDT-ordered 成交额 column; copy → 已复制; row click stays on 选币 (no Free Replay session).

### Status

[OK] **Completed**

### Next Steps

- None

**Date**: 2026-08-04
**Task**: 选币模块-缩量盘整规则优化
**Branch**: `master`

### Summary

Upgraded the 选币 shrink method from volume-only to quiet-consolidation (缩量盘整): a candlestick is now calm only when BOTH its volume ratio (vs its own `window` mean) and its amplitude ratio ((high-low)/low vs its own `window` mean) fall below their thresholds. Qualified = trailing `consecutive` bars all calm. New `volatilityThreshold` param (default 0.7); `intensity` is now the quiet score = mean over last `consecutive` bars of (volumeRatio + amplitudeRatio)/2, ranked ascending (most-quiet first). Results table gained 振幅比 column; 连续缩量 renamed 连续平静. Handled zero-amplitude baseline edge (flat bars stay calm; a moving bar on a flat baseline is not calm). 126 tests green.

### Main Changes

- `src/domain/coin-scan.ts` — `computeQuietMetrics` replacing `computeShrinkMetrics`; params add `volatilityThreshold`; `ScanRow` swaps `consecutiveShrunk` for `amplitudeRatio` + `consecutiveQuiet`.
- `src/server/coin-scan-service.ts` — calls `computeQuietMetrics`.
- `src/server/app-plugin.ts` — parses `volatilityThreshold` (default 0.7).
- `src/ui/CoinScanPanel.tsx` — 波动阈值 input, 振幅比 column, 连续平静 header.
- Spec: `server/coin-scan.md` contract + cases updated.

### Git Commits

| Hash | Message |
|------|---------|
| (see git log) | feat: coin scan quiet-consolidation rule (volume + volatility) |

### Testing

- [OK] `npm test` — 126 tests green (algorithm 6 cases, service 5 cases).
- [OK] `tsc --noEmit` clean.
- [OK] Playwright: 波动阈值 param; scan 50 / qualified 3 (vs 8 volume-only, stricter as expected); SKHYNIX 量比0.40/振幅比0.41/强度分0.40/连续平静3; ranked ascending by quiet intensity.

### Status

[OK] **Completed**

### Next Steps

- None


## Session 6: 选币价格警报 + Server酱通知 + spec 更新

**Date**: 2026-08-05
**Task**: 选币价格警报 + Server酱通知 + spec 更新
**Branch**: `master`

### Summary

watchlist-notify 完成:PriceAlert 域模型、okx-tickers 提取共享、AlertStore、ServerChanNotifier、AlertMonitor(60s 防抖)、/api/alerts CRUD+reactivate、SERVERCHAN_KEY via .env、CoinScanPanel 警报区。check 修了 reactivate 路由前缀 bug(connect strip prefix)。spec 补 price-alert/alert-store/shared tickers。.env gitignore。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `e41315a` | (see git log) |
| `b9df17d` | (see git log) |
| `9c8e00b` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
