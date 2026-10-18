# 标注页支持导入 labels.csv（跨机器续标）

## Goal

标注进度只存在浏览器 `localStorage`，而 `tools/labeling/out/`（页面 + 快照）与 `data/`（sqlite 缓存）都是 gitignored。换一台电脑后：页面能靠固定 anchor 重跑出来，但**「哪些标过、标了什么」带不走**。

加一个「导入 `labels.csv`」按钮：读回页面自己导出的 CSV，校验 anchor 后合并进 `localStorage`，让新机器从断点继续，而不是重标几十张。

## 触发

用户要去另一台电脑继续标注（2026-10-18）。

## Requirements

- **R1 导入入口**：页脚加「导入 labels.csv」按钮 + 隐藏的 `<input type="file" accept=".csv,text/csv">`；选完文件自动开始，重复选同一文件也要能再次触发（用完清空 `input.value`）。
- **R2 表头驱动**：按 CSV 表头认列（`instrument / anchor / label / reason / note / scoreShown / labeledAt`），不靠列序。缺必需列（`instrument` / `anchor` / `label`）时提示「不是 labels.csv」并放弃。
- **R3 anchor 校验**：只导入 `anchor` 等于当前页面快照 anchor 的行；其余**跳过并计数**，在提示里说明。绝不用别的 snapshot 的标签污染当前进度。
- **R4 合并语义**：按 `instrument` 覆盖式合并（导入的是权威记录），**不清空**未出现在 CSV 里的现有标签；空 `label` 的行跳过。
- **R5 容错**：CSV 解析要处理 BOM、引号包裹、字段内逗号与双引号转义（`""`）、`\r\n`；`note` 里出现逗号时不得错位。
- **R6 边界**：不改 `src/`；不改导出格式；不动采样与快照。

## Acceptance Criteria

- [ ] AC1 导出 → 清空 localStorage → 导入同一份 CSV，标签条数与内容逐条还原（含 `reason` / `note` / `scoreShown`）。
- [ ] AC2 `note` 含逗号与引号时能正确往返（导出→导入后 `note` 原文一致）。
- [ ] AC3 anchor 不匹配的行被跳过，且提示里报出跳过条数；匹配的行照常导入。
- [ ] AC4 导入后进度条/已标数立即更新，且**页面位置不跳**（保持当前 index）。
- [ ] AC5 缺表头列的文件被拒绝并提示，不写入任何标签。
- [ ] AC6 `npx tsc --noEmit` 与 `npm test` 全绿；`git status -- src/` 为空。
- [ ] AC7 jsdom 行为断言覆盖：文件输入 → 解析 → localStorage 合并 → 界面刷新。

## Notes

- 轻量任务，PRD 即计划。
- 配套的用户操作：本机先「导出 labels.csv」带走；新机器 `npm run label:sample -- --refresh --anchor <同一个>` + `npm run label:page`，再导入。
