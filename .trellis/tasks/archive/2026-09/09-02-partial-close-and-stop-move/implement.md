# 实施记录 — 模拟盘分批平仓 / 加仓 / 一仓一损止损

## Scope Executed（以 prd.md/design.md 为最终口径）

### A. Domain — `src/ui/free-replay-paper-trading.ts`

- 聚合位 + legs 模型；FIFO 手动/止盈平仓；加仓（保证金=比例×可用）。
- **一仓一损**：止损挂在 `PaperLeg.stopPrice`；`placeStopLoss(session, legId, stopPrice, currentPrice, cursor)` 设/改，`cancelStopLoss(session, legId)` 删；无数量参数；`closeLeg` 触发只平该仓剩余。
- 全局限价止盈单个：`placeExitLimit(..., quantity, ...)`，`quantity ≤ position.quantity`。
- 手动市价平仓提交后 UI 将"平仓比例"复位 100%（防残留比例误操作；domain 侧回归测试锁定"全平后止损不再触发"）。
- `normalizePaperTradingSession` 迁移多版本旧 JSON（单块→leg、旧 pendingStopLoss/pendingStops→按 leg 顺序挂载、止盈缺数量→按比例估算）。
- 已删中间模型的 `pendingStops` 数组/固定数量止损，避免历史死代码。

### B. App — `src/ui/App.tsx`

- 恢复路径 normalize。
- 面板：聚合持仓摘要 + 加仓卡 + 平仓卡（平仓比例复位 100%）+ **逐仓止损卡**（`LegStopRow`：仓序号/开仓价/数量 + 止损价 input + 设止损/改价/删除，无数量输入）。
- props：`onSetStopLoss(legId, price)`、`onCancelStopLoss(legId)`。
- `styles.css`：新增 `.leg-stop-row/.leg-stop-meta/.leg-stop-control`。

### C. Tests

- `tests/free-replay-paper-trading.test.ts`：21 用例（分批平/全平清止损回归、FIFO 跨批、两仓各设止损同根K线各按价位成交、单仓止损触发只平该仓、改价/删除、盈利侧止损、short 校验、止盈固定数量与不足成交、旧 session 归一化挂载止损、marker 去重等）。
- `tests/app-free-replay.test.tsx`：止损交互用例改为 `仓1 止损价` + `设仓1止损` + `删除仓1止损` 断言。

## Validation Status

- `npx tsc --noEmit` ✅
- node 全量：`npx vitest run --pool=vmForks --exclude '**/*.test.tsx' tests/` → 全部通过（本机 Node24 默认 pool 崩溃、jsdom matcher 不注册为既有环境问题）。

## Fix（2026-09-06，continue 会话）

- 原实现把「平仓比例」做成单一共享控件（位于「平仓」区），与 PRD R1「每仓行有自身平仓比例」不符；用户反馈市价平仓无法按仓设比例。
- 改为：每个 `LegStopRow` 自带 `平仓比例` 控件（默认 100%、快捷 25/50/75/100），驱动该仓「市价平 X%」按钮；提交后该仓比例复位 100%。
- 「平仓」区的共享控件改为「限价平仓比例」，仅用于固化止盈挂单数量（≤ 持仓）。
- 改动：`src/ui/App.tsx`（FreeReplayPaperTradingPanel / LegStopRow）、`src/ui/styles.css`（`.leg-stop-close`）。
- 校验：`tsc` 通过；`tests/free-replay-paper-trading.test.ts` 22 用例通过。

## Remaining

- 手动 dev 体验：开仓 → 设止损 → 加仓(新仓) → 各仓分别设/移止损 → 触发 → 恢复旧会话。
- 在可跑 jsdom 的环境补跑 `npm test`；或另任务修复测试环境（Node24/vitest 4 pool + jest-dom 兼容）。
