# 扫描收敛 v3:波动压缩判定 — Implement

## 前置

工作区应干净(上一任务已提交归档)。若 `git status` 有未提交改动,先确认归属;仅实现本任务改动。

## 实施清单(按序)

1. **domain**:`src/domain/coin-scan.ts` —
   - 加 `DEFAULT_MAX_COMPRESSION = 0.8`、`DEFAULT_MAX_LATEST_TREND = 0.9`、`DEFAULT_TREND_WINDOW = 4`
   - `ShrinkScanParams`/`QuietMetricsParams` 加 `maxCompression`/`maxLatestTrend`/`trendWindow`(可缺省回落默认)
   - `computeQuietMetrics` 算 `compression` 与 `latestTrend`:
     - N = boxWindow;T = trendWindow
     - `meanAmp = mean((high-low)/low)` per window
     - `compression = meanAmp(prior) > 0 ? meanAmp(recent)/meanAmp(prior) : (meanAmp(recent) > 0 ? LARGE_RATIO : 0)`(recent=尾部 N,prior=其前 N)
     - `latestTrend = meanAmp(middle) > 0 ? meanAmp(latest)/meanAmp(middle) : (latest > 0 ? LARGE_RATIO : 0)`(latest=尾部 T,middle=再前 T)
     - `qualified &&= compression <= maxCompression && latestTrend <= maxLatestTrend`
   - `QuietMetrics`/`ScanRow` 加 `compression`/`latestTrend`
   - 数据不足守卫加 `count < 2 * boxWindow`(T ≤ boxWindow 已覆盖 latestTrend)
2. **test**:`tests/coin-scan.test.ts` —
   - compression:recent 明显 < prior(0.3×)→ 过;recent ≈ prior(0.9×)→ 拒;prior 均幅 0 & recent>0 → LARGE_RATIO 拒;双 0 → 0;scale-free 0.5%/bar vs 2%/bar 一致
   - latestTrend:latest < middle(0.7×)→ 过;≈1(0.93×)→ 拒;>1(1.4×)→ 拒;middle 均幅 0 边界
   - 既有量缩/boxTightness/compression/排序/insufficient-history 用例不回归
3. **service**:`src/server/coin-scan-service.ts` — limit = `max(window+consecutive, 2*boxWindow) + 1`;透传;`response.params` 回显三参数。跑 `coin-scan-service.test.ts`。
4. **route**:`src/server/app-plugin.ts` — 可选 `maxCompression`/`maxLatestTrend`/`trendWindow` 解析(复用 parseOptionalNumber;`<= 0` → 400;`trendWindow > boxWindow` → 400);scanShrink 传回落默认。
5. **UI**:`src/ui/CoinScanPanel.tsx` — 参数区加 `maxCompression`(0.8)、`maxLatestTrend`(0.9)、`trendWindow`(4)输入(必填,恒携带,step 0.05);结果表加 压缩比/收窄趋势 列。
6. **spec**:`.trellis/spec/server/coin-scan.md` + `.trellis/spec/frontend/component-guidelines.md` — 契约更新(参数表、compression 公式/边界/哨兵、错误矩阵、Good/Base/Bad、UI 列)。
7. **gate**:`npm test` 全绿 + `npx tsc --noEmit` 干净。

## 验证命令

- `npm test` — 每步后跑聚焦 `tests/coin-scan.test.ts` + `tests/coin-scan-service.test.ts`;最后全量。
- `npm run dev` — 手动:扫出结果看 压缩比 列;对照用户反馈(BEAT/UNI 该被压掉或显示高压缩比、PUMP/BNB/GRVT 低压缩比);调 maxCompression。

## 风险文件 / 回滚点

- **`src/domain/coin-scan.ts`** — 纯函数语义改动;回滚点 = 此文件。门禁:compression 不破坏既有 qualified/排序。
- **`src/server/coin-scan-service.ts`** — limit 公式;漏改则 compression 数据不足。
- **`src/server/app-plugin.ts`** — 参数解析;optional 别复用 parseScanParam。
- **JSON**:compression 用 LARGE_RATIO 哨兵,避免 Infinity → null。

## task.py start 前复查

- [ ] 工作区干净(上一任务已归档)。
- [ ] prd.md / design.md / implement.md 就位。
- [ ] implement.jsonl / check.jsonl 有真实 spec 条目。
- [ ] 用户已 review 本规划(压缩概念已对话确认,阈值需扫描校准)。
