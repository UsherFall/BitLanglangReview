# Free Replay 模拟交易设计

## Scope

在现有 Free Replay 页面中增加页面内模拟交易状态、右侧操作面板、成交标记和统计。该功能不修改 K 线加载、Free Replay cursor 隐藏未来 K 线、Trade Review 数据、SQLite schema 或正式 Trade 导入/复盘流程。

## Existing Boundaries

- `src/ui/FreeReplayPanel.tsx` 负责 Free Replay 的标的、开始时间、开始按钮和前进/后退控制。
- `src/ui/App.tsx` 持有 `freeReplay` 和 `freeReplayCandles`，并处理 reveal、rewind、timeframe switch。
- `src/ui/free-replay-chart.ts` 负责 Free Replay cursor 与 visible candles 的纯逻辑。
- `src/ui/trade-markers.ts` 提供 Trade Review 开仓/平仓 marker 风格，可作为模拟交易 marker 的格式参照。
- `src/ui/App.tsx` 内的 `FreeReplayChart` 负责加载、渲染和隐藏 Free Replay K 线。

## Proposed Architecture

### Domain Logic

新增一个 UI 侧纯逻辑模块，例如 `src/ui/free-replay-paper-trading.ts`，集中处理模拟交易状态和统计，避免把计算塞进 React 组件。

核心类型：

- `PaperTradingSession`：是否已开始、配置、待开仓单、待平仓单、当前持仓、已完成交易列表、事件序号。
- `PaperTradingSettings`：仓位比例、杠杆、方向、限价输入。
- `PaperOrder`：`kind` 为 `entry` 或 `exit`，`orderType` 为 `limit`，包含方向、限价、创建 cursor time。
- `PaperPosition`：方向、开仓价、开仓时间、保证金、名义仓位、数量、仓位比例、杠杆。
- `PaperTrade`：方向、开仓价、平仓价、开仓时间、平仓时间、保证金、数量、PnL、单笔收益率。
- `PaperStats`：已实现收益金额、总收益率、胜率、盈亏比、交易数、浮动盈亏。

核心函数：

- `startPaperTrading(session, cursorTime)`：进入模拟交易模式，不改变 Free Replay cursor。
- `resetPaperTrading()`：恢复初始 session。
- `openMarket(session, candle, settings)`：按当前 cursor K 线 `close` 开仓。
- `placeEntryLimit(session, limit, settings, cursorTime)`：创建或替换待开仓限价单。
- `closeMarket(session, candle)`：按当前 cursor K 线 `close` 平仓。
- `placeExitLimit(session, limit, cursorTime)`：创建或替换待平仓限价单。
- `cancelPendingOrder(session, kind)`：取消待开仓或待平仓限价单。
- `processRevealedCandle(session, candle)`：在 reveal 到新 K 线后检查限价单；当 `low <= limit <= high` 时按限价成交。
- `paperTradingStats(session, currentCandle)`：计算已实现统计和当前持仓浮动盈亏。
- `paperTradeMarkers(trades, position, timeframe, candles)`：输出与 Trade Review 风格一致的已成交开平仓 marker。

### React State Flow

`App` 继续持有 Free Replay 上下文，同时新增 `paperTrading` state。

- `onStart` Free Replay 时：`setFreeReplay(next)`、`setFreeReplayCandles([])`、`setPaperTrading(resetPaperTrading())`。
- 切换标的或开始时间通过现有 `onStart` 完成，所以自动重置。
- `switchFreeReplayTimeframe` 不重置模拟交易；只改变 timeframe 和 cursor 对齐，marker 会按当前 timeframe 重新对齐。
- `revealNextFreeReplayCandle`：先计算 next cursor，再用对应 K 线调用 `processRevealedCandle`，最后更新 `freeReplay.cursorTime`。
- `rewindFreeReplayCandle`：只更新 `freeReplay.cursorTime`，不修改 `paperTrading`。

为避免 state 闭包读到旧 K 线，reveal 处理应基于当前 `freeReplayCandles` 和当前 `freeReplay.cursorTime` 找到下一根 candle。如果 next cursor 等于 current cursor，则不触发订单。

### UI Layout

右侧面板建议作为 workspace 内 Free Replay 图表旁边的操作面板，使用现有应用的克制 dashboard 风格。

- 未开始：显示账户本金 `1000 USDT`、仓位比例、杠杆、开始模拟按钮。
- 已开始且无持仓：显示 Long/Short 方向选择、市价开仓按钮、限价开仓价格输入、待开仓挂单状态和取消按钮。
- 已开始且有持仓：显示方向、开仓价、数量、保证金、杠杆、浮动盈亏、市价平仓按钮、限价平仓价格输入、待平仓挂单状态和取消按钮。
- 始终显示：已实现收益金额、总收益率、胜率、盈亏比、已完成交易列表、重置模拟按钮。

仓位比例和杠杆使用快捷按钮加数字输入。输入校验在提交时 clamp 到允许范围：仓位比例 `1 - 100`，杠杆 `1 - 125`。

### Chart Markers

Free Replay 图表当前没有 marker plugin。实现时可在 `FreeReplayChart` 中像 `TradeChart` 一样创建 `markersRef`，并在 visible candles 或模拟交易变化时调用 `setMarkers`。

Marker 规则：

- 开仓颜色 `#FACC15`，文本 `开 price`。
- 平仓颜色 `#38BDF8`，文本 `平 price`。
- Long 开仓：`belowBar` + `arrowUp`。
- Long 平仓：`aboveBar` + `arrowDown`。
- Short 开仓：`aboveBar` + `arrowDown`。
- Short 平仓：`belowBar` + `arrowUp`。
- 时间按当前 timeframe 对齐到 K 线，沿用 `markerTimeForEvent` 的思路。

待触发挂单不画图表 marker 或 price line，第一版只显示在右侧面板。

## Calculations

- `margin = 1000 * positionRatio`
- `notional = margin * leverage`
- `quantity = notional / fillPrice`
- Long PnL：`(exitPrice - entryPrice) * quantity`
- Short PnL：`(entryPrice - exitPrice) * quantity`
- 单笔收益率：`pnl / margin`
- 已实现收益金额：已平仓模拟交易 PnL 合计
- 总收益率：已实现收益金额 / `1000`
- 胜率：盈利已平仓交易数 / 已平仓交易数
- 盈亏比：平均盈利 PnL / `abs(平均亏损 PnL)`；无盈利或无亏损时显示 `-`
- 浮动盈亏：用当前 cursor K 线 `close` 作为估算平仓价，按多空 PnL 公式计算，不进入已实现统计

## Compatibility

- 不新增 API。
- 不新增数据库迁移。
- 不修改正式 Trade 类型和 Trade Review 统计。
- Free Replay 模拟交易保持页面内 state，刷新后丢失。

## Risks

- `trade-markers.ts` 当前中文文字在部分 PowerShell 输出中会显示乱码；实现和测试写中文断言时需要确保文件 UTF-8 编码，避免 Windows 写入 mojibake。
- reveal 触发限价单时要确保只处理新 reveal 的那根 K 线，不能在开始模拟时扫描历史 visible candles。
- timeframe switch 后 marker 时间对齐要稳定，但不能重置模拟交易 session。
