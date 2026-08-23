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


## Session 7: 扫描极致收敛规则 + ServerChan 通知修复

**Date**: 2026-08-05
**Task**: 扫描极致收敛规则 + ServerChan 通知修复
**Branch**: `master`

### Summary

v2 收敛扫描:去振幅相对门(误杀长安静币/放过新鲜旗形),加 scale-free boxTightness(boxWindow=12, maxBoxRatio=0.9),boxWindow 天然排除近期大蜡烛;UI 可调。ServerChan:官方文档确认 sctp=SC3 APP推送、SCT=微信,notify.ts resolveSendUrl 三格式支持;测试用假 key(真 key 曾误入测试,已清理)。用户验证扫描结果 OK。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `b20b7d6` | (see git log) |
| `f8e9c08` | (see git log) |
| `5cf4600` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 8: 扫描收敛 v3/v3.5 + 成型bar修复 + UI滚动修复

**Date**: 2026-08-05
**Task**: 扫描收敛 v3/v3.5 + 成型bar修复 + UI滚动修复
**Branch**: `master`

### Summary

压缩任务进行中(checkpoint)。v3 加 compression 门(最近/之前均幅比<=0.8);v3.5 加 latestTrend 门(最近4/再前4<=0.9)拦走平/放大;修成型bar误删:按时间戳过滤 timestamp+step>anchor 而非无脑 slice(扫描曾落后一根)。UI:侧栏面板滚动+警报列表滚动。待续:CRCL 合格(0.63)但用户眼判不够极致,需确认「太平还是波动大」方向(最小波动下限 vs 绝对上限)。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `33a3f7d` | (see git log) |
| `87ddb27` | (see git log) |
| `3d964a4` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 9: 扫描收敛 v3.5:移除箱体门,收敛=压缩+收窄趋势

**Date**: 2026-08-06
**Task**: 扫描收敛 v3.5:移除箱体门,收敛=压缩+收窄趋势
**Branch**: `master`

### Summary

用户反馈黄金两天前 4h/日线该扫出但没扫到。回溯实测:黄金 4H 收敛窗口(07-31~08-02)compression 0.18~0.68 达标、量缩达标,但全被 boxTightness 1.13~1.81 拒(缓坡压缩非紧箱体被误杀)。决策:目标'现在在收敛且收敛到极致'由 compression+latestTrend 承担,移除 boxTightness 箱体门(计算/参数/UI 列全删,boxWindow 保留为压缩窗口)。实现后黄金 08-01 收敛窗口 6 bar 全 QUALIFIED。黄金 1D 仍卡量缩门(quiet 不足),与 box 无关,另开任务。168 tests 全绿 + tsc 干净。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `2c21aad` | (see git log) |
| `fb292ff` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 10: 选币数据源替换为币安(黄金 XAUUSDT 必检)

**Date**: 2026-08-06
**Task**: 选币数据源替换为币安(黄金 XAUUSDT 必检)
**Branch**: `master`

### Summary

用户反馈黄金 8月4日该扫出但没扫到。根因:OKX SWAP 日线边界 UTC16:00 与用户视图(UTC0:00/北京8点)错位,同一日期标签两套 K 线。决策:选币数据源整体替换为币安 USDT-M 永续(fapi),含真黄金 XAUUSDT(qv 27.4亿);接口+两实现(TickerSource/CandleSource),MARKET_DATA_SOURCE 环境变量切换(默认币安,okx 回退);FreeReplay/TradeReview 保持 OKX 不动;警报切币安。实测:币安边界下 4H 黄金收敛(08-03 comp=0.20 quiet=13)QUALIFIED;8月4日横盘成立。端到端验证:币安 tickers 679 个含 XAUUSDT,扫描链路通。176 tests 全绿 + tsc 干净。1D 关卡(量缩差1根+压缩略超)按用户决定验收后再调。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `58bd68f` | (see git log) |
| `f79966e` | (see git log) |
| `e77c5ad` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete

## Session 11: 扫描收敛 v5:纯价格收敛 + 历史锚 + 全周期方案

