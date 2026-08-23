# Free Replay no-future progress model

## Goal

修正 Free Replay 的跨周期回放进度模型，避免切到大周期后泄露当前真实进度之后的价格，也避免从大周期切回小周期时丢失原本的小周期进度。

用户价值：Free Replay 应保持“复盘当时只能看到已经完成的 K 线”的语义。用户在不同 Review Timeframe 之间切换观察同一次回放时，不应因为大周期 candle start 覆盖真实进度而跳回更早的小周期位置。

## Confirmed Facts

- 当前 Free Replay session 是 React 页面内临时状态，符合 `.trellis/spec/frontend/state-management.md` 的约束，不持久化。
- 当前 `FreeReplayStart` 只有 `startTime`、`dataAnchorTime`、`startCursorTime`、`cursorTime`，没有独立的真实回放进度字段。
- 当前 `FreeReplayPanel` 在点击 `Start Free Replay` 时调用 `freeReplayCursorTimeForStart(startTime, timeframe)`，把用户选择时间映射到当前周期包含它的 candle start。
- 当前 `switchFreeReplayTimeframe` 用 `freeReplayCursorTimeForTimeframeSwitch(current.cursorTime, nextTimeframe)` 覆盖 `cursorTime`，因此从小周期切到大周期会丢失小周期精度。
- 当前规划归档 `.trellis/tasks/archive/2026-07/07-14-free-replay-chart-bugs/prd.md` 已确认切周期时加载锚点应使用当前回放进度，不使用 viewport 右边界或纸上交易 marker 时间。
- 当前模拟交易市价开仓/平仓使用 `currentCursorCandle` 对应 candle 的 close；限价单在后续 reveal 的 candle 上触发。

## Requirements

- R1: Free Replay session 必须区分真实回放进度和当前周期展示边界。
  - `progressTime` 表示真实回放进度，切换 Review Timeframe 时不得被取整覆盖。
  - 当前周期的可见 cursor 是派生展示边界，应由 `progressTime` 和当前 Review Timeframe 计算。
- R2: 点击 `Start Free Replay` 时，`progressTime` 使用用户选择的真实开始时间本身，不先按当前周期取整。
- R3: Free Replay 不得展示结束时间晚于 `progressTime` 的完整 K 线。
  - 例如 `progressTime = 10:35`，切到 `4H` 时不得显示 `08:00-12:00`，应显示上一根完整收盘的 `04:00-08:00`。
  - 例如 `progressTime = 10:35`，在 `5m` 时可显示到 `10:30-10:35` 这根已完成 K。
- R4: 切换 Review Timeframe 不修改 `progressTime`。
  - 从 `5m` 的 `progressTime = 10:35` 切到 `4H`，展示到 `04:00-08:00`。
  - 再切回 `5m`，仍应回到 `10:35` 对应的小周期边界附近，不得变成 `04:00` 或 `08:00`。
- R5: `Next candle` 按当前 Review Timeframe 推进 `progressTime` 到下一根当前周期 K 的完成时间。
  - 例如 `progressTime = 10:35`，当前 `4H`，当前展示 `04:00-08:00`，点击 `Next candle` 后 `progressTime = 12:00`，可展示 `08:00-12:00`。
- R6: `Previous candle` 按当前 Review Timeframe 回退 `progressTime` 到当前已显示 K 的开始时间。
  - 例如 `progressTime = 12:00`，当前 `4H`，当前展示 `08:00-12:00`，点击 `Previous candle` 后 `progressTime = 08:00`，可展示 `04:00-08:00`。
