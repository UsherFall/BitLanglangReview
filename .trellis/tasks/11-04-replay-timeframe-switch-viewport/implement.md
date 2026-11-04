# Implement：切周期首锚等新数据 + 焦点单不跨周期

前置：`design.md` 已定稿；改动集中在 `src/ui/App.tsx`（FreeReplayChart + switchFreeReplayTimeframe）与 `tests/app-free-replay.test.tsx`。

## 步骤

1. [x] **Fix B（先改行为，测试随之红）**：`switchFreeReplayTimeframe`（App.tsx ~L676）加 `setOrderFocus(null)`。
2. [x] **Fix A**：
   - FreeReplayChart 新增 `renderedRangeKeyRef = useRef('')`；
   - `publishActive`（App.tsx ~L2302）在 `render: true` 分支同步 `renderedRangeKeyRef.current = rangeKeyRef.current`；
   - 渲染 effect 首锚守卫（App.tsx ~L1866）加 `&& renderedRangeKeyRef.current === rangeKey`，注释说明"旧周期/旧会话数据不消费首锚"。
3. [x] **改写既有测试** `keeps the order anchor across timeframe switches` → `clears order focus and anchors to cursor on timeframe switch`：
   - 点单子行 → 锚开仓点（保留原断言）；
   - 切 15m → 断言：`setVisibleLogicalRange`（或 timeToIndex 路径）锚到**光标**右缘、单子行不再 `active`、`hideAfterFocus` 复位；
   - 再点同一行 → 重新锚开仓点（对应 10/29 现场用例，`re-anchors when clicking an order row again after a timeframe switch` 应继续通过）。
4. [x] **新增回归测试（AC2，锚定时机）**：无焦点切周期，且让旧周期数据明显"更多根"（回看翻页 mock）→ 断言首锚发生在**新周期数据落地之后**（例如：旧数据帧 `setVisibleLogicalRange` 不被调用，数据落地帧带新周期光标索引被调用一次）。
5. [x] 全量验证（见下）。
6. [x] 检查 `tests/free-replay-panel.test.tsx` 等是否受 focusRequest 行为影响（预期无关，跑通即可）。

## 验证命令

```bash
npx vitest run tests/app-free-replay.test.tsx tests/free-replay-panel.test.tsx tests/paper-round-review-editor.test.tsx
npx vitest run   # 全量；level-alert-parity 既有失败（缺 pool 数据目录）除外
```

人工冒烟（dev server）：

- 开仓 → 点单子行（剪刀开）→ 切 15m：视口回右缘、剪刀关、行高亮灭；再点行 → 回开仓点。
- 无焦点 + 大量回看后切周期：视口落右缘，无空白屏。

## 回滚点

- 单 commit 交付，出问题 revert 该 commit 即可。

## 实施记录（11/04）

- 单元/应用层改动与上面步骤一致；额外补了一处数据身份标记（超出 design 的最小改动，为守住 AC2 的语义）：
  - `cursorCandlesRangeKeyRef`：`cursorCandlesRef` 每次写入都盖当前 rangeKey（初始加载 = fetchRangeKey；`installIntoDataset('cursor')` = 当前 rangeKey；进入焦点的备份 = 当前 rangeKey）。
  - 退出焦点 effect 的发布条件从 `cursorCandles[0].timeframe === timeframe` 收紧为 `cursorCandlesRangeKeyRef.current === rangeKey`：同周期不同会话的旧游标数据集不能在新 rangeKey 下发布（否则它会把 `renderedRangeKeyRef` 盖成新 key，首锚又落到旧数据上，AC2 在会话切换路径上退化）。
- 子代理派发在本机不可用（`spawn pi ENOENT`，Windows 上 PATH 只有 `pi.cmd`/`pi.ps1` 无扩展名可执行），本任务按内联流程实施 + 内联质量检查。
- 验证：`npx tsc --noEmit` 干净；`npx vitest run` 75 个文件里仅 `tests/level-alert-parity.test.ts` 失败（既有缺 pool 数据目录，与本任务无关），684 用例全通过。

