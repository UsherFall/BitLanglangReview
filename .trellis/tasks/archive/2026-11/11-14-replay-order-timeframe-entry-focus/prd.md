# 修复复盘结束后切周期未定位开仓点

## Goal

结束回溯复盘后，用户查看并选中一条单子，切换查看周期时仍应定位到该单的开仓点；单子选择态与只读冻结现场保持一致，不需要再点一次单子。

## Background / Confirmed Facts

- 当前 `src/ui/use-free-replay-session-lifecycle.ts:291-299` 的 `switchTimeframe` 无条件调用 `onClearFocus()`，因此结束复盘后切周期也会清除 `orderFocus`，图表退回游标视图。
- “进行中回放切周期清焦点并回光标右缘”是 11/04 已确认的产品行为，本次不改变；本次问题只针对 11/10 新增的 `ended` 只读查看场景。
- `src/ui/App.tsx:1798-1835` 的焦点定位链路已经按 `rangeKey:token` 工作：保留同一焦点请求时，新周期会重新获取以 `positionOpenTime` 为中心的 `mode=initial` 连续窗口，并按目标周期调用 `entryVisibleRange` 定位。根因是入口提前清掉焦点，不需要重写图表或 Dataset。
- 现有结束复盘测试覆盖进度/Paper Trading 冻结和独立切周期，但没有覆盖“已选单子在 ended 状态下跨周期保留并重新定位”的完整链路；当前 hook 测试反而固定了 ended 切周期也清焦点的旧行为（`tests/free-replay-session-lifecycle.test.tsx:339-342`）。

## Requirements

- **R1 — ended 保留当前单子。** 已结束复盘且已选中单子时，切换周期不得清除该单的 Focus、行高亮或关联的查看状态。
- **R2 — 新周期重新定位开仓点。** 切到目标周期后，使用当前单的 `positionOpenTime` 获取该周期开仓点窗口，并在数据落地后将视口定位到开仓点；不得沿用旧周期索引或要求用户再次点击单子。
- **R3 — 冻结语义不变。** 切周期只改变查看方式：`reviewStatus='ended'`、`progressTime`、持仓、委托、止损和成交记录均保持不变，不揭示额外未来进度。
- **R4 — 其他路径不回归。** ended 且没有选中单子时仍按游标右缘初始化；active 进行中回放仍按 11/04 契约清 Focus 并回光标右缘；恢复复盘、步进和交易命令行为不变。
- **R5 — 锁定真实调用链。** 同时补充 lifecycle 条件清焦点测试与 App 集成回归，避免只验证 callback 而未验证实际开仓点窗口和视口。

## Acceptance Criteria

- [x] **AC1（R1/R2）**：结束复盘 → 点击一条已完成单子 → 切到另一周期后，该单仍为 active；新周期出现以该单开仓时间为 `entryTime` 的 `mode=initial` 请求；数据落地后视口为该单开仓点对应目标周期的 `entryVisibleRange`，无需再次点击。
- [x] **AC2（R3）**：上述操作前后 `reviewStatus` 始终为 ended，`progressTime` 与完整 Paper Trading 状态不变。
- [x] **AC3（R4）**：ended 未选单切周期仍定位游标；active 已选单切周期仍清 Focus、取消行高亮并定位游标，现有相关测试继续通过。
- [x] **AC4（R5）**：新增回归测试在旧实现上能复现“ended 切周期清 Focus/未定位开仓点”，修复后通过；相关 Free Replay 测试、TypeScript 检查和 diff 格式检查通过。

## Validation

- 旧实现红灯：lifecycle 断言观察到 ended 切周期仍调用 1 次 `onClearFocus`；App 集成等待目标周期开仓点 `mode=initial` 请求超时。两条用例在最小条件修复后均转绿。
- `npx vitest run tests/free-replay-session-lifecycle.test.tsx tests/app-free-replay.test.tsx`：78/78 通过。
- `npx vitest run --exclude tests/level-alert-parity.test.ts`：84 个测试文件、740/740 用例通过。
- 原始 `npm test`：同样 740 项通过，唯一失败为既有 `tests/level-alert-parity.test.ts` 缺少 `.trellis/tasks/archive/2026-10/10-20-anomaly-level-tracker/research/pool` 数据，非本次回归。
- `npx tsc --noEmit` 与 `git diff --check` 通过。

## Out of Scope

- 不全局恢复“进行中回放焦点单跨周期保留”的旧行为。
- 不修改交割单复盘、个人交割单复盘或其他币图表。
- 不修改 Candlestick 数据源、Cursor 映射、Dataset 窗口合并、拖动/翻页或自动保存协议。
- 不新增 Focus 持久化；Focus 仍是临时查看状态。
