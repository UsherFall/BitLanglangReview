# 执行清单：评分只保留收缩深度

> 顺序执行。每步给出**验证命令**与**预期结果**；不符时停下来定位，不要往下走。
> 回滚点：步骤 2 之前（纯读）；步骤 2 之后（只改了 1 个生产文件 + 1 个测试文件）。

## 步骤 0 · 基线（只读，离线）

- [ ] 记录工作区状态，确认没有会把无关脏文件卷进提交的情况。
  ```bash
  git status --short
  ```
- [ ] 跑一遍现有测试作为基线。
  ```bash
  npm test
  ```
  **预期**：全绿（上一任务收尾时为 57 文件 / 368 用例）。
- [ ] 用**离线**探针复算现状基线，作为改动对照。
  ```bash
  node --experimental-transform-types .trellis/tasks/09-20-early-convergence-calibration/research/threshold-calibration-probe.mjs
  ```
  **预期**：`OLD 基线合格窗口 35`（缓存会随时间漂移，落在 30~40 即可），`门槛 0.43` 一行丢失 0 条。
  **注意**：只读 `data/review.sqlite`。**不要**改这个脚本去联网拉行情 —— 连续探测币安已触发过 HTTP 418（IP 封禁 ~24 分钟）。

## 步骤 1 · 设计确认（评审闸门）

- [ ] 确认 `prd.md` 的 R1~R8 / AC1~AC7 与用户已拍定的三个口径一致：**评分只剩 calm**、**门槛 0.60**、**minRun 保持 5**。
- [ ] 确认已接受两个副作用：①现有 35 条里消失 24 条（有意换血，AC4）；②选中的带系统性变短（带长中位 17 → 6 根）。
- [ ] 若有出入，**回到 1.1 修订 `prd.md` / `design.md`**，不要带着分歧进入实现。

## 步骤 2 · 改 `src/domain/coin-scan.ts`

- [ ] 把打分改成只剩收缩深度：
  ```ts
  const score = relativeCalm;   // clamp01(1 - runMed / preMed)
  ```
  删除 `CONVERGENCE_SCORE_CALM_WEIGHT` / `CONVERGENCE_SCORE_LENGTH_WEIGHT` 及其乘法。
- [ ] 删除常量 `DEFAULT_CONVERGENCE_LENGTH_SCALE`（连同它的文档注释）。
- [ ] 从 `StructureParams` 删除 `lengthScale` 字段及其注释块；同步删除 `defaultStructureParams()` 里的 `lengthScale` 项。
- [ ] 全文搜索并清掉所有残留引用（函数级文档里的 `length = runLen / lengthScale` 公式、`score is calm-dominant` 之类叙述）。
- [ ] 重写相关注释到真实语义（R8）：
  - 为什么评分里不再有时长（长度项在 16 根饱和 → 无法区分长带，只会惩罚短带）；
  - `score` 现在的唯一含义是收缩深度，并给出"门槛 0.60 ⟺ 振幅 ≤ 前段 40%"的等价说法；
  - `minRun` 现在是承重参数（选中的带会偏短），说明这是主动接受的取舍。

**验证**
```bash
npx tsc --noEmit
```
**预期**：类型通过。若 `tsc` 报出 `lengthScale` 相关错误，说明有遗漏的引用未清理 —— 逐个清掉。

> 回滚点：`git checkout -- src/domain/coin-scan.ts`

## 步骤 3 · 改 `tests/coin-scan.test.ts`

- [ ] 删除对三个已移除常量的 import 与断言（`exposes the calibrated convergence constants` 用例）。
- [ ] `defaultStructureParams` 的 `toEqual` 断言去掉 `lengthScale`。
- [ ] **新增 AC1 用例**：断言 `score` 等于 `1 − runMed/preMed`，且**与带长无关**。
  - 做法建议：构造两组"前段相同、带内振幅比相同、但带长不同"的夹具，断言两个 `score` 相等（在浮点容差内）。这直接锁住"评分不再含长度项"。
