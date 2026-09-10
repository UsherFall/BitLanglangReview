# 模拟盘分批平仓 / 加仓 / 一仓一损止损 — 设计（最终）

## Scope

改 `src/ui/free-replay-paper-trading.ts`、`src/ui/App.tsx`（FreeReplayPaperTradingPanel）、`src/ui/styles.css`、相关测试。不涉及 K 线/cursor/Trade Review/SQLite/server API。

## Existing Boundaries

- `paperTrading: PaperTradingSession` 由 App 持有并随 Free Replay session 不透明 JSON 自动保存；DB 存在多版本旧形状，恢复路径归一化。
- reveal 只把新 reveal 的 K 线交给 `processRevealedCandle`；手动成交按 cursor close、时间为 progressTime；marker 时间 `freeReplayCursorTimeForProgress` 对齐且 App 过滤 `<= cursorTime`。

## Data Model

```ts
PaperLeg { id; entryPrice; entryTime; quantity; margin; notional; leverage; stopPrice? }
// stopPrice 挂在该仓上：一仓一损，止损数量=该仓剩余，无需单独订单/数量。

PaperPosition { id; direction; originPrice/originTime(首笔开仓锚点); entryPrice(剩余加权均价); quantity; margin; notional; leverage; legs: PaperLeg[] }

PaperOrder { id; kind:'entry'|'exit'; direction; limitPrice;
             positionRatioPercent?; leverage?;   // entry
             quantity?;                          // 唯一全局止盈挂单固化数量
             createdAtCursorTime }

PaperTradingSession { active; startedAtCursorTime; nextId;
                      pendingEntry: PaperOrder|null;
                      pendingExit: PaperOrder|null;   // 全局限价止盈(单个)
                      position: PaperPosition|null;
                      trades: PaperTrade[] }

PaperTrade { id; positionId; direction; entryPrice(FIFO/该仓成本); entryTime;
             positionOpenPrice/positionOpenTime; exitPrice; exitTime;
             quantity; margin; notional; leverage; pnl; returnRate }
```

## 语义

- **按仓市价平仓**：`closeLegMarket(session, legId, candle, eventTime, ratio=100)` 对该仓减 X%（默认整仓平）；平该仓的部分时该仓剩余仍带 `stopPrice`；整仓平则 leg（含 stop）移除；UI 提交后平仓比例复位 100%。
- 限价止盈（单个全局）：提交固化 `quantity = position.quantity × ratio%`（`≤ position.quantity`）；触达 `low<=limit<=high` 按 min(quantity, 剩余) FIFO 成交；成交后移除。
- **一仓一损**：`placeStopLoss(session, legId, stopPrice, currentPrice, cursor)` 写/改该 leg 的 `stopPrice`；无数量参数。触发 `closeLegQuantity` 只平该 leg 剩余（该仓成本），移除 leg。
- **全部市价平仓**：`closeMarket(session, candle, eventTime)`（ratio=100）FIFO 汇总平掉整个剩余，legs 空 → `position=null, pendingExit=null`。
- 全局止盈数量上限 = 当前持仓（不扣 stop：stop 自带各仓剩余覆盖）。

## Core Functions

- `availableMargin(session)`：`1000 − Σ leg.margin`。
- `openMarket` / `placeEntryLimit`：无持仓→新建；同向且可用>0→加仓新 leg；反向忽略；每次 leg/position 创建消费 `nextId`。
- `closeMarket(session, candle, eventTime, ratio=100)`：供「全部市价平仓」使用（整仓 FIFO 平）。
- `closeLegMarket(session, legId, candle, eventTime, ratio=100)`：按仓平 X%。
- `placeExitLimit(session, limitPrice, quantity, cursor)`：替换全局止盈；`quantity > position.quantity` 拒绝。
- `placeStopLoss(session, legId, stopPrice, currentPrice, cursor)`：设/改单仓止损；校验 `isValidStopLossPrice`（多 stop<current，空 stop>current）与 leg 存在且数量>0。
- `cancelStopLoss(session, legId)`：删该仓 stopPrice。
- `cancelPendingOrder(session, 'entry'|'exit')`：清限价开仓或全局止盈。
- `processRevealedCandle`：
  1. 待入场限价触达 → openPosition（清 pendingEntry）；
  2. 遍历当前 legs，凡 `stopPrice` 被本 K 线触达的 leg，逐个 `closeLegQuantity`（每步基于最新 session）；
  3. 仍有持仓且全局止盈触达 → `fillExitOrder`（min 数量）。
- `closeQuantityFor`（FIFO，全平/止盈用）与 `closeLegQuantity`（单仓平仓/止损用）都会生成 PaperTrade、维护聚合；legs 空 → `position=null, pendingExit=null`。
- `paperTradingStats` / `paperTradeMarkers` / `currentCursorCandle` 同前。
- `normalizePaperTradingSession(stored)`：
  - 旧单块 position（无 legs）→ 构造单 leg；
  - 旧 `pendingStopLoss` 对象 / `pendingStops` 列表 → 按 createdAtCursorTime 排序后逐个挂到 legs（顺序），作为尽力迁移；无 leg 则丢弃；
  - 旧 exit 单缺 `quantity` → `position.quantity × closeRatioPercent%` 估算；entry 单保留 ratio/leverage；
  - trades 缺 `positionId/positionOpen*` → 用自身 entry 补。

## UI（FreeReplayPaperTradingPanel）

- 参数卡（方向锁定/仓位比例/杠杆）与空仓开仓卡不变。
- 持仓态：
  - 聚合摘要（方向/均价/数量/保证金/可用/浮盈）。
  - 加仓卡（市价加仓 + 限价加仓）。
  - 平仓卡：「全部市价平仓」按钮 + 平仓比例（默认 100、提交复位）+ 全局限价止盈（价格输入/提交/chip）。
  - **逐仓止损卡**：`position.legs.map(LegStopRow)`；每行显示 `仓 N 开价 数量` + 「市价平 X%」按钮 + 止损价 input + `设止损/改价` + 删除按钮；无数量输入。
- props：`onCloseAll()`、`onCloseLeg(legId, ratio)`、`onSetStopLoss(legId, price)`、`onCancelStopLoss(legId)` 接 domain；止损类携 currentCandle.close。
- 恢复路径包 `normalizePaperTradingSession`。

## Compatibility & Rollback

- 无 API/schema 变更；session JSON 不透明，恢复归一化兜底多版本旧形状。
- 未发布版本中出现的旧 pendingStops/pendingStopLoss 通过归一化映射到 leg，避免旧会话残留无法操作。

## Risks

- 聚合字段只在 openPosition / closeQuantityFor / closeLeg 写路径维护。
- marker 单调 + positionId 去重开标记。
- 一仓一损触发遍历基于打开时的 legs 快照 + 每步重新查 `position.legs`，避免重复成交。
- 旧会话归一化为 best-effort（按顺序分配止损），不做完美数量匹配。
- 中文文案/aria 使用 aria-label/数值断言测试。
