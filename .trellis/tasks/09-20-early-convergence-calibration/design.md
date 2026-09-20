# 技术设计：评分只保留收缩深度

## 1. 边界

- **改动层**：`src/domain`（纯函数）+ `tests/`。附带 `.trellis/spec/server/coin-scan.md`（规范）。
- **改动文件**：`src/domain/coin-scan.ts`、`tests/coin-scan.test.ts`。
- **不改动**：`src/server/*`、`src/ui/*`（R3 门槛数值未变，前端零改动）、`tests/coin-scan-service.test.ts`（预计不需改，见 §7）。
- 前置约束：`src/domain` 不得引入 React / Vite / fs / SQLite / fetch。本改动是纯计算。

## 2. 变更内容

```ts
// 现在
const score = clamp01(
  CONVERGENCE_SCORE_CALM_WEIGHT * relativeCalm +
    CONVERGENCE_SCORE_LENGTH_WEIGHT * lengthContribution,
);

// 之后
const score = relativeCalm;   // = clamp01(1 - runMed / preMed)
```

同时删除：

| 符号 | 位置 | 为什么可删 |
| --- | --- | --- |
| `DEFAULT_CONVERGENCE_LENGTH_SCALE` | 模块常量 | 只服务长度项 |
| `CONVERGENCE_SCORE_CALM_WEIGHT` | 模块常量 | `score = calm` 时权重恒为 1，无信息 |
| `CONVERGENCE_SCORE_LENGTH_WEIGHT` | 模块常量 | 长度项已删 |
| `StructureParams.lengthScale` | 导出类型 | 只被长度项消费；删除后 `StructureParams` 只剩 `minRun / convergenceRatio / flatRatio` |

`defaultStructureParams()` 相应去掉 `lengthScale` 字段。

## 3. 为什么删长度项（代数论证）

对任意候选带：

- `runLen ≥ 16` → `min(1, runLen/16) = 1.0` → 长度项恒为常量 `0.3`
- `runLen < 16` → `min(1, runLen/16) < 1.0` → 长度项恒**小于** `0.3`

结论：这一项**无法区分**任何两条 ≥16 根的带（"奖励成熟度"的意图落空），**唯一可观察的作用是把 <16 根的带按比例往下压**。在"要尽早发现收敛"的目标下，这是一个纯负面项。实测旁证：现状 60 币的日线选中带里 18/40 恰好卡在 16 这个饱和边界（旧数据），本任务离线样本里 OLD 恰好=16 的为 5/35 —— 边界堆积是饱和造成的。

删除后 `score` 的语义变得单一且可解释：

```
score = calm = 1 − runMed/preMed
门槛 0.60  ⟺  带内中位振幅 ≤ 前段的 40%
```

## 4. 门槛为什么是 0.60（含被否决的 0.43）

`score = calm` 后，同一个门槛比旧口径**严**：旧口径长带上 `minScore 0.6 ⟺ calm ≥ (0.6−0.3)/0.7 = 0.4286`；新口径 `0.6 ⟺ calm ≥ 0.6`。

曾给出一个很干净的性质：**门槛取 0.4286 时新榜单是旧榜单的超集**（证明：旧口径合格 ⟹ `calm ≥ (0.6 − 0.3L)/0.7 ≥ 0.4286`；新口径取 calm 最大的带 ⟹ 新 best calm ≥ 旧 best calm）。离线实测该门槛下**丢失 0 条**，验证成立。

但用户选择 **0.60**：宁可列表更纯（"宁少勿滥"的一贯取向），接受现有 35 条里消失 24 条、只剩 11 条 + 新增 8 条。**这是有意识的换血，不是回归缺陷**（AC4 要求复核这一点，避免后来者误判为 bug）。

门槛的数值恰好等于面板现值 `'0.6'`，所以前端无需改动（R3 / AC6）。

## 5. 被接受的副作用：选中的带会系统性变短

| | 带长中位 | 恰好=16 |
| --- | --- | --- |
| 旧口径 | 17 根 | 5 / 35 |
| 新口径（minRun 5） | **6 根** | 3 / 87 |

机制：长度项原本压制短带；去掉后"最近 5~6 根特别安静"最容易取得最高 `calm`。`minRun` 因此从辅助参数变成承重参数，但扫描显示**提高 `minRun` 会把收益整体抹掉**（`minRun ≥ 8` 时早期币新增 +8 → 0，5m 归零、1D 仅剩 1 条），所以保持 5 并**主动接受**代价：

- 确认区间中位只有 **5 根**（`minRun=5`），`position` 会更抖；
- 5 根带占 16%，是最脆的一档。

参考实测（1D 全部 5 条）：`calm` 分别为 0.752 / 0.741 / 0.749 / 0.623 / 0.600，4 条 ≥0.62，属真实收缩而非噪声；唯一"脆"的是 `LSKUSDT`（确认区间 4 根）。

