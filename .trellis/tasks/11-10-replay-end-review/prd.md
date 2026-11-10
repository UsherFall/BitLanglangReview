# 回溯复盘结束 / 恢复复盘

## Goal

为进行中的 Free Replay 增加可逆的「结束复盘 / 恢复复盘」状态。结束后仍停留在当前图表与单子现场，但交易和 K 线进度被冻结；恢复后从同一现场继续，而不是退出、删除或重新创建会话。

## Confirmed Product Decisions

- 「结束复盘」不是退出到首页，不是删除历史会话，也不是生成最终报告的永久完结。
- 结束后不能再开仓，只能查看单子，不能调整 K 线进度。
- 必须有对应的「恢复复盘」；恢复后才能再次开单并继续调整 K 线进度。
- 结束时的持仓、限价委托、止损、单子和游标全部原样冻结，不自动平仓、撤单或成交。
- 冻结状态随会话持久化；切换模块、刷新页面或重新恢复历史会话后仍保持冻结，直到用户主动「恢复复盘」。旧会话缺少该状态时按可操作的 active 行为兼容。

## Background / Confirmed Facts

- 活跃回放、Paper Trading、历史会话和自动保存由 `useFreeReplaySessionLifecycle` 统一持有；现有公开命令没有结束/恢复状态（`src/ui/use-free-replay-session-lifecycle.ts:15-43`，`src/ui/use-free-replay-session-lifecycle.ts:67-258`）。
- `paperTrading.active` 当前表示“是否已经开始模拟交易”，同时参与回退禁用和各交易函数的守卫；它不等同于整个 Replay 是否被冻结，不能直接复用为结束状态（`src/ui/free-replay-paper-trading.ts:35-52`，`src/ui/free-replay-paper-trading.ts:68-139`，`src/ui/App.tsx:828-835`）。
- K 线进度有三个入口：侧边「上一根 / 下一根 K 线」、全局左右方向键、生命周期 `revealNext` / `rewind` 命令。只禁用按钮不足以阻止键盘或命令调用（`src/ui/FreeReplayPanel.tsx:190-207`，`src/ui/App.tsx:640-656`，`src/ui/use-free-replay-session-lifecycle.ts:213-235`）。
- Paper Trading 的可变操作不仅是开仓，还包括加仓、市价/限价平仓、取消委托、设置/取消止损和重置；当前纯函数对 `active` 的守卫也不完全一致，冻结应在 UI 和 lifecycle 命令两层形成一致边界（`src/ui/App.tsx:882-899`，`src/ui/App.tsx:1027-1355`，`src/ui/free-replay-paper-trading.ts:68-139`）。
- 结束现场可能仍有持仓、限价委托或止损。只有完全平仓的 Paper Round 才进入模拟单库；开放回合即使已有部分平仓也被排除（`src/domain/paper-round.ts:105-158`）。
- 会话已有 500ms trailing 自动保存、离开模块 flush、pagehide keepalive 和恢复机制，可承载冻结状态的保存/恢复；当前持久化结构没有 Replay 状态字段（`src/ui/use-free-replay-session-lifecycle.ts:90-185`，`src/domain/free-replay-session.ts:6-34`，`src/server/free-replay-session-store.ts:15-29`）。
- 无活跃回放时 `freeReplay = null` 的既有首页/删除语义不属于本需求；本功能结束后活跃回放仍保持挂载（`src/ui/App.tsx:866-925`）。

## Requirements

- R1：活跃 Replay 提供「结束复盘」；点击后保留当前会话、图表、游标、统计和单子，在现场进入明确的只读冻结态，并提供「恢复复盘」。
- R2：冻结态禁止一切会改变 Paper Trading 现场的操作，包括开仓/加仓、平仓、限价委托、取消委托、止损修改和重置；单子、持仓、委托与统计仍可查看。
- R3：冻结态禁止上一根/下一根 K 线，按钮与左右方向键均不能改变 `progressTime` / `cursorTime`，也不会因尝试步进而触发未来数据补取或成交处理。
- R4：冻结态仍允许纯查看行为，例如拖动/缩放图表、切换查看周期、点击单子定位；这些行为不得绕过游标冻结或改变 Paper Trading 状态。
- R5：恢复复盘动作本身不改变恢复当下的游标和 Paper Trading 现场，不额外揭示 K 线、不自动成交、不重置单据；未切换查看周期时与冻结前一致，冻结期间切过周期则保留切换后的同进度映射。随后重新允许交易与步进，既有“开始模拟交易后不能回退”的规则继续生效。
- R6：结束和恢复不得删除会话、清空批注或改变 Paper Round 的归属；既有自动保存、历史恢复和删除级联行为保持兼容。
- R7：所有冻结守卫必须同时覆盖可见控件和实际命令，避免仅 UI 置灰而键盘/直接调用仍能修改状态。

## Acceptance Criteria

- [x] AC1：活跃回放点击「结束复盘」后仍看到同一图表和单子，按钮切换为「恢复复盘」，出现明确的已结束/只读状态提示。
- [x] AC2：冻结时所有交易/委托/止损/重置入口不可提交；直接调用对应 lifecycle 命令也不会改变 Paper Trading 状态。
- [x] AC3：冻结时上一根、下一根按钮不可用于改变进度，左右方向键同样无效；连续尝试后游标、进度、成交和 future retry 调用均不变。
- [x] AC4：冻结时可查看并聚焦不同单子、拖动图表和切换周期，但 reveal 时间进度不前进、不回退，已有持仓/委托不被暗中处理。
- [x] AC5：点击「恢复复盘」本身不改变当前游标、持仓、委托、止损、单子和统计；未切换查看周期时它们与冻结前一致，切过周期时保留切换后的等价进度。之后的开仓和下一根操作按既有规则工作。
- [x] AC6：未开始模拟交易的 Replay 也能结束/恢复；恢复不会替用户自动开始模拟交易。已开始的会话恢复后仍保持已开始状态。
- [x] AC7：结束状态进入自动保存 payload；切换其他模块再回来、恢复历史会话及刷新页面后仍为冻结态，恢复复盘后保存为可操作态；旧会话缺少新状态字段时按 active 兼容。
- [x] AC8：冻结后立即点击当前历史会话或相同开始键，也不能借 restore 绕过「恢复复盘」而变成可操作态。
- [x] AC9：现有 Free Replay 自动保存、游标/周期、Paper Round 批注和删除级联测试继续通过。

## Out of Scope

- 退出到回溯复盘首页、永久完结/归档会话、只读历史快照。
- 自动平仓、自动撤单、强制清空开放回合。
- 新增会话级复盘报告、收益排行榜、策略评分或统计体系。
- 改变真实 Trade Review 的复盘进度语义。