- [ ] **逐个复核临界断言**：`score` 整体下移，任何 `toBeLessThan(0.7)` / `toBeGreaterThanOrEqual(0.7)` / 依赖 `minScore 0.6` 的用例都要重算。清单：
  ```bash
  grep -n "score\|0\.6\|0\.7" tests/coin-scan.test.ts
  ```
- [ ] 复核 `tests/coin-scan-service.test.ts`：`score > 0.85`、`minScore` 0.5/0.7 等断言可能失败。
  **原则：只调整断言数值或夹具，使其继续表达同一意图；绝不放宽生产代码来让测试变绿。** 若某条断言表达的行为已不存在，删除它并在交接说明里写清理由。

**验证**
```bash
npx vitest run tests/coin-scan.test.ts tests/coin-scan-service.test.ts
```
**预期**：全绿。

## 步骤 4 · 全量测试与类型检查

```bash
npm test
```
**预期**：全绿。用例数会因删除/新增而变动，**记录新的数字**，不要与步骤 0 的基线强行对齐。

## 步骤 5 · 离线复测（AC3 / AC4）

- [ ] 用同一探针复测新口径：
  ```bash
  node --experimental-transform-types .trellis/tasks/09-20-early-convergence-calibration/research/threshold-calibration-probe.mjs
  ```
  （脚本里的 `NEW` 分支即新口径；`门槛 0.60` 那一行就是要复核的对象。）
- [ ] 记录三个数字：**合格窗口数**（预期 ≈19，缓存漂移下 15~25 可接受）、**早期(<16 根)占比**（预期 ≥70%）、**新增 / 丢失**（预期 +8 / 24）。
- [ ] 偏差 > 20% 时**必须解释**（缓存快照变了 / 窗口被跳空过滤掉了），不能含糊过去。
- [ ] 把实测结果写入 `research/`（新建 `applied-measurement.md`，记快照时间与三个数字）。
- [ ] 确认 AC4：明确写下"35 → 19、丢失 24、新增 8 属预期"，避免后来者当成回归。

## 步骤 6 · 更新规范 `.trellis/spec/server/coin-scan.md`

- [ ] 算法段（`### Algorithm: volatility convergence`）：把评分公式改成 `score = relativeCalm`，删掉 calm/length 权重的叙述。
- [ ] 标定常量表：删除 `DEFAULT_CONVERGENCE_LENGTH_SCALE`、`CONVERGENCE_SCORE_CALM_WEIGHT`、`CONVERGENCE_SCORE_LENGTH_WEIGHT` 三行。
- [ ] 加一条 **Design Decision（09/20）**：说明长度项为什么被删（16 根饱和 → 只会罚短带）、门槛为何选 0.60（含被否决的超集 0.43）、以及"选中带会系统性变短、`minRun` 变承重"这个已接受的代价，并指向本任务的 `research/`。
- [ ] 测试清单：更新 `detectConvergence` 的用例描述（新增 `score === calm` 与"与带长无关"）。

## 步骤 7 · 上下文清单

- [ ] 维护 `implement.jsonl` / `check.jsonl`：每条 `{"file": "<spec 或 research 路径>", "reason": "..."}`，只放规范/研究文档，不放代码路径。

## 步骤 8 · 评审闸门（进入 2.2 前）

- [ ] 逐条勾选 AC1~AC7 并给出证据（测试名 / 命令输出 / research 文件路径）。
- [ ] 确认 Non-Goals 一条都没被越界：**没有碰"关键位置"**、没有改 `minRun`、没有加展示列、没有改前端、没有重新标定 10% 容差 / `flatRatio` / `convergenceRatio`、没有改窗口与三道闸门。
- [ ] `git diff` 通读：生产代码只应有一个文件被改。

## 不做的事（防止范围蔓延）

- 不做"关键位置收敛"（下一个任务）。
- 不做阶段标记 / 收敛起始时间记忆。
- 不调 `minRun`、不加按长度的额外门槛或加权。
- 不调 `minScore` 的输入控件；不改结果表结构。
- 不重新标定包含性 10% 容差、`flatRatio`、`convergenceRatio`。
- 不顺手"修" `median()` 取上中位数的既有约定，也不动 `position` 的 `clamp01` 行为。
- 不为了 AC3 的数字好看去改探针口径（探针是证据，不是被调优的对象）。
