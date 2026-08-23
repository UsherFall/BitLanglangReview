# 扫描收敛 v5:纯价格收敛(彻底移除交易量)— Implement

## 前置

工作区:`.trellis/tasks/08-04-coin-scan-box-end/` 是另一任务 planning,不碰。

## 实施清单(按序)

1. **domain**:`src/domain/coin-scan.ts` —
   - `computeQuietMetrics` 简化为纯价格:`compression` + `latestTrend`,移除 volume/calm/consecutiveQuiet/intensity/ratio/amplitudeRatio/averageVolume/currentVolume。
   - 签名:`(candles, { boxWindow, maxCompression, maxLatestTrend, trendWindow })`;守卫 `count < 2*boxWindow || count < 2*trendWindow`。
   - 加 `score = compression + latestTrend`;`qualified = compression<=maxCompression && latestTrend<=maxLatestTrend`。
   - `DEFAULT_BOX_WINDOW` 12→4、`DEFAULT_TREND_WINDOW` 4→2。
   - `ShrinkScanParams` 删 `ratioThreshold/consecutive/window`;`QuietMetrics`/`ScanRow` 删量字段 + 加 `score`。
2. **test**:`tests/coin-scan.test.ts` —
   - 删量相关用例(volume ratios/calm/consecutiveQuiet/intensity)。
   - 新增:compression 纯价格用例(不变)、latestTrend(不变)、score 排序、insufficient-history 守卫(2*boxWindow)。
   - 回归:5m/1H 纯价格收敛判定、LARGE_RATIO 边界、scale-free。
3. **service**:`src/server/coin-scan-service.ts` — limit `2*max(boxWindow, trendWindow)+1`;去 window/consecutive;`score` 排序升序。
4. **route**:`src/server/app-plugin.ts` — 删 `ratioThreshold/consecutive/window` 解析;保留 boxWindow/maxCompression/maxLatestTrend/trendWindow。
5. **UI**:`src/ui/CoinScanPanel.tsx` — 删 量比阈值/连续根数/均量窗口 输入;删 量比/当前量/均量/振幅比/强度分/连续平静 列;保留压缩相关。
6. **spec**:`.trellis/spec/server/coin-scan.md` — 契约更新(纯价格参数表、qualified 两门、score 排序、ScanRow 字段)。
7. **gate**:`npm test` 全绿 + `npx tsc --noEmit` 干净。

## 验证命令

- `npm test` — 每步后聚焦 `tests/coin-scan.test.ts` + `tests/coin-scan-service.test.ts`;最后全量。
- `npx tsc --noEmit` — 类型干净。
- `npm run dev` — 手动:1D/4H 扫 XAUUSDT,08-03/08-04 收敛应 qualified;调 boxWindow/压缩阈值。

## 风险文件 / 回滚点

- **`src/domain/coin-scan.ts`** — 核心语义;回滚点。门禁:纯价格不误报 5m/1H。
- **`src/server/app-plugin.ts`** — 参数解析;删 3 参数。
- **`src/server/coin-scan-service.ts`** — limit 公式 + 排序。
- **默认 boxWindow 12→4**:全局影响,验收重点;用户可调。
- **破坏性**:参数/字段/UI 删减,单客户端可接受。

## task.py start 前复查

- [ ] 工作区只含本任务改动。
- [ ] prd.md / design.md / implement.md 就位。
- [ ] implement.jsonl / check.jsonl 有真实 spec 条目。
- [ ] 用户已 review 规划。
