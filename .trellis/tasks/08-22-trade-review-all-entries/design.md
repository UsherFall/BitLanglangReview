# Design: Trade Review 全部开平仓 markers

## Scope

- 只改动 `src/ui/App.tsx` 中的 `TradeChart` 和 `src/ui/trade-markers.ts`，不新增后端路由。
- 后端 `GET /api/trades?instrument=...` 已能返回该 Instrument 的全部 Trade（未加其它筛选），直接复用。

## Data Flow

1. 用户点击图表工具栏新增的「显示全部开平仓」按钮。
2. `TradeChart` 本地状态 `showAllMarkers` 置为 `true`。
3. `TradeChart` 通过 `useEffect` 请求 `/api/trades?instrument=<当前 Instrument>`，得到该 Instrument 全部 Trade（不受侧边栏筛选影响）。
4. 图表 marker 由新的纯函数 `allTradeMarkers(trades, activeTradeId, timeframe, candles)` 生成：
   - 每个 Trade 都生成 Entry + Exit 两个 marker。
   - 当前选中的 Trade 使用现有高亮色（Entry 黄、Exit 蓝）。
   - 其它 Trade 使用弱化灰色，避免抢视觉焦点。
5. 再次点击按钮 `showAllMarkers` 置为 `false`，恢复现有单 Trade marker 行为。

## State And Refs

- `showAllMarkers`: React state，控制按钮高亮和 marker 生成。
- `showAllMarkersRef`: 供 `renderCandles` 调用点读取当前模式，避免 effect 闭包捕获旧值。
- `allTrades` / `allTradesRef`: 缓存已加载的同 Instrument 全部 Trade。
- 现有 `markersVisible` / `markersVisibleRef` 继续管理单 Trade 模式的 Eye 显隐；全部开平仓模式下 Eye 按钮不渲染，且 marker 显隐不受 `markersVisible` 影响。

## Marker Contract

`allTradeMarkers(trades, activeTradeId, timeframe, candles): SeriesMarker<UTCTimestamp>[]`

- 输入 `trades` 应已按 Instrument 过滤（或由调用方过滤）。
- 输出顺序不要求稳定；marker 本身带 `time`，lightweight-charts 按时间排列。
- 保留 `text: 开 <entryPrice>` / `平 <exitPrice>` 的现有格式。

## Compatibility

- 现有 `tradeMarkers(trade, timeframe, candles)` 签名保持不变，原测试不受影响。
- `renderCandles` 改为接收外部计算好的 `nextMarkers`，Free Replay 不共用该函数，无影响。

## Viewport Behavior

- 现有 TradeChart 的视图居中逻辑依赖 `trade.id` / `timeframe` 的 effect（`entryVisibleRange`），全部开平仓模式是独立 UI 状态。
- 切换 Trade 时仍会执行现有居中逻辑；开启/关闭全部开平仓不改变 `trade.id` / `timeframe`，因此不会触发额外跳转。
