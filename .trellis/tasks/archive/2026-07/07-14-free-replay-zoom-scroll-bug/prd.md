# Free Replay 缩放后右侧K线错乱且键盘/Next Candle失效

## Goal

修复 Free Replay 模式下用户缩放图表后出现的两个互相关联的问题：最右侧 K 线渲染异常，以及右方向键 / Next Candle 按钮无法让光标前进。

## 已确认事实（代码分析）

### 架构概述

- `FreeReplayChart`（`src/ui/App.tsx:601-948`）是通过 `lightweight-charts` 渲染 K 线图的组件
- 光标（cursorTime）由父组件 `App` 的 `freeReplay.cursorTime` 管理，父组件通过 `onCandlesLoaded` 回调接收子组件的 K 线数据
- `revealNextFreeReplayCandle()`（`src/ui/App.tsx:186-194`）负责光标前进
- 图表可见范围（visibleRange）仅在首次初始化时通过 `chart.timeScale().setVisibleRange()` 设置（`src/ui/App.tsx:699-705`）
- 后续光标更新时仅调用 `series.setData()`，从不调用 `setVisibleRange()`

### 根因

**问题 1：右方向键 / Next Candle 看起来不工作**

`setVisibleRange` 仅在首次初始化时执行（`src/ui/App.tsx:703`），`rangeKey` = `${instrument}:${startTime}:${timeframe}` 在缩放后不变。光标前进时数据更新但视口不跟随滚动，用户看不到视觉变化。

对比 `TradeChart`（`src/ui/App.tsx:1081-1104`）的键盘处理，它直接调用 `chart.timeScale().setVisibleRange()` 滚动视口。

**问题 2：缩放后最右侧 K 线显示错乱**

- `chartDataWithWhitespace`（`src/ui/App.tsx:1384-1411`）在右侧填充 200 个空白 bar
- 缩放后视口不跟随光标，whitespace 占满右侧大量空间，最后几根实 K 线位置异常
- `applyFreeReplayPendingCandles`（`src/ui/App.tsx:813-831`）调用 `setRenderedCandles` + `setVisibleRange`，但随后 render effect 的 `series.setData()` 可能覆盖图表内部状态

**问题 3：`shouldPrefetchFutureCandles` 严格匹配（次要风险）**

`src/ui/free-replay-chart.ts:21-26` 使用 `candle.timestamp === cursorTime * 1000` 严格相等。光标时间戳如有舍入偏差则预取不会触发。

## Requirements

- [R1] 右方向键和 Next Candle 按钮在缩放后能正常推进光标（光标 state 前进 + 图表视口跟随）
- [R2] 光标前进时，图表的缩放级别应保持（用户缩放的倍率不应被 reset）
- [R3] 光标前进后，新显示的 K 线应正确渲染在最右侧，whitespace 不应干扰实 K 线显示
- [R4] 当光标到达已加载数据末尾时，应自动预取更多未来 K 线
- [R5] Escape/左方向键/Previous Candle 现有行为不变

## 设计方案

方案：**光标跟随模式** — 光标前进时图表视口同步滚动，光标保持在距右边缘 10 根 bar 的位置。用户手动缩放/平移时不动。

具体实现：
1. 在 `FreeReplayChart` 中添加 `useEffect` 监听 `replay.cursorTime`，排除首次初始化后调用 `setVisibleRange` 滚动视口
2. 保持当前缩放跨度（`visible.to - visible.from`），仅平移视口
3. `shouldPrefetchFutureCandles` 的严格匹配改为容差匹配

## Acceptance Criteria

- [ ] Free Replay 缩放后按右方向键 → 光标前进，图表视口右移，新 K 线显示正常
- [ ] Free Replay 缩放后点 Next Candle → 同上
- [ ] 光标前进后缩放级别保持不变（视口宽度 bar 数不变）
- [ ] 多次前进后光标到达数据末尾 → 自动加载更多未来 K 线
- [ ] 缩放后最右侧 K 线渲染正常（无错位、空白异常或重叠）
- [ ] 左方向键/Previous Candle/Escape 仍正常工作
- [ ] 不缩放时 Next Candle 行为不变（当前行为是正常的，需保持）
- [ ] Trade review 模式不受影响

## Out of Scope

- Free Replay 与 Trade review 模式之间的切换逻辑
- OKX API 数据加载失败或网络问题
- 画图工具（drawing overlay）相关行为