**Date**: 2026-08-06
**Task**: 08-06-coin-scan-daily-gate-v5(基座已提交)+ 08-06-08-06-coin-scan-multi-timeframe(新建)
**Branch**: `master`

### Summary

彻底移除交易量维度,纯裸 K 收敛(compression + latestTrend 两门,score 排序)。用户原话「我们看裸k就可以」。默认 boxWindow 12→4、trendWindow 4→3(tr=2 太灵敏:ONUSDT 4H @08-05 16:00 单根放大 lt 1.16 卡,tr=3 变 0.52)。新增可选 anchor 参数(epoch ms),UI 加「扫描时间点」datetime-local,可扫历史点验证收敛。真数据验证:黄金 1D 08-03/08-04(锚 08-04/08-03 起始)qualified ✓(复现 prd 模拟 comp 0.578/0.798, lt 0.347/0.472);黄金 4H AC2 所有 bw 都 fail(日内噪声,待重定义)。

案例库(真数据):C1-C4 当前门全对;C5 HYPE 15m @08-03 19:00+08 箱体顶部收敛被 latestTrend 误杀(lt≈1.1,15m 走平),但切 1H 就扫出(comp 0.61~0.67/lt 0.669,plateau{3,4});C6 撤案。结论:不改 latestTrend(会放回 CRCL 类长期安静误报),改**全周期扫描**——每币在自然周期显形。新任务 `08-06-08-06-coin-scan-multi-timeframe` 建好,prd 粗稿:点扫描跑全周期、每币一行+收敛周期列、plateau≥2 连续窗口滤孤立误报。

### Main Changes

- domain: 纯价格 computeQuietMetrics,删量字段/参数,score=comp+lt,默认 bw4/tr3
- service: limit=2*max(bw,tr)+1,score 升序
- route: 删 ratioThreshold/consecutive/window,加 anchor
- UI: 删量输入/列,加「扫描时间点」输入
- spec: coin-scan.md v5 纯价格+anchor 契约;component-guidelines 同步
- research: case-library.md(6 案例,真数据可重跑)
- 新任务 prd: multi-timeframe

### Git Commits

| Hash | Message |
|------|---------|
| `097d60f` | feat(scan): pure-price convergence, drop volume gate, add historical anchor |
| `a9c50ef` | docs(spec): coin-scan v5 pure-price + anchor contract |
| `927076b` | docs(task): coin-scan case library + multi-timeframe scan prd |

### Testing

- [OK] `npm test`: 173 tests / 34 files 全绿
- [OK] `npx tsc --noEmit`: 干净

### Status

[OK] 基座 **Committed**;多周期任务 planning(prd 粗稿,待 design/implement)

## Session 12: 扫描收敛 v5 收尾 + 归档

**Date**: 2026-08-06
**Task**: 08-06-coin-scan-daily-gate-v5(归档)
**Branch**: `master`

### Summary

收尾 v5:用户决策 **AC2 接受失败,重新定义为「黄金 1D 为目标周期,4H 不保证」**。根因:黄金 4H 日内噪声 + 小 boxWindow(4) 装不下 ~48h 箱体;大 bw 下 latestTrend 走平门仍拒。4H 黄金交给全周期扫描任务。prd 补齐:R7/AC6(anchor,实现中新增)、实现偏差记录(trendWindow 4→3,tr=2 太灵敏)、AC1/3/4/5/6 打勾。复跑 `npm test` 173 绿 + tsc 干净。任务归档至 `archive/2026-08/`。

### Git Commits

| Hash | Message |
|------|---------|
| `3e2cfe1` | docs(task): finish coin-scan v5 — AC2 redefined (4H gold not guaranteed) |
| (archive auto) | chore(task): archive 08-06-coin-scan-daily-gate-v5 |

### Status

[OK] v5 **Archived**。剩余:multi-timeframe(planning,待 design/implement)、box-end(planning)。

## Session 13: multi-timeframe 全周期收敛 — 实施 + 验收

**Date**: 2026-08-06
**Task**: 08-06-08-06-coin-scan-multi-timeframe(in_progress → 待归档)
**Branch**: `master`

### Summary

