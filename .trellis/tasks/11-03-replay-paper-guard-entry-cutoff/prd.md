# 回溯复盘：模拟交易后锁回退、开仓点前视图、顶部面板重叠修复

## Goal

回溯复盘三项交互改进（2026-11-03 Fuzz 反馈）：

1. 开始模拟交易后「上一根 K 线」不可用（按钮置灰 + 快捷键堵死）。
2. 看单子（焦点单）时能一键隐藏开仓点之后的 K 线，只看开仓点及之前 —— 复盘入场决策时的「无未来」视图。
3. hover 价格差百分比面板与画线工具栏重叠（写死 `left: 252px`，工具栏已长到 ~270px）；顺带修交割单复盘 OHLC 读数条同款重叠（那边工具栏 9 个按钮 ~332px，重叠 ~90px）。

## 现场与根因

### R1 回退与模拟交易互斥缺失

`rewindFreeReplayCandle`（App.tsx）只受 `startProgressTime` 下界保护。模拟交易开始（`paperTrading.active`）后回退会把游标拉回已成交单子之前，成单时间线错乱且无任何提示。键盘 ←（`handleKeyDown` effect）走同一函数，但该 effect 的 deps 不含 `paperTrading` —— 闭包值陈旧，按钮堵了键盘也堵不住（反之亦然）。

### R2 开仓点后 K 线不可隐藏

焦点单取窗（`entryVisibleRange` ±150 根）居中锚定，开仓点右侧一半画面是「未来」。用户复盘入场决策时想把这半边藏掉。现有渲染管线只有一条揭示边界（`replay.cursorTime`），没有「临时换轨到开仓点」的机制。隐藏后若右缘翻页闸仍读游标，会出现与 11-03 修过的同款请求风暴（渲染数组永不增长 → `barsAfter` 恒 < 50 → 每个拖动帧都发 `mode=later`）。

### R3 顶部面板重叠

`.hover-price-percentage` 与 `.candlestick-readout` 都写死 `top: 10px; left: 252px`，这是「工具栏恰好 252px 宽」年代的对齐值。回溯工具栏现 7 个按钮（含磁吸 32px）≈ 270px；复盘工具栏 9 个按钮 ≈ 332px。两个面板都压在工具栏尾部按钮上（readout 在 DOM 后 → 盖住按钮；两栏同为 z-4）。

## Requirements

### R1 模拟交易开始后回退禁用

- `FreeReplayPanel`「上一根 K 线」按钮在 `paperTrading.active` 时 `disabled` + 置灰（`.replay-controls button:disabled` 样式），`title` 说明原因（开始模拟交易后不能回退）。
- 「下一根 K 线」不受影响。
- `rewindFreeReplayCandle()` 以 `paperTrading.active` 为守卫（函数级防线，防其他调用路径）。
- 键盘 ← 同步禁用：订阅 effect 的 deps 补上模拟交易态，杜绝陈旧闭包。
- 恢复已保存会话（`paperTrading.active === true`）后按钮同样置灰。
- 重置模拟交易（重置按钮回到 `initialPaperTradingSession()`）后按钮恢复可用。

### R2 焦点单「开仓点前」视图

- 焦点单存在（`focusRequest` 非空）时图表工具栏出现剪刀按钮：点击隐藏开仓点（`focusRequest.timeMs` = `positionOpenTime`）之后的所有 K 线，再点恢复。`aria-pressed` 反映状态。无焦点单时按钮不出现（不渲染，而非禁用）。
- 隐藏口径 = 揭示边界临时换轨：渲染（`visibleCandlesForFreeReplay`）与磁吸（`magnetCandles`）都按 `min(cutoff, cursorTime)` 过滤；开仓点包含 candle（`timestamp <= positionOpenTime`）保留 ——「开仓点及之前」。
- 焦点窗口右缘翻页闸（`shouldLoadLaterFocusCandles`）读同一换轨边界，杜绝隐藏态请求风暴；向左翻页（历史）不受影响。
- 开启瞬间把视口锚到开仓点：开仓点贴右缘留 10 根缓冲（`cursorAnchoredTimeRange` 同款语义），关闭时不强制移动视口。
- 换焦点单（点另一行）时隐藏态保持、cutoff 跟随新单；退出焦点（步进/开平仓/点持仓行/切会话/离开模式）时自动复位关闭。
- 开平仓标记点不做新代码：落点锚定在包含 candle 上，该 candle 被隐藏后 `timeToCoordinate` 返回 null，点自动不画（既有管线行为）。
- 焦点态跨周期切换时隐藏态存活，cutoff（positionOpenTime）语义不变（含 candle 的开档时间 ≤ positionOpenTime，任何周期下都保留）。

### R3 顶部面板重叠

- `.hover-price-percentage` 改右对齐（`right: 10px`，去掉 `left: 252px`）—— 永远躲开宽度可变的工具栏，且贴价格轴一侧语义合适。
- `.candlestick-readout` 同款改右对齐（`left: auto`，保留 `right: 10px`），随内容宽度收缩。
- 不改工具栏本身（按钮尺寸/间距维持现状）。

## Acceptance Criteria

- [x] R1：开始模拟交易后「上一根 K 线」按钮 `disabled` 且有说明性 `title`；点「下一根」仍可步进；重置模拟后按钮恢复。键盘 ← 在模拟中无效果（用例含未开模拟的正向对照）。
- [x] R2：点单子 → 剪刀按钮出现 → 点击后 `series.setData` 的蜡烛数组截止于开仓 candle（严格小于 positionOpenTime，开仓后首根不泄漏）；再点恢复完整焦点窗口。隐藏态下右缘拖动零 `mode=later` 请求；退出焦点后剪刀按钮消失且重新点单开关为关。
- [x] R2：磁吸在隐藏态只对开仓点及之前的 K 线生效（与渲染共用同一 revealBoundary 表达式，随渲染用例同口径覆盖）。
- [x] R3：两个面板类都改为右对齐定位；jsdom 无布局，实机 `npm run dev` 手查交由用户验收。
- [x] 全量 `npm test` 通过（647 用例；level-alert-parity 为本机缺 gitignored 研究数据的既有失败）；新增用例按 `tests/app-free-replay.test.tsx` 既有模式（fetch mock + chartMocks 捕获）。

## Out of Scope

- 不改焦点单取窗/整窗替换/双数据集契约（10-30）。
- 不改模拟交易执行规则（`free-replay-paper-trading.ts` 纯函数层）。
- 不动会话存取结构（焦点态与隐藏态都是 ephemeral UI 态，不进 save payload）。
