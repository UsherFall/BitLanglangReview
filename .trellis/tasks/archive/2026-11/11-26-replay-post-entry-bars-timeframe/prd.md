# 修复回溯复盘切换周期后开仓后K线显示失效

## Goal

回溯复盘中选中单子并隐藏开仓点后的 K 线时，无论回放进行中还是已结束，切换周期都保留同一焦点单和隐藏状态，让用户能按不同周期审视入场前结构且不泄露未来 K 线。

## Background / Confirmed Facts

- 用户反馈：在回溯复盘中使用“显示开仓后的K线”按钮后，切换周期会导致该显示效果消失。
- 按钮实际含义：`src/ui/App.tsx:1466-1473` 的剪刀按钮只在焦点单存在时出现；`hideAfterFocus=true` 时隐藏开仓点后的 K 线，按钮文案变为“显示开仓点后的 K 线”。
- 根因已定位到进行中回放路径：`src/ui/use-free-replay-session-lifecycle.ts:290-301` 在 `reviewStatus !== 'ended'` 时切周期调用 `onClearFocus()`；焦点清除后按钮消失，开仓点 cutoff 也随之失效。这是 11/04 的旧产品契约，不是单纯的过滤重算遗漏。
- 已结束回放路径按 11/14 契约保留 Focus；`src/ui/App.tsx:1724-1728` 在同一单 ID 下不会主动重置 `hideAfterFocus`。
- 既有规范存在演进冲突：11/03 曾要求“焦点态跨周期切换时隐藏态存活”，11/04 改为“进行中切周期清焦点并回光标右缘”，11/14 只对已结束状态恢复跨周期 Focus。

## Requirements

- **R1 — 跨周期保留焦点。** 进行中或已结束回放中，已有焦点单时切换周期不得清除该单 Focus、行高亮或剪刀按钮；新周期仍查看同一 `positionOpenTime` 对应的单子。
- **R2 — 跨周期保留隐藏效果。** 若切换前已开启“隐藏开仓点后的 K 线”，目标周期数据落地后仍沿用现有严格边界 `timestamp < positionOpenTime`：保留开仓成交所在 K 线及其之前的数据，隐藏从 `positionOpenTime` 开档的未来 K 线；剪刀保持选中，`aria-pressed=true`，不需要再次点击单子或按钮。
- **R3 — 只改变查看周期。** 切周期后按既有焦点链路重新获取目标周期的开仓点连续窗口并定位；`progressTime`、回放状态及 Paper Trading 数据不得因此改变。
- **R4 — 未隐藏时语义一致。** 焦点单存在但未开启隐藏时，切周期同样保留焦点并展示该单目标周期的完整焦点窗口；之后仍可随时开启隐藏。
- **R5 — 既有退出规则不变。** 没有焦点单时切周期仍按游标视图初始化；换焦点单、退出焦点、切换会话或离开回溯模式时，剪刀隐藏状态仍按现有规则复位。Focus 与隐藏状态仍为临时 UI 状态，不进入会话持久化。

## Acceptance Criteria

- [x] **AC1（R1/R2/R3）**：进行中回放 → 选中已完成单子 → 开启隐藏 → 切到另一周期：同一单行仍高亮，剪刀仍选中；目标周期发出以该单 `positionOpenTime` 为 `entryTime` 的焦点 `mode=initial` 请求，数据落地后的真实 K 线均截止于开仓点所在 K 线，后续 K 线不泄漏。
- [x] **AC2（R1/R2）**：在上述状态连续切换多个周期并切回原周期，焦点与隐藏效果始终保留，无需重复点击。
- [x] **AC3（R1/R2/R3）**：已结束回放执行相同操作，行为与进行中一致；`reviewStatus='ended'`、`progressTime` 和 Paper Trading 状态保持不变。
- [x] **AC4（R4）**：焦点单未开启隐藏时切周期，焦点保留且目标周期完整焦点窗口可见；随后开启隐藏可立即截断开仓点后的 K 线。
- [x] **AC5（R5）**：无焦点单切周期仍定位游标；退出焦点再重新选单时隐藏状态默认为关闭。
- [x] **AC6（回归）**：新增 App 集成回归在旧实现上能复现进行中切周期清焦点/隐藏失效，修复后通过；相关 lifecycle、Free Replay 测试及 TypeScript 检查通过。

## Validation

- 旧实现红灯：`keeps the focused order and pre-entry view across active timeframe switches` 在切到 15m 后等不到以该单开仓时间为 `entryTime` 的 Focus 请求，断言按预期失败；移除 active 切周期的 Focus 清理后转绿。
- `npx vitest run tests/free-replay-session-lifecycle.test.tsx tests/app-free-replay.test.tsx`：2 个文件、79/79 用例通过。
- `npx vitest run --exclude tests/level-alert-parity.test.ts`：84 个文件、762/762 用例通过。
- 原始 `npm test`：同样 762 项通过；唯一失败为既有 `tests/level-alert-parity.test.ts` 缺少 `.trellis/tasks/archive/2026-10/10-20-anomaly-level-tracker/research/pool` 数据，非本次回归。
- `npx tsc --noEmit` 与 `git diff --check` 通过。
- 未启动真实浏览器做人工冒烟；App 集成测试已覆盖真实生命周期 → Focus 请求 → `series.setData` → 按钮/行状态链路。

## Out of Scope

- 不修改交割单复盘、个人交割单复盘或其他币图表。
- 不修改 Candlestick 数据源、Cursor/Progress 映射、Dataset 窗口合并、拖动/翻页或自动保存协议。
- 不新增 Focus 或剪刀隐藏状态的会话持久化。
- 不改变无焦点单时的游标右缘定位，以及换单/退出焦点时的隐藏状态复位规则。

## Key Decision

用户已确认以本任务取代 11/04“进行中切周期一律清 Focus 并回光标右缘”的旧决策：只要切周期前存在焦点单，进行中和已结束回放都沿用 11/14 的跨周期 Focus 重取与重定位路径；进行中不再自动清除焦点、回到游标右缘。
