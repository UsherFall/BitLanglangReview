# 技术设计

## 现状与问题

### 数据流（现状）

- `App` 持有 `paperTrading`（PaperTradingSession）、`freeReplay`（会话）、`freeReplayCandles`（图表已加载蜡烛）、`orderFocus`（焦点单 `{id, timeMs, token}`）。
- `paperMarkers = paperTradeMarkers(paperTrading.trades, timeframe, freeReplayCandles).filter(marker.time <= cursorTime)` —— `paperTradeMarkers`（free-replay-paper-trading.ts）忽略 candles 参数，用 `freeReplayCursorTimeForProgress(完成时刻, timeframe)`（shanghai grid 取整）把完成时刻反推成蜡烛，产出内置 `SeriesMarker`（黄/蓝箭头 + 文字）。
- `FreeReplayChart` 持有 `markersVisible`，`markersRef.setMarkers(markersVisible ? paperMarkers : [])`。

### 错位根因（R2）

`freeReplayCursorTimeForProgress(T, tf)` = `floor(floor(T, tf) - 1, tf)`，语义是「T 时刻刚完成的 tf 蜡烛」。当成交发生在**别的周期**（用户中途切 15m/5m 做单，T 落在 tf 网格外）时，`floor(T)` 是包含 T 的蜡烛，再 -1 步就跨过了整个包含蜡烛 → 标记左移一根粗蜡烛。正确锚点是**包含成交瞬间（T-1ms）的蜡烛**，与成交蜡烛的周期无关：

- 同周期成交（T 在 tf 网格上）：包含 T-1ms 的蜡烛 = T-step = 光标蜡烛 ✓（与现有行为一致）。
- 细周期成交（T 在 tf 网格外）：包含 T-1ms 的蜡烛 = floor(T) 本身 ✓（修复点）。
- 粗周期成交切细周期看：T-1ms 在细网格上 floor → 粗蜡烛收盘前最后一根细蜡烛 ✓。

## 新数据流

### 点集计算（src/ui/free-replay-paper-trading.ts）

把 `paperTradeMarkers` 重写为「paper 成交 → MarkerPoint[]」，与 `src/ui/trade-markers.ts` 的 `tradeChartPoints` 同构但独立实现（paper 数据模型与 ReviewedTrade 不同，不强行复用）：

```ts
export function paperTradeChartPoints(
  trades: PaperTrade[],        // 已按 positionId 分组的成交
  activeCursorTime: number,   // 揭示上限：只画已完成（<= cursor）的
  timeframe: ReviewTimeframe,
  candles: Candlestick[],    // 已加载蜡烛（用于锚定，不齐则丢弃）
): MarkerPoint[]
```

- 每笔成交产出两个点：开（positionOpenTime、positionOpenPrice、positionId 分组只产一次）与平（exitTime、exitPrice）。
- `time = Math.floor(containingCandleTimestamp(eventTimeMs - 1, timeframe, candles) / 1000)`；`null` → 丢弃（交割单复盘 `snapToLoadedCandle` 同规则）。注意：开点也要 `- 1`——完成时刻的归属瞬间是收线前一刻。
- 方向：`direction: trade.direction === 'long' ? '多' : '空'`（MarkerPoint.direction 用领域类型 Direction；paper 的 long/short 是英文，做映射）。
- `kind: 'open' | 'close'`；`muted: false`（paper 没有他单概念；焦点过滤由上层做）；`detail: null`（tooltip 走 paper 专用映射）。
- `key: \`${trade.id}#${kind}\``。
- 过滤未来：点集只在 `eventTime <= cursorTime`（完成时刻对应的蜡烛已揭示）时产出——沿用现有「`marker.time <= cursorTime`」的语义改为按蜡烛时间 `point.time <= cursorTime` 判断（光标就是蜡烛时间，已揭示蜡烛的 time 必然 <= cursor）。

### 焦点过滤（R1）

`App` 计算：

```ts
const paperMarkerPoints = paperTradeChartPoints(paperTrading.trades, freeReplay?.cursorTime, timeframe, freeReplayCandles);
const focusPaperMarkerPoints = orderFocus ? paperMarkerPoints.filter(p => p.tradeId === orderFocus.id) : [];
```

