# Free Replay 图表启动定位与周期切换标记 Bug

## Goal

修复并验证 Free Replay 模块里的两个图表问题：

1. 点击 `Start Free Replay` 后，初始 viewport 必须直接显示当前回放光标附近的最新可见 K 线，不能停在离右侧当前 K 线很远的位置。
2. Free Replay 运行中切换 timeframe 后，新周期 K 线加载与右侧回放边界必须以切换前的回放进度为锚点；纸上交易的开仓/平仓标记只用于 marker 映射，不能决定新周期加载窗口或最右 K 线时间。

## Background

Free Replay 是独立于 Trade Review 的回放模式。用户选择 instrument 和 start time 后，页面加载历史 K 线并只展示不晚于 `freeReplay.cursorTime` 的 candles。用户可以通过 `Next candle` 或右方向键推进光标，也可以在回放中切换周期。切换周期应保持“当前回放已经走到哪里”这个语义，而不是回到开仓/起点附近重新决定新周期窗口。

本任务只处理 Free Replay 的 chart viewport 与纸上交易成交标记，不扩展纸上交易规则、不改 OKX 数据加载策略、不调整 Trade Review 图表行为。

## Confirmed Facts

- `FreeReplayChart` 在 [src/ui/App.tsx](E:/vibe/BitLanglangReview/src/ui/App.tsx:601) 中实现，使用 `lightweight-charts` 渲染 Free Replay K 线。
- Free Replay 的初始 K 线请求在 [src/ui/App.tsx](E:/vibe/BitLanglangReview/src/ui/App.tsx:678) 发起，依赖 `instrument`、`replay.startTime`、`timeframe`。
- `/api/candles` 的 `mode=initial` 在服务端围绕请求里的 `entryTime` 拉取前后各 150 根 K 线；见 [src/server/app-plugin.ts](E:/vibe/BitLanglangReview/src/server/app-plugin.ts:118)。因此 Free Replay 切周期若继续传 `replay.startTime`，新周期数据窗口会围绕回放起点，而不是切换前的当前回放进度。
- 图表数据渲染会调用 `visibleCandlesForFreeReplay(renderedCandles, replay.cursorTime)`，只显示当前光标之前的 K 线；同一 effect 里会调用 `series.setData(...)` 和 `markersRef.current?.setMarkers(paperMarkers)`，见 [src/ui/App.tsx](E:/vibe/BitLanglangReview/src/ui/App.tsx:694)。
- 当前初始可见范围用 `entryVisibleRange(replay.startTime, timeframe)` 作为左侧，并用 `replay.cursorTime + 10 bars` 作为右侧；只在 `initializedRangeKeyRef` 首次匹配某个 `instrument:startTime:timeframe` 时调用 `setVisibleRange`，见 [src/ui/App.tsx](E:/vibe/BitLanglangReview/src/ui/App.tsx:695) 和 [src/ui/App.tsx](E:/vibe/BitLanglangReview/src/ui/App.tsx:699)。
- Free Replay 已有“光标推进后保持缩放并移动 viewport”的 effect，依赖 `replay.cursorTime`，见 [src/ui/App.tsx](E:/vibe/BitLanglangReview/src/ui/App.tsx:718)。已有测试 `scrolls the Free Replay viewport without changing zoom when advancing the cursor` 覆盖推进时行为，见 [tests/app-free-replay.test.tsx](E:/vibe/BitLanglangReview/tests/app-free-replay.test.tsx:104)。
- 切换 Free Replay timeframe 时，`switchFreeReplayTimeframe` 会更新全局 `timeframe`，并用 `freeReplayCursorTimeForStart` 与 `freeReplayCursorTimeForTimeframeSwitch` 重算 `startCursorTime` 和 `cursorTime`，见 [src/ui/App.tsx](E:/vibe/BitLanglangReview/src/ui/App.tsx:202)。
- 纸上交易成交标记由 `paperTradeMarkers(paperTrading.trades, timeframe, freeReplayCandles)` 生成，并过滤到 `marker.time <= freeReplay.cursorTime`，见 [src/ui/App.tsx](E:/vibe/BitLanglangReview/src/ui/App.tsx:277)。
- `paperTradeMarkers` 通过 `markerTimeForEvent(..., timeframe, candles)` 把 entry/exit 时间映射到当前周期包含该时间的 K 线，见 [src/ui/free-replay-paper-trading.ts](E:/vibe/BitLanglangReview/src/ui/free-replay-paper-trading.ts:165)；`chart-time` 已有“切换周期时光标落到包含 K 线”的单元测试，见 [tests/chart-time.test.ts](E:/vibe/BitLanglangReview/tests/chart-time.test.ts:64)。
- 测试栈是 Vitest，`package.json` 提供 `npm test`，见 [package.json](E:/vibe/BitLanglangReview/package.json:7)。

