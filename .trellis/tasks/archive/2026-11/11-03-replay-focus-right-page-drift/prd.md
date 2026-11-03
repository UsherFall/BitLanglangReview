# 回溯复盘焦点态右缘翻页视口漂移修复

## Goal

修复回溯复盘点单（焦点态）后向右拖动图表时「图乱飘」：焦点态右缘翻页即时 `setData` 触发 lightweight-charts `shiftVisibleRangeOnNewBar`（默认 true）把视口前移整页，以及焦点窗口右缘越过 `cursorTime` 时的无限 `mode=later` 取数循环。

## 现场（2026-11-03 Fuzz 反馈）

回溯复盘 → 点「单子」里一条已完成交易行（进入焦点态，视口锚到开仓点）→ 拖动图表 → 视口乱飘。

## 根因（已实证到 LWC 源码，非猜测）

1. **视口被拽走**：焦点态右缘翻页 `loadLaterActiveCandles`（R4，10-30 引入）取回 150 根更晚 K 线后经 `installIntoDataset` → `publishActive` **立即**走到渲染 effect 的 `series.setData(新数组)`（App.tsx:1514）——数据右端追加了一整页。lightweight-charts v5.2 在 `_internal_updateTimeScale` 里的默认行为（`shiftVisibleRangeOnNewBar: true`）：数据加在右端且**旧数组最后一根在视口内**（用户正拖在右缘、fetch 落地时大概率成立）→ 不做视口补偿，视口整体前移 ~150 根。跳不跳取决于 fetch 落地瞬间拖到哪 → 表现为「乱飘」。向左翻页（prepend）不受影响：LWC 对前插天然保视口（baseIndex+rightOffset 语义）。
2. **无限取数循环**：焦点窗口右缘越过 `cursorTime`（刚平的单，开仓点距今 < 150 根）时，追加的更晚 K 线全是未揭示未来，`visibleCandlesForFreeReplay` 全部过滤 → 渲染数组永不增长 → `barsAfter` 恒 < 50 → 每个拖动帧（新 logical range）都再发一次 `mode=later`，无界取数 + 状态栏闪烁 + 右缘一堵墙。
3. **对照**：交割单复盘 `TradeChart.loadMore('later')` 用延迟渲染（250ms 空闲）+ `captureNavigationAnchor` → setData → `setVisibleRange` 恢复视口，`'earlier'` 内联同款恢复；`FreeReplayChart` 的 R4 翻页两样都没有。

## Requirements

### R1 焦点态右缘翻页不再移动视口

`FreeReplayChart` 关闭 LWC 的 shift-on-new-bar（`timeScale.shiftVisibleRangeOnNewBar: false`），让一切右端追加走 LWC 的视口补偿分支（视口时间范围保持不变）。

约束：**揭示步进的平滑跟随不得改变**。已论证：舒适区 effect（10/28 契约）在跟随方向上每步都重锚 +1 根（`cursor + pad > visible.to` 恒成立 → `setVisibleRange` +1），关掉 shift 后行为逐帧等价；zoom 由重锚传入当前 span 保持。

### R2 掐掉焦点态无限 later 取数

焦点态右缘翻页触发前检查活动数据集右缘：活动数据集最后一根已越过揭示边界（`timestamp >= cursorTime * 1000`）时不再发 `mode=later` —— 追加的蜡烛全是未揭示未来，渲染永不增长，是空转；揭示边界（未来不可见）本来就是回放的右墙。判据抽成 `free-replay-chart.ts` 纯函数，可单测。

步进游标前进后（焦点态可继续步进），若活动数据集右缘又落后于游标，翻页恢复可用。

### R3 非焦点态行为零变化

游标态的右增长只走预取（`render: false`，不 setData），左翻页走 prepend——两条路径都不受本修复影响。交割单复盘 `TradeChart`、其他币面板不动。

## Acceptance Criteria

- [x] 焦点态向右拖动：右缘翻页落地（状态闪「加载更晚 K 线」后消失）视口保持用户拖到的位置，不再前移一页；连续拖动不再出现随机跳变
- [x] 焦点窗口右缘越过 cursorTime 的会话（刚平的单）：向右拖到墙只触发**零次**（或首次越过前的一次）`mode=later` 请求，无请求风暴
- [x] 非焦点态（不点单）步进/拖动/预取行为与现状一致
- [x] 揭示步进跟随体验不变：每步视图前移 1 根、光标右侧留 10 根缓冲（10/28 舒适区契约）
- [x] 新纯函数单测覆盖：右缘 < cursor（可翻页）、右缘 == cursor（不翻页）、右缘 > cursor（不翻页）、空数据集（不翻页）
- [x] `npm test` 全绿（含现有 `free-replay-chart.test.ts`、`app-free-replay.test.tsx`）