单周期扫描替换为**全周期唯一模式**(用户决策):一次点扫描跑 5 周期,每币一行 + 收敛周期列。computePlateau 扫 bw∈{3,4,5,6},plateauMin(2) 连续合格窗口滤孤立误报。service 并行池(并发10)拉 topN×5,limit 13 按时间去 forming,排序 qualifiedCount 降序→bestScore 升序。route 删 timeframe/boxWindow 加 plateauMin。UI 删周期选择器/压缩窗口,加连续收敛窗口 + 展开行每周期明细。

**真数据验证(AC1)**:`_tmp-case-library.test.ts`(已删)重跑 C1~C5 全过,数值与案例库精确一致(comp 0.522/0.635/0.669)。**发现并修正设计缺陷**:`tr(bw)=min(tr, boxWindow)` 而非初稿 `bw-1` —— bw=3 用 tr=2 太灵敏(HYPE 1H lt 0.905>0.9 险挂),tr=3 退化(latest==box,compression 门承载)精确复现案例库。C4 仍正确拒(孤立 bw4)。

### Git Commits

| Hash | Message |
|------|---------|
| `e9735bf` | feat(scan): multi-timeframe convergence, one row per coin with 收敛周期 column |

### Testing

- [OK] `npm test`: 181 tests / 34 files 全绿
- [OK] `npx tsc --noEmit`: 干净
- [OK] 案例库真数据回归:C1~C5 全过(AC1)

### Status

[OK] 实施 **Committed**;待归档。剩余:box-end(planning)。

## Session 10: 收敛结构检测(三角/箱体)v1 —— 弃箱体末期,swing 结构重写

**Task**: `08-07-coin-scan-convergence-structure`(废旧建新,弃 08-04-box-end)

**决策**: 缩量扫描从"纯振幅收缩"升级为"swing 结构检测(收敛三角/低波动箱体)"。双向不锁方向。绝对振幅不做门(不同品种振幅天然不同),改相对自身。探测型窗口 = 候选 N=[2,3,4,5,6,8,10,12] 扫描选最规整结构。swing 用 fractal。结果列:结构类型/位置/强度分。UI 极简参数(minScore 主旋钮)。

**实现**: domain(coin-scan.ts 重写:detectSwings/classifyStructure/probeStructure)+ 服务层 + API(minScore)+ UI + 测试。三缺陷修复:①结构陈旧(锚定当前 bar 非最后 swing)②score 饱和(收敛度用当前 bar 宽度)③降/弹/平带误判(单调性 + 区间门)。HEI 深跌腿误判根因:判成 falling 三角后 lows 平边不查单调,补 flat 边区间门。

**实盘对照**: 修复前 14/14 全三角 score 0.9-1.0;修复后 5-7 币 score 0.5-0.9。HEI/HFT 崩后平静误判消除。MRVL/SNDK/SOXX 真三角验证通过。合成箱体 probe 识别 box 0.96。

**spec**: coin-scan.md 全重写(swing 结构契约替换 compression/plateau)。

[OK] 192 tests 全绿 + tsc 干净。spec 已更新。

## Session 10b: 收敛结构-平边判定相对自身振幅(修XRP缓跌误判)

**Task**: `08-07-coin-scan-flat-relative-amplitude`(Session 10 后续 bug)

**问题**: XRP 1H 单边缓跌被误判 falling 三角 score 0.90。swings lows=[1.0388,1.0410,1.0317,1.0292],highs 缓降。lows regression drift 0.9% < slopeTolerance 2%(相对 mean price 判平),但相对自身振幅 0.56% 是 1.6× 明显趋势。

**根因**: flat 边判定只相对 mean price(固定 2%),对低波动币太宽。缓降段 drift 占总价比例小但相对自身振幅大。

**修法(用户选方向 2)**: flat 边判定加 `drift / priorAmplitude <= maxFlatDriftRatio(1.0)`。真箱体边 drift≈0 不误伤;priorAmplitude 缺省回退旧行为。趋势边(highFalling/lowRising)保持原逻辑。

**验证**: XRP 案例回归拒;MRVL 真三角带 priorAmplitude 仍过(不误伤)。实盘重扫 XRP 消失。194 tests 全绿 + tsc 干净。spec coin-scan.md 常量表 + 算法段 + design decision 更新。

