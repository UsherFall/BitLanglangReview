# 扫描全周期收敛(每币一行 + 收敛周期列)— Implement

## 前置

- 依赖 v5 已归档(`08-06-coin-scan-daily-gate-v5`):`computeQuietMetrics` 纯价格门、`LARGE_RATIO`、anchor、`src/ui/styles.css`。
- 工作区:`.trellis/tasks/08-04-coin-scan-box-end/` 是另一 planning 任务,不碰。

## 实施清单(按序)

1. **domain**:`src/domain/coin-scan.ts` —
   - 删 `DEFAULT_BOX_WINDOW`(plateau 扫固定 bw 集,不再有单 bw 默认)。
   - 加 `PLATEAU_BOX_WINDOWS = [3,4,5,6]`、`DEFAULT_PLATEAU_MIN = 2`、`PlateauWindow`/`PlateauResult`/`PlateauParams`。
   - `computePlateau(candles, params)`:`tr(bw) = min(trendWindow, bw-1)`;逐 bw 调 `computeQuietMetrics`;null → 该 bw 不 qualified;`plateauWidth` = 最长连续 qualified;`qualified = width >= plateauMin`;best window = qualified 中 min score。
   - `ShrinkScanParams` 删 `timeframe`/`boxWindow`,加 `plateauMin`。
   - `ScanRow` 删扁平 `compression/latestTrend/score`,加 `timeframes[]/convergenceTimeframes/qualifiedCount/bestScore`。加 `ScanTimeframeResult`。`ScanResponse` 不变结构。
2. **test(domain)**:`tests/coin-scan.test.ts` —
   - `computePlateau`:连续段计数(`[T,T,F,T]`→宽2)、非连续不合并、best 窗口取 qualified min score、`tr(bw)=min(tr,bw-1)`(bw=3→tr=2)、不足历史(bw=6 需 12 根,短 K 只小 bw 合格)、plateauMin=1 退化单窗口。
   - 现有 `computeQuietMetrics` 用例保留(v5 回归)。
3. **service**:`src/server/coin-scan-service.ts` —
   - `scanShrink` 重写:并行池(并发 ~10,`mapLimit` 风格)拉 `top × 5` 周期 K,limit `2*max(PLATEAU_BOX_WINDOWS)+1` = 13;按时间去 forming(`timestamp + timeframeMs(tf) <= anchor`)。
   - 聚合行:任一周期 qualified 才入 `scanned`;`convergenceTimeframes`/`qualifiedCount`/`bestScore`(= qualified 周期 min score);排序 `qualifiedCount` 降序 → `bestScore` 升序。
   - `qualifiedCount = scanned.length`。
4. **route**:`src/server/app-plugin.ts` — 删 `timeframe` 解析与校验、`boxWindow` 解析、`trendWindow <= boxWindow` 校验;加 `plateauMin` 解析(`>= 1` 校验);`trendWindow` 校验改 `>= 1`;调 `scanShrink` 新 params。
5. **UI**:`src/ui/CoinScanPanel.tsx` —
   - 删 `时间周期` 下拉、`压缩窗口` 输入;加 `连续收敛窗口(plateauMin)` 输入(min 1,默认 2)。
   - query 删 `timeframe`/`boxWindow`,加 `plateauMin`。
   - `CoinScanResults`:列改 `币|最新价|24h涨跌|成交额|收敛周期|状态|操作`;收敛周期 = `convergenceTimeframes.join(', ')`;「详情」按钮切展开行(每周期明细表 `周期|压缩比|收窄趋势|score|窗口|plateau宽|状态`,未合格灰显);表头 `扫描 X · 收敛 Y · 全周期`。
   - 删除重复排序(服务已排好)。
6. **样式**:`src/ui/styles.css` — `.coin-scan-detail-row` 展开行/子表样式(qualified 高亮)。
7. **spec**:`.trellis/spec/server/coin-scan.md` — 契约更新:params 表(删 timeframe/boxWindow,加 plateauMin)、ScanRow/ScanTimeframeResult、computePlateau 语义、服务聚合流程、validation 矩阵。
   `.trellis/spec/frontend/component-guidelines.md` — UI 参数/列同步。
8. **gate**:`npm test` 全绿 + `npx tsc --noEmit` 干净。

## 验证命令

- `npm test` — 每步后聚焦 `tests/coin-scan.test.ts` + `tests/coin-scan-service.test.ts`;最后全量。
- `npx tsc --noEmit` — 类型干净。
- **案例库回归(AC1)**:`tests/_tmp-case-library.test.ts` 模式重跑 C1~C5 —— C1/C2 1D 出、C3 4H 出、C4 不出、**C5 收敛周期 = 1H**(15m 拒,1H 出)。跑完删临时测试。
- `npm run dev` 手动:`/api/scan`(无 timeframe)应 200;`timeframe`/`boxWindow` 参数已移除,出现会被忽略(仍 200);扫 XAUUSDT 看收敛周期含 1D;anchor 填历史点各周期生效。

## 风险文件 / 回滚点

- **`src/domain/coin-scan.ts`** — computePlateau + 类型;核心语义;回滚点。
- **`src/server/coin-scan-service.ts`** — 并行池 + 聚合;并发上限防币安限频。
- **`src/server/app-plugin.ts`** — 参数删增;validation 矩阵。
- **`src/ui/CoinScanPanel.tsx`** — 表结构改;唯一调用方。
- **破坏性**:route/响应/UI 契约大改,单客户端可接受。
- **性能回归点**:topN×5 首次拉取耗时(目标 <15s);若超,降并发改批/升缓存。

## task.py start 前复查

- [ ] 工作区只含本任务改动。
- [ ] prd.md / design.md / implement.md 就位。
- [ ] implement.jsonl / check.jsonl 有真实 spec 条目。
- [ ] 用户已 review 规划。