## 6. 契约影响

| 契约 | 变化 | 说明 |
| --- | --- | --- |
| `StructureResult` 字段 | **无变化** | 仍是 `structure / position / score / touchCount / qualified` |
| `score` 数值 | **变** | 同一个 `calm` 下新分数更低（长带上正好低 0.3，短带低得少）。含义统一为"收缩深度" |
| `StructureParams` | **少一个字段** | `lengthScale` 移除（类型层面变化，编译期可见） |
| 导出的常量 | **少三个** | 见 §2 表 |
| 前端 | **无改动** | 门槛数值 0.6 未变；`position / score` 都是展示字段，不参与前端逻辑 |
| `ScanRow` / `ScanResponse` | **无变化** | 不新增字段 |
| `position` | 数值可能变 | 只因为"选中的带"变了（§5），口径本身沿用上一任务 |

## 7. 对既有测试的影响（预判）

- `tests/coin-scan.test.ts` 中断言校准常量的用例：需删掉三个被移除的常量断言，并**新增 `score === calm` 的断言**（AC1）。
- 以"阈值恰好卡在 0.7 / 0.6"为临界点的用例需要重新核验：`score = calm` 会整体压低分数，例如原本 `score ≈ 0.9` 的夹具现在约为 `calm ≈ 0.86` 左右，一般仍通过断言；但任何 `toBeLessThan(0.7)` / `toBeGreaterThanOrEqual(0.7)` 的临界断言必须逐个复核（计划的验证步骤要求实跑确认，不靠推断）。
- `tests/coin-scan-service.test.ts` 使用 `strongBars` / `weakBars`，断言里出现过 `score > 0.85`、`minScore` 0.5/0.7 的门槛行为。`score` 系统性下降后这些断言**可能失败**，属预期。处理原则：**只调整断言数值或夹具，使其继续表达同一意图；不得为了让测试变绿而放宽生产代码**。
- `defaultStructureParams` 的 `toEqual` 断言需去掉 `lengthScale`。

## 8. 测量方法（离线，强制）

- **数据源**：`data/review.sqlite`（`candles` 表），以 `readonly` 打开。当前快照有 86 个 USDT 品种 × 5 周期、各 ≥100 根。
- **窗口口径**：每个 (品种,周期) 取最近 100 根；丢掉可能仍在形成中的最后一根；按"相邻间隔 > 1.5 × 周期"判定跳空并丢弃该窗口（与 `CandlestickService.contiguousCandles` 同口径）。
- **对照口径**：`OLD` = 现状公式（直接调用真实 `detectConvergence`，确保基线可信）；`NEW` = 镜像的 calm-only。
- **脚本**：`research/threshold-calibration-probe.mjs`（门槛对照 + 超集校验 + calm 分布 + 带长分布）、`research/minrun-sweep-probe.mjs`（minRun 扫描）。
- **禁止**：批量请求币安。连续探测已触发 HTTP 418（IP 封禁 ~24 分钟）。`research/*` 里的探针一律只读本地缓存。

## 9. 风险与回滚

- **无持久化状态**：纯函数行为变更，不写库、不改缓存键。
- **回滚**：`git revert` 单文件 + 测试即可；无迁移、无外部依赖。
- **可观测差异**：榜单从 35 条变 19 条（换血 24 掉 / 8 增），`score` 数值整体下移，`position` 因选中带变短而更抖。均已在 `research/` 留证。
- **最大风险**：把"榜单一夜之间换了 2/3"误当成回归。缓解：AC4 明确要求复核，并在规范里记一条 Design Decision 说明这是门槛口径变化的结果。

## 10. 被否决的备选

| 备选 | 内容 | 否决理由 |
| --- | --- | --- |
| 保留长度项但改权重 | `0.9/0.1` 之类 | 分数差 `0.2 × (calm − L)`：只是**换偏向**，`calm < 长度项`的带被压低，不是干净的修法 |
| 把长度项改成"真成熟度" | 去封顶、对数刻度 | 仍需要一个跨周期刻度（16 根在 5m 是 80 分钟、在 1D 是 16 天），难标定；且用户判定时长不是他要的信息 |
| 长度作为独立展示维度 | 分数只看 calm，另出"已安静多久"列 | 方向正确但用户未选（"阶段记忆无所谓"），列入 Non-Goals；若以后要，属新增展示需求 |
| 门槛取 0.43（超集） | 只增不减，87 行 | 用户选"宁少勿滥"，要更纯的列表；0.43 的 87 行被认为太宽 |
| 提高 `minRun` 到 8~10 | 让带更有分量 | 实测把收益整体抹掉：早期币 +8 → 0，5m 归零，1D 1~0 条 |
| 按周期分别标定 `lengthScale` | 5 组刻度 | 长度项已删除，问题消失 |