[OK] 194 tests + tsc 干净。待归档。

## Session 11: 收敛结构-回溯窗口检测(破斜率终止+容忍度)

**Task**: `08-07-coin-scan-backscan-window`(窗口机制重构)

**决策**: 窗口确定从固定"最近 8 swing"改回溯扫描 —— 从最新 K 往回扫 swing 序列,破斜率终止。swing 检测与形态边界分离(方案 B):大窗口 detectSwings 一次,backscanWindow 扫 swing 序列找连续形态段。破斜率 = 单根插针即破但分毛刺:影线穿透不算,收盘穿透趋势线 > tolerance×结构宽度才算真破。容忍度 = 收盘穿透 ≤ 20% × 结构宽度(DEFAULT_STRUCTURE_TOLERANCE=0.2)。B(最小成形跨度):三角 13 根、箱体 5 根,每周期一致(以根计)。

**实现**: domain(coin-scan.ts):SwingPoint 加 close 字段;backscanWindow 两阶段(先找 base suffix=classify 收下的最晚段,再往回扩展,候选 swing 对**当前段**边线判 close 破位,不重算回归,防 INTC 103 尖峰把回归拉向自己混入;真破/换型即终止)。classifyStructure 不再内窗,加 close 门 + B 门。probeStructure 排序 touchCount 多 > 跨度长 > N 小。旧 monotonicTolerance/isDirectionalMonotonic 全删,统一 close 门。

**校准**(本地 sqlite 真 K 缓存):INTC 15m 真数据 backscan 正确排除 103 尖峰(box 变 falling triangle,扩展在尖峰终止)。容忍度 0.2 成立:HEI 深跌腿/HFT 崩拉/~8% 破位 close 穿低边缘全拒;XRP 缓跌 drift-ratio 门拒。当前实盘快照 5 币无合格结构 = 宁少勿滥(箱体宽于自身 bar 振幅),非 bug。

**测试**: coin-scan.test.ts 45 个适配+新增(backscanWindow describe:已知三角段起点/破斜率终止/毛刺容忍/INTC 尖峰排除/B 门)。服务层接口不变零改动。

[OK] 199 tests 全绿 + tsc 干净。QC 全过。spec coin-scan.md 已更新。待 commit + 归档。


## Session 11: Session 11: 收敛结构-回溯窗口检测(破斜率终止+容忍度)

**Date**: 2026-08-09
**Task**: Session 11: 收敛结构-回溯窗口检测(破斜率终止+容忍度)
**Branch**: `master`

### Summary

窗口机制重构:固定 8-swing 改 backscanWindow 回溯扫描,破斜率终止+容忍度 0.2×结构宽度,B 门(三角13/箱体5)。INTC 103 尖峰排除、HEI 深跌腿拒、毛刺容忍。199 tests + tsc 干净,QC 全过,spec 更新,已 commit。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `11e1678` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete

---

## Session 14: 修复三角近-apex 价格容差塌陷

**Date**: 2026-08-13
**Task**: fix-triangle-price-tolerance
**Branch**: `master`

### Summary

三角「价格在结构内」门容差 `0.1×width` 在 width→0（近 apex）时塌成 ~0，把接近完全收敛的三角误判为「已走完」。加地板 `max(0.1×width, priceToleranceFloorRatio×priorAmplitude×lastPrice)`，默认 ratio=1.0（一根平均 K 的毛刺余量）。真实复现：Binance MUUSDT 15m 8/13 00:30 +08 之前 probeStructure=null（三角候选被 price-inside 门拒：width≈0.02、价 2.56 破下轨、旧容差 0.002），修复后 = 三角 0.812。8/12 07:15 15m 也从 null 变三角 0.855（该结构本就是上升三角，用户想看的 8/12 箱体属另案讨论）。202 tests 全过，新增 3 个回归测试。

### Main Changes

