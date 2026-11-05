# 回溯复盘 K 线消失回归

## Goal

修复用户当前在回溯复盘中看不到 K 线的回归，使生产入口的 React StrictMode 挂载下 Free Replay 主图也能正常显示 Candlesticks，并用直接、稳定的回归验证防止复发。

## Background

- 用户在 2026-11-05 报告“回溯复盘看不到 K 线”，要求优先于原定的 Free Replay Session 生命周期架构改造处理。
- 已用真实 `App` 流程建立确定性复现：普通挂载通过；与 `src/main.tsx:7` 相同的 StrictMode 挂载下，最后一次 `series.setData` 中真实 OHLC 点数量为 0。
- 根因已确认：`src/ui/App.tsx:1581` 在 render 作用域保存一个 Dataset，订阅 cleanup 在 `src/ui/App.tsx:1680` 将其永久 dispose；StrictMode 重放 effect 后，`src/ui/App.tsx:1775` 的第二次 `syncRange` 仍使用该已销毁实例并直接返回。第一次请求的非空响应也被 dispose/generation 防护丢弃。
- 插桩证据为 `syncRange(disposed=false) → dispose → syncRange(disposed=true)`，最终 Cursor / Rendered 均为空。行情响应有效，时间过滤和 series 渲染不是这次空白的上游根因。
- 既有 `tests/free-replay-dataset.test.ts` 与 `tests/app-free-replay.test.tsx` 共 75 个测试通过，但缺少生产入口同款 StrictMode 覆盖。
- 完整复现、假设排除和生命周期方案见 `research/strict-mode-reproduction.md`。

## Requirements

- **R1 — 原始症状验证。** 使用已建立的 App + 图表输入 Seam 反馈回路验证修复，不得仅以 Dataset 单元测试或通过删除 StrictMode 代替。
- **R2 — 生命周期对齐。** Dataset 必须由订阅 effect 的 setup 创建、由对应 cleanup 销毁；StrictMode 第二次 setup 必须获得新实例，所有命令读取当前实例，真实卸载仍执行 unsubscribe + dispose。
- **R3 — 最小兼容修复。** 不修改 `FreeReplayDataset` 的 Cursor / Focus / Active / Rendered、请求、过期响应、dispose 或延迟渲染契约，不进行 Session 生命周期架构改造或无关重构。
- **R4 — 直接回归验证。** 在 `tests/app-free-replay.test.tsx` 增加 StrictMode 新建 Free Replay 的回归测试，断言真实 K 线进入当前 series；先观察未修复代码失败，再验证修复后通过。
- **R5 — 完整质量门。** 通过 focused tests、完整 `npm test`、`npx tsc --noEmit` 和原始复现回路；清理临时插桩与 throwaway harness，并将防护规则写回 frontend spec。

## Acceptance Criteria

- [x] 已记录与“回溯复盘看不到 K 线”一致的可重复触发路径、实际症状和根因证据。
- [x] 生产入口同款 StrictMode 下，有效行情响应能够在 Free Replay 主图产生真实可见 Candlesticks，不再停留在空 Cursor / Rendered。
  - 证据：新 StrictMode 回归通过；原始 throwaway 回路在 StrictMode 与普通模式下均通过。
- [x] 新回归测试在未修复实现上失败、在修复后通过，且普通 App 挂载与现有 Free Replay characterization 均保持通过。
  - 证据：修复前 `expected 0 to be greater than 0`，修复后同测试通过；focused Dataset + App Replay 共 2 个文件 / 76 个测试通过。
- [x] Cursor / Focus 双数据集、Focus 切换、未来数据隐藏、过期响应隔离及拖动延迟渲染行为没有倒退。
  - 证据：`tests/free-replay-dataset.test.ts` 与完整 `tests/app-free-replay.test.tsx` 全通过；`src/ui/free-replay-dataset.ts` 未修改。
- [x] focused tests、全量可运行测试、`npx tsc --noEmit` 与原始复现回路通过；完整 `npm test` 已运行并单独记录既有环境失败。
  - 已通过：focused 2 个文件 / 76 个测试、`npx tsc --noEmit`、原始两种挂载回路、`git diff --check`。
  - 全量结果：`npm test` 中 77 个文件 / 707 个测试通过，但 `tests/level-alert-parity.test.ts` 因既有 ignored 历史数据目录 `.trellis/tasks/archive/2026-10/10-20-anomaly-level-tracker/research/pool` 缺失而无法加载；仅排除该不可加载 suite 后 77 个文件 / 707 个测试全通过。未修改或放宽该无关测试，不将原始 `npm test` 记为全绿。
  - 口径依据：多个既有任务自 2026-11-03 起已在干净 HEAD 复现并记录同一环境失败，按“其余全量测试通过、该问题单独说明”交付；本任务沿用该既定例外，不新增跳过逻辑。
- [x] 临时插桩和 throwaway harness 已清理，可执行的 StrictMode 生命周期防护规则已写回相关 `.trellis/spec`。
  - 证据：`.scratch/replay-strict-repro.test.tsx` 已删除；tracked source 无 `[DEBUG-replay-strict]`；已更新 `hook-guidelines.md`、`free-replay-dataset.md` 与 `quality-guidelines.md`。

## Out of Scope

- 移除或绕过 React StrictMode。
- 让 disposed Dataset 可复活、跳过真实卸载清理，或通过延时 dispose 猜测 effect 是否为重放。
- 原定的 Free Replay Session 生命周期深化；它在本缺陷验收后再规划。
- 重新设计 Replay UX、图表库、行情源策略、双数据集协议或无关 App 结构。