- R7: 初始加载、切周期加载、cursor follow、未来 candle 预取和 paper marker 过滤都应使用新的 no-future 展示边界，不得使用会泄露未来的包含 candle。
- R8: 纸上交易的成交价格规则保持不变，但成交事件时间要匹配 no-future replay 语义。
  - 市价开仓/平仓价格继续使用当前已完成可见 candle 的 close。
  - 限价单触发价格继续使用用户挂单的 limit price，不改成 candle close。
  - 限价单触发条件保持触价成交：被 reveal 的完整 candle 满足 `low <= limitPrice <= high` 即触发。
  - 市价成交、限价触发、paper trading start、挂单创建的事件时间应记录为用户当时的 `progressTime` 或被 reveal 到的 candle 完成时间，而不是 candle start。
- R9: 在大周期推进时，限价单按当前操作周期 reveal 出来的完整 K 线判断触发，不尝试还原大周期内部路径。
  - 例如用户在 `5m` 的 `progressTime = 10:35` 挂限价单，切到 `4H` 后点击 `Next candle` reveal `08:00-12:00`，若该 4H candle 的 high/low 触达挂单价，则成交。
  - 成交价仍是 `limitPrice`。
  - 成交时间记为该 4H candle 的完成时间，即新的 `progressTime = 12:00`。
  - 若同一根大周期 candle 内部存在多个可能事件顺序，第一版不推断内部先后。
- R10: 不改变 Free Replay session 的持久化策略，不改变 OKX candle cache schema，不改变 Trade Review 图表行为。

## Acceptance Criteria

- [ ] Start Free Replay 输入 `2024-05-21 10:35` 且当前周期为 `5m` 时，`progressTime` 保持真实 `10:35`，可见 candle 展示到 `10:30-10:35`。
- [ ] 从 `progressTime = 10:35` 的小周期切到 `4H` 时，图表展示到 `04:00-08:00`，不展示 `08:00-12:00`。
- [ ] 从上述 `4H` 再切回 `5m` 时，仍展示到 `10:30-10:35`，不跳到 `04:00` 或 `08:00`。
- [ ] 在 `4H` 且 `progressTime = 10:35` 时点击 `Next candle`，`progressTime` 推进到 `12:00`，图表展示到 `08:00-12:00`。
- [ ] 在 `4H` 且 `progressTime = 12:00` 时点击 `Previous candle`，`progressTime` 回退到 `08:00`，图表展示到 `04:00-08:00`。
- [ ] 切换 Review Timeframe 后 `/api/candles?mode=initial` 的加载锚点来自 `progressTime`，不来自旧周期展示 cursor、viewport 右边界、纸上交易 entry/exit marker 时间或原始 `startTime`。
- [ ] 已有 Free Replay cursor follow 行为保留：推进后 viewport 跟随新的展示边界，并保留用户当前 zoom span。
- [ ] 纸上交易 marker 仍只显示不晚于当前可见展示边界的已发生成交。
- [ ] 市价成交价格仍使用当前已完成可见 candle close；限价单触发成交价格仍使用挂单 limit price。
- [ ] 纸上交易成交事件时间记录在 no-future 语义下的完成时间/progress time，不再误表示为 candle start。
- [ ] 限价单触发仍是触价成交：被 reveal candle 的 high/low 覆盖 limit price 时成交，成交价为 limit price。
- [ ] 大周期 reveal 触发限价单时，成交时间为该大周期 candle 完成时间，不推断 candle 内部路径。
- [ ] Focused Vitest 覆盖 chart-time/free-replay-chart/App Free Replay 跨周期 no-future 行为。
- [ ] 不修改 Trade Review 模式行为。

## Out of Scope

- 不新增 Free Replay session 持久化。
- 不改变 OKX candle fetch/cache schema。
- 不改变 Trade Review K 线、marker、viewport 逻辑。
- 不扩展纸上交易的账户、手续费、滑点、限价成交规则，除非为 no-future 时间语义做必要适配。

## Open Questions

- 无。

## Notes

- Existing `.trellis/spec/frontend/component-guidelines.md` and `.trellis/spec/frontend/quality-guidelines.md` still say Free Replay timeframe switch maps cursor to the containing candlestick. This task intentionally supersedes that behavior for no-future replay and should update specs after implementation.