## Requirements

### R1: Start Free Replay 初始 viewport 定位正确

点击 `Start Free Replay` 后，初始 `setVisibleRange` 必须让当前 `replay.cursorTime` 附近的最新可见 K 线处于可视范围内，右侧保留合理空白用于后续推进。

- 初始定位不能因为加载了大量历史 K 线而停在远离当前光标的位置。
- 初始定位应复用 Free Replay 当前的 timeframe step 与 cursor 语义，避免和后续 cursor-follow 逻辑产生两套不一致的范围计算。
- 已有推进时保持 zoom 的行为必须保留。

### R2: Free Replay 切换周期以当前回放进度为加载与右边界锚点

在 Free Replay 运行中切换 timeframe 时，新周期 K 线加载窗口和图表最右侧已回放 K 线必须以切换前的当前回放进度 `freeReplay.cursorTime` 为准。

- “切换前的最右边 K 线”定义为当前回放进度对应的真实 K 线，即 `freeReplay.cursorTime`，不是用户当前 viewport 的右边界。
- 新周期 `cursorTime` 应落在包含旧周期 `cursorTime` 的新周期 candle 上。
- 新周期 initial candle 请求应围绕切换前 `cursorTime` 对应的时间加载，不能继续围绕 Free Replay start/open 时间加载。
- 切换后图表右侧回放边界应跟随新周期 `cursorTime + 10 bars`，而不是开仓/平仓 marker 的时间。

### R3: Free Replay 切换周期后纸上交易标记正确

在 Free Replay 中已有已完成纸上交易时，切换 timeframe 后，开仓/平仓标记必须重新映射到新周期 candle 上。

- 切换周期时保留纸上交易 session，包括已完成 trades、当前 position 和 pending orders。
- 标记时间应落在包含原始成交时间的 candle，而不是固定保留旧周期 timestamp。
- 已完成交易的 entry 和 exit 标记都必须保留，且不能重复。
- 未来标记过滤规则仍以当前 `freeReplay.cursorTime` 为准，避免显示还未回放到的成交。

### R4: 回归边界不变

- `Next candle`、右方向键、左方向键和 `Previous candle` 的现有 Free Replay 行为不应回退。
- Trade Review 图表的 marker、viewport、键盘导航行为不应受影响。
- 图表自动加载 earlier/later candles 的行为不应因为程序化 `setVisibleRange` 触发重复加载。

## Acceptance Criteria

- AC1: 新增或更新 Vitest 覆盖 `Start Free Replay` 后初始 `setVisibleRange`，断言可视范围包含 `freeReplay.cursorTime`，且右侧至少包含约 10 根当前周期 bar 的空白。
- AC2: 现有 `scrolls the Free Replay viewport without changing zoom when advancing the cursor` 测试继续通过。
- AC3: 新增或更新测试覆盖 Free Replay 从一个已推进到远离 start time 的 cursor 切换 timeframe，断言新周期 `/api/candles?mode=initial` 的加载锚点来自切换前 `cursorTime`，不是 `startTime` 或纸上交易 entry/exit 时间。
- AC4: 新增或更新测试覆盖 Free Replay 中完成一笔纸上交易后切换 timeframe，断言 `paperMarkers` 被按新 timeframe 重新设置到包含 entry/exit 原始时间的 candle 上，且 marker 数量不重复；同时断言 marker 时间不参与新周期 initial 数据加载锚点选择。
- AC5: `npm test` 通过。
- AC6: 修复后手工检查 Free Replay 启动、切周期、Next candle、Previous candle 不出现 console error。

## Out of Scope

- 不改纸上交易开仓、平仓、限价触发、PnL 计算规则。
- 不改 OKX API、candlestick cache、earlier/later 数据分页策略，除非它们被证明是当前 viewport 或 marker bug 的直接根因。
- 不改 Trade Review 模式的图表行为。
- 不新增持久化纸上交易记录。

## Open Questions

无。

## Decisions

- D1: 切换 Free Replay timeframe 时保留纸上交易 session，包括已完成 trades、当前 position 和 pending orders；只重新映射 chart marker 到新周期。理由是切周期是换尺度观察同一次回放，不是重开回放。
- D2: 切换 Free Replay timeframe 时，新周期加载与最右侧已回放 K 线锚点使用切换前 `freeReplay.cursorTime`，即当前回放进度；不使用 viewport 右边界，也不使用纸上交易 entry/exit marker 时间。理由是 `cursorTime` 是稳定、可测试的回放进度语义，viewport 可以被用户拖到历史区或空白区，marker 只表达成交事件。
