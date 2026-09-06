# 开平仓交互重构 — 设计

## Scope

改 `src/ui/App.tsx`（FreeReplayPaperTradingPanel / LegStopRow）、`src/ui/styles.css`、`src/ui/free-replay-paper-trading.ts`（删 `closeLegMarket`）、相关测试。不涉及 K 线/cursor/session 持久化/server。

## 目标 UI（持仓态）

```
[平仓]
  平仓比例: (25% 50% 75% 100%) 数字输入     ← 单个共享控件，默认/复位 100
  [市价平仓]           ← closeMarket(ratio)，整仓 FIFO；X=100 即全平
  限价平仓 [价格 input] [提交限价平仓] (chip 待平仓)
[逐仓止损]             ← 每仓一行，只做止损
  仓 N | 开 entryPrice | 量 qty
  [止损价 input] [设止损/改价] [删除]
```

- 无独立「全部市价平仓」按钮；全平 = 比例 100（默认/复位值）点「市价平仓」。
- 按钮 aria-label 用固定文案「市价平仓」，比例状态体现在 PresetNumberInput 中。

空仓态 / 参数卡 / 加仓卡 / 持仓摘要不变。

## 数据流与函数契约（domain 已具备，几乎零改动）

- `closeMarket(session, candle, eventTime, ratio=100)`：整仓 FIFO 比例平仓。App 侧 `onCloseRatio(ratio)` 传入。
- `placeExitLimit(session, price, quantity, cursor)`：quantity 由 App 在提交时按 `当前持仓 × 平仓比例` 算出（沿用现有 `exitQuantity` 计算）。
- **删除** `closeLegMarket`（`free-replay-paper-trading.ts:163-169`）：唯一 UI 引用是 `App.tsx:703 onCloseLeg`，删除该 prop/wiring。其 2 个 domain 测试改写为 `closeMarket(ratio)` 等价场景：
  - "keeps a leg stop after manually closing a part of that same leg"（`closeLegMarket` 平单仓 50%）→ `closeMarket(单仓, 50%)`；
  - "market-closes one whole leg…"（两等量仓 FIFO 后剩另一仓）→ `closeMarket(100)` 收尾。
- `closeLegQuantity` 保留（止损触发用）；`processRevealedCandle` 语义不变。

## UI 变更明细

1. `FreeReplayPaperTradingPanel`：
   - 状态：`closeRatioPercent`（原 `exitRatioPercent`）语义「平仓比例」，市价平仓与限价止盈共用；每次提交复位 100。
   - 平仓区：`平仓比例` PresetNumberInput + 单个「市价平仓」按钮 → `onCloseRatio(ratio)`；无「全部市价平仓」。
   - 移除 prop `onCloseLeg`；`LegStopRow` 不再接收平仓相关 props。
   - app jsdom 用例中原 `getByRole('button', { name: '全部市价平仓' })` 改为 `'市价平仓'`。
2. `LegStopRow`：只保留 meta（仓 N/开/量）+ 止损价 input + 设/改 + 删；删去 `.leg-stop-close` 容器与 `PresetNumberInput`。
3. `styles.css`：删 `.leg-stop-close`、`.leg-stop-close .preset-input`；`.leg-stop-control` 恢复"止损 input + 按钮"单行。
4. App 接线（`App.tsx:702-707`）：删 `onCloseAll`（并入市价平仓按钮）与 `onCloseLeg`；新增 `onCloseRatio={(ratio) => freeReplayCurrentCandle && setPaperTrading((c) => closeMarket(c, freeReplayCurrentCandle, freeReplay.progressTime, ratio))}`。

## 兼容与回滚

- session JSON 不变；无迁移。
- domain 只删一个导出函数 `closeLegMarket`；`normalizePaperTradingSession` 不动。
- 回滚：git revert 即可，无数据风险。

## 风险

- 删除 `closeLegMarket` 需同步 `tests/free-replay-paper-trading.test.ts` 顶部 import（`App.tsx` 等 grep 确认无其他引用）。
- 共享「平仓比例」语义：提交市价平或限价止盈后均复位 100，避免残留比例误操作（domain 测试已锁定全平清止损回归）。
- 「全部市价平仓」按钮被单个「市价平仓」取代：需同步 `tests/app-free-replay.test.tsx` 中 3 处 `getByRole('button', { name: '全部市价平仓' })` → `'市价平仓'`（这些用例依赖"全平后止损不触发"，语义等价：比例默认 100 点按钮即全平）。