传给 `FreeReplayChart`：`paperPoints`（全部）与 `focusPoints`（焦点单，可为 null）。眼睛按钮切换：`markersVisible ? 全部 : focusPaperMarkerPoints`。焦点单 = 一行已平仓成交 → 它的开点（该回合首次开仓）+ 它的平点。orderFocus 在步进/开平仓提交/点持仓行时已清除，清除后点眼睛 = 无标记。

### 渲染层（FreeReplayChart, App.tsx）

- 删 `createSeriesMarkers`（markersRef），改 `TradeMarkerPrimitive` + `createTradeMarkerTooltip`，接线照抄 TradeChart：
  - `series.attachPrimitive(primitive)`；
  - `chart.subscribeCrosshairMove` → `primitive.findPointAt` → tooltip（paper 版 `tooltipDataFor`：价格/数量/时间/杠杆/盈亏，来源行省略——paper 成交没有 fee/source 字段）；
  - 每次 `series.setData` / 蜡烛变更后 `primitive.setPoints(points, candles)`（FreeReplayChart 的渲染 effect 里同步调用，替代原 `markersRef.setMarkers`）。
- 点集来源改为 props（paperPoints/focusPoints），`markersVisible` 仍为图表本地态。
- 传给 primitive 的蜡烛必须是**已渲染（揭示后）** 的 `visibleCandlesForFreeReplay(renderedCandles, cursorTime)` 同一份——primitive 按 `point.time` 查蜡烛画高低点锚，揭示前未来蜡烛不在点集里（时间过滤），双保险。

### 面板跟随（R4）

`FreeReplayPaperTradingPanel` 加 `key={`${session.instrument}:${session.startTime}`}`…… 现有 props 无 session 身份：面板拿到的是 paperTrading（无会话身份）。方案：App 渲染处加 `key={freeReplay.instrument + ':' + freeReplay.startTime}`，切换会话即整体重挂载，panelTab/方向/限价输入/平仓比例全部归零（单子列表本身由 props 驱动本会更新，key 解决的是本地态残留）。开始/结束会话（freeReplay null↔非 null）不经过此分支（结构上已卸载）。

### 测试改造

- `tests/app-free-replay.test.tsx`：
  - 「toggles Free Replay paper trade entry and exit markers」用例：断言从 `setMarkers` 改为 primitive 点集。测试环境无真实 canvas 布局（`layoutPoints` 的 `timeToCoordinate` 在 mock 下返回 null → `drawnPoints` 为空），断言对象应为 `primitive.setPoints` 收到的点集（trade-marker-primitive 的 `setPoints` 是普通方法，可通过 spy 断言 `findPointAt`/`currentPoints()`）。看 chartMocks 现有结构（tests 里对 lightweight-charts 的 mock 方式）决定断言通道，必要时在 mock 里暴露 attachPrimitive 捕获 primitive 实例，断言 `currentPoints()`。
  - 新增：跨周期锚定回归——15m 成交（完成时刻 23:35）在 1H 蜡烛数组下，点 time == 23:00 那根蜡烛；同周期成交 == 光标蜡烛；未加载蜡烛的成交不出点。
  - 新增：眼睛按钮过滤——有焦点只留焦点单两点；无焦点为空。
  - 新增：会话 A→B 切换，单子 tab 内容/统计跟随 B（tmp 验证测试转正）。
- `tests/free-replay-paper-trading.test.ts`（若存在；否则在既有 paper trading 测试文件内）：`paperTradeChartPoints` 纯函数级覆盖。

## 权衡

- **不复用 `tradeChartPoints`**：ReviewedTrade 与 PaperTrade 字段/分组规则不同（points 数组 vs positionId 去重开点），强行抽象会拉出共享但空泛的接口；同构实现 + 同一条「containingCandleTimestamp - 1ms」锚定规则即可，规则的一致性写进 spec。
- **焦点过滤在 App 层而非图表层**：orderFocus 本来就在 App，图表只吃两个点集数组，保持 FreeReplayChart 无业务身份依赖。
- **`markersVisible=false` 且无焦点 → 全隐**：用户确认的语义；避免「隐藏其他单」在没有选中对象时退化成「显示全部」的歧义。

## 兼容与回滚

- 纯前端改动（src/ui + tests），不碰服务端/存储/分页；不碰 TradeChart。
- 回滚 = revert 单个 commit；旧 `paperTradeMarkers` 函数删除（内部 API，无外部引用）。
- 存量会话无需迁移：PaperTrade 数据模型不变，标记是纯派生视图。