- `src/domain/coin-scan.ts`: StructureParams 加 `priceToleranceFloorRatio`；新常量 `DEFAULT_PRICE_TOLERANCE_FLOOR_RATIO=1.0`；三角分支容差加地板；defaultStructureParams 填默认。
- `tests/coin-scan.test.ts`: defaults 精确匹配 + 常量断言补新字段；新增近-apex floor 放行 / 真突破仍拒 / 无 prior 退回旧行为 三用例。

### Git Commits

| Hash | Message |
|------|---------|
| (见 git log) |

### Testing

- [OK] 202/202 tests (vitest)
- [OK] 真实数据验证 8/13 00:30 15m = 三角 0.812（原 null）

### Status

[OK] **Completed**

### Next Steps

- 箱体另案讨论：用户要「窄箱体/收敛到低波动」，8/12 07:15 15m 箱体受触碰不足 + 低波动门双重阻碍。

---

## Session 15: 窄箱体 → 波动率「收敛」重构

**Date**: 2026-08-13
**Task**: narrow-box-redesign
**Branch**: `master`

### Summary

把 fractal 触碰式「箱体」检测整体换成**波动率驱动的「收敛」检测**（detectConvergence，纯 bar 滑动扫描）。4 道门：自适应平边（漂移≤1.2×coinVol，跨币种缩放）、相对前段收敛（中位数，允许尖刺）、绝对安静（<0.8×coinVol，拒平尾巴）、动态范围（min/max + 当前价在内）。结构类型 box→convergence，UI「箱体」→「收敛」，删 fractal 箱体分支。probeStructure 收敛与三角按分数比大小。真实数据：8/12 07:15-09:45 = 收敛（0.97-0.99，原三角 0.855），10:30 突破后收敛消失，8/13 00:30 = 三角 0.812 保留。196/196 测试 + tsc 干净。

### Main Changes

- `src/domain/coin-scan.ts`: 新增 detectConvergence；删 box 分支/boxConvergenceData/box 参数常量；
  加收敛参数（minRun/flatRatio/convergenceRatio/lengthScale）；类型 box→convergence；
  probeStructure 收敛与三角按分数比大小。
- `src/ui/CoinScanPanel.tsx`: 「箱体」→「收敛」。
- 测试: coin-scan/coin-scan-service 更新（删 box fixture 测试，加收敛回归测试，boxBars→收敛 fixture）。

### Git Commits

| Hash | Message |
|------|---------|
| (见 git log) |

### Testing

- [OK] 196/196 tests (vitest) + tsc --noEmit
- [OK] 真实数据 8/12 07:15/08:00/09:45 = 收敛；8/13 00:30 = 三角；8/12 10:30+ 突破后消失

### Status

[OK] **Completed**

### Next Steps

- 无

---

## Session 15b: 收敛分数饱和修复 + 短带过度检测排查

**Date**: 2026-08-13
**Task**: narrow-box-redesign (follow-up)
**Branch**: `master`

### Summary

用户反馈当前扫描「好多是收敛、很多强度分是 1」。排查 top30：多数是真收敛（市场安静，ETH/XRP/SPCX 等 0.1-0.4% 窄幅），但两个真问题：
1. **分数饱和**：原 `relCalm + 0.5×absCalm + 0.1×length` 权重和 1.6，大量收敛 clamp 到 1.0 失去区分。
2. **短带过度检测**：5-8 根（75-120 分钟）短暂横盘 score≥0.7 入选且时间敏感（NBIS/MU 扫到 1.0 但 15 分钟后价格一动就消失）。

修复：分数改 `0.85×lengthNorm + 0.15×calm`（权重和=1，不饱和）。短带（长度 <16 根按比例）天然 <0.7 不入选。验证：8/12 07:15/09:45 收敛 0.88-0.93 仍压过三角 0.855，8/13 三角保留，当前扫描 0 个分数=1.0，收敛数 16→11。197/197 测试 + tsc 干净。

### Git Commits

| Hash | Message |
|------|---------|
| `c4aed63` | fix(scan): convergence score saturates to 1.0; length-weight it |

### Status

[OK] 已 commit。待办：后续跑 dev server 实际看扫描结果、评估剩余 11 个收敛是否可接受。

### Next Steps

- 跑 dev server 实际验证 UI 扫描结果
- 用户决定剩余收敛数是否可接受 / 是否再收紧
