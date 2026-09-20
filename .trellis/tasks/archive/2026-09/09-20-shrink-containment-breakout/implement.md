# 执行清单：包含性闸门真正生效

> 顺序执行。每一步都给出**验证命令**与**预期结果**；预期结果不符时停下来定位，不要往下走。
> 回滚点：步骤 2 之前（纯读）、步骤 2 之后（只改了 1 个生产文件）。

## 步骤 0 · 基线确认（只读）

- [ ] 确认工作区状态，记录当前是否有未提交改动，避免把无关脏文件卷进本次提交。
  ```bash
  git status --short
  ```
- [ ] 跑一遍现有测试，作为基线。
  ```bash
  npm test
  ```
  **预期**：全绿。

- [ ] 确认改动前的闸门确实失效（为 AC1 留下对照证据）：镜像 `detectConvergence` 的循环，用"合法突破K线"的夹具验证改动前返回**非 null**。
  - 复用 `research/containment-impact-probe.mjs` 里已有的镜像函数（见步骤 6 会落盘的脚本）。
  - **预期**：改动前该夹具返回非 null（证明闸门失效）；改动后必须返回 null。

## 步骤 1 · 设计确认（评审闸门）

- [ ] 确认 `design.md` §3 的区间口径（确认区间 = 带内前 `runLen - 1` 根）、§3.2 的"波动率指标不跟着改"、§7 的备选否决理由，与 `prd.md` 的 R1~R8 一致。
- [ ] 若与用户的理解有出入，**回到 1.1 修订 `prd.md` / `design.md`，不要带着分歧进入实现**。

## 步骤 2 · 改 `src/domain/coin-scan.ts`（唯一生产文件）

- [ ] 新增模块级常量，放在其他 `DEFAULT_CONVERGENCE_*` 常量附近，附"为什么必须排除最新一根"的简短注释：
  ```ts
  /** 带尾被排除在"确认区间"之外的K线根数：1 = 只排除最新一根。 */
  const CONVERGENCE_CONFIRMED_TAIL = 1;
  ```
- [ ] 改 `detectConvergence` 的区间构造（现 `:263-267`）：
  - 用 `band.slice(0, band.length - CONVERGENCE_CONFIRMED_TAIL)` 得到 `confirmed`；
  - `rangeLow` / `rangeHigh` 由 `confirmed` 求得；
  - 容差公式 `0.1 * (rangeHigh - rangeLow)` **不变**（R4）；
  - 拒绝条件与比较语义（`<` / `>`，闭区间不拒）**不变**。
- [ ] `position` 改为复用同一组 `rangeLow` / `rangeHigh`（R5 / AC6）——`best` 对象里保存的就是确认区间，不允许第二套区间计算。
- [ ] `runMed` / `preMed` / `flatRatio` 相关代码**一行不动**（R3）。
- [ ] 重写该段注释（R6），必须包含三点：
  1. 这条闸门**负责**突破保护（不再是平坦度的事实兜底）；
  2. 为什么区间必须排除最新一根（判定基准不能包含被判定对象）；
  3. 与平坦度是两道独立闸门（平坦度管"斜不斜"，包含性管"出没出界"）。
- [ ] 同步更新 `detectConvergence` 的函数级文档注释（`:209-233`）：把 "Containment" 那一段改成"基准取自**前 N-1 根**"，并删掉/修正任何暗示"价格突破即被拒"的旧描述。

**验证**
```bash
npx tsc --noEmit
npx vitest run tests/coin-scan.test.ts
```
**预期**：类型通过；`tests/coin-scan.test.ts:76` 的用例**开始失败**（它依赖非法K线且此前靠闸门失效才"通过"）。其余用例应保持通过。若失败的不止这一条，先定位原因再继续。

> 回滚点：`git checkout -- src/domain/coin-scan.ts`

## 步骤 3 · 改 `tests/coin-scan.test.ts`

- [ ] 删除/重写 `:76-85` 的非法K线用例（`close: 130` 而 `high: 100.5`），改为合法 OHLC（AC2）。
- [ ] 新增 AC1 用例：同一段"16 波动 + 16 安静"行情，末根换成**合法突破根** → 断言 `null`。
  - 先按 `design.md` §9.1 校验平坦度余量：`drift ≈ 0.022 × Δhigh × (runLen-1) / meanPrice`，要求 `< 2 × runMed` 且留 **≥ 3 倍余量**，否则会被误归因为平坦度拒绝。
  - 同时在用例注释中写明这段余量计算，方便后来者核对归因。
- [ ] 视情况补 AC6 用例（末根向下小破但落在容差内 → `position === 0`）。构造过于脆弱可以跳过，但要在 `check.jsonl`/交接说明里注明跳过原因。
- [ ] 通读 `tests/` 下所有 Candlestick 夹具，确认无 `close` 越出自身 `[low, high]` 的构造（AC2 是全仓要求，不只是这一个文件）。

**验证**
```bash
npx vitest run tests/coin-scan.test.ts
```
**预期**：全绿；且**把步骤 0 记录的"改动前行为"对照一遍**——AC1 的新用例在改动前必须是失败的。

## 步骤 4 · 全量测试与下游影响

- [ ] 跑全量。
  ```bash
  npm test
  ```
  **预期**：全绿。
- [ ] 如果 `tests/coin-scan-service.test.ts` 出现失败，**先判断是否属预期**：它的 `strongBars` / `weakBars` 是"16 波动 + 16 等宽"，最新一根必落在确认区间内，理论上不受影响。
  - 若确实失败，说明等宽假设不成立（例如末根 close 与 low/high 不等）——修夹具使其成为合法等宽K线，**不要**为了让测试变绿去放宽生产代码。
- [ ] 确认 `tests/coin-scan.test.ts:175` 附近的校准常量断言仍然通过（AC5）。

## 步骤 5 · 真实数据复测（AC4）

- [ ] 把镜像探针落盘到本任务目录，保证证据可复现：
  - `research/containment-impact-probe.mjs`（参数化"留出末尾根数"的镜像 + 真实行情对比）
  - `research/containment-impact.md`（改动前后数字）
- [ ] 运行探针（Node 24 需带 TS 转换与扩展名解析钩子）：
  ```bash
  node --experimental-transform-types \
    --import <register-ts.mjs 的 file:// URL> \
    <research/containment-impact-probe.mjs 的绝对路径>
  ```
  - 探针**只读**行情，不得写入 `data/review.sqlite`。
- [ ] 记录三个数字：**在榜币数 / 合格(币×周期)数 / 包含性拒绝次数**。
  **预期**（对照改动前基线 27 / 44 / 0）：`包含性拒绝 > 0`；在榜币数 27（允许 ±1）；合格(币×周期)数落在 42~44。
- [ ] 若偏离预期（例如在榜币数掉 > 1），**停下来**：说明 §3.3 的推论或夹具口径有问题，回到 `design.md` 复核，必要时回 1.1 修订需求。

## 步骤 6 · 上下文清单与交接

- [ ] 维护 `implement.jsonl` / `check.jsonl`：每条 `{"file": "<spec 路径>", "reason": "<为什么需要>"}`，只放规范/研究文档，**不放代码路径**。
- [ ] 在 `research/` 下留一份"改动前后差异"的简短结论，供 3.3 步骤（spec 更新）复用。

## 步骤 7 · 评审闸门（进入 2.2 前）

- [ ] 逐条勾选 `prd.md` 的 AC1~AC6，每一项给出**证据**（测试名 / 命令输出 / research 文件路径）。
- [ ] 确认没有顺手动过 Non-Goals 里的任何一项（窗口、minScore、评分公式、阈值、选品池、API 字段、前端）。
- [ ] `git diff` 通读一遍：生产代码只应有一个文件被改。

## 不做的事（防止范围蔓延）

- 不调 `10%` 容差、不调 `minRun` / `flatRatio` / `convergenceRatio` / `lengthScale`。
- 不改扫描窗口（100 / 200）。
- 不新增 `StructureResult` 字段、不把突破作为事件透出。
- 不动 `src/ui/*`、`src/server/*`。
- 不顺手"修" `position` 的既有 `clamp01` 行为，也不顺手修 `median()` 在偶数长度取上中位数的约定。

---

# 实际执行结果（偏差记录）

## 与原计划的偏差

| # | 计划里的说法 | 实际 | 处理 |
| --- | --- | --- | --- |
| 1 | 步骤 2 预期：`tests/coin-scan.test.ts:76` 的用例**开始失败** | **未失败**，继续通过 | 已更正 `prd.md`「后果二」与 `design.md` §6。原因：旧闸门在该夹具上**确实触发**（整带区间 `[99.5, 100.5]`、允许上界 `100.6`，非法 `close = 130` 越界）。它不是"假绿"，而是"只在不可能输入下可达"。重写的意义是让它在合法K线上守住同样行为。 |
| 2 | AC2 原文覆盖整个 `tests/` | 收窄到 `tests/coin-scan.test.ts` + `tests/coin-scan-service.test.ts` | 已更正 `prd.md` AC2 与 `design.md` §9.2。其他测试文件的图表/模拟交易夹具与 `detectConvergence` 无关，其中的越界价位是**刻意的诱饵输入**（如 `tests/binance-candles.test.ts:121` 用 `close: 29350` 配 `high: 2`），改它们属范围蔓延且有破坏用途的风险。 |
| 3 | AC6 计划用"末根向下小破 → `position === 0`"取证 | 该构造**无法区分**两种口径 | 已更正 `design.md` §9.4，改用对称插针：末根 `[99.3, 100.9]`（收盘 100.1），确认区间口径给 0.6、整带口径给 0.5。实测 `position = 0.6000`。 |
| 4 | 未预计 | 首次跑完 `tests/coin-scan.test.ts` **全绿**（14/14），一时看不出改动是否生效 | 用独立探针核算归因（平坦度余量 6.1x、6/6 候选带被包含性拒），确认闸门已生效，不是"改了没效果"。 |

## 各步骤实际结果

| 步骤 | 结果 |
| --- | --- |
| 0 · 基线 | `npm test` → 57 文件 / **367** 用例全绿 |
| 2 · 改 `coin-scan.ts` | `npx tsc --noEmit` 通过；`tests/coin-scan.test.ts` 14/14 通过（**未按预期失败**，见偏差 1） |
| 3 · 改 `tests/coin-scan.test.ts` | 删除非法夹具用例，新增 2 条：合法突破被拒（含控制组）+ `position` 只读确认区间；导入并钉住 `CONVERGENCE_CONFIRMED_TAIL = 1`。15/15 通过 |
| 4 · 全量测试 | `npm test` → 57 文件 / **368** 用例全绿（净 +1）。`tests/coin-scan-service.test.ts` **无需改动**（预测正确） |
| 5 · AC4 复测 | 在榜币 29→28、合格(币×周期) 46→45、包含性拒绝 **0→103**；镜像与真实函数决策 **0 条不一致**。详见 `research/containment-delta.md` |
| 6 · 上下文清单 | `task.py validate` 通过（implement 4 条 / check 4 条） |

## 夹具与归因的实测数字（供复核）

突破夹具 = 16 × `[94, 100]` + 15 × `[99.5, 100.5]` + `[100, 101.5]`（合法：收盘 100.75 ∈ `[100, 101.5]`）：

```
长带 runLen=16：runMed 0.01005  preMed 0.06383  → 收缩度通过
               drift(low) 0.001662  drift(high) 0.003290  flatTol 0.02010  → 平坦度通过（余量 6.1x）
               确认区间 [99.5, 100.5]  容差 0.100  允许上界 100.600
               最新收盘 100.75 → 超出 0.150  → 包含性拒绝  ← 唯一的拒绝者
改动前该夹具：score 0.8898（非 null）   改动后：null，且 6/6 条候选带被包含性拒绝
```

`position` 守卫夹具 = 16 × `[94, 100]` + 15 × `[99.5, 100.5]` + `[99.3, 100.9]`：
确认区间口径 `(100.1 − 99.5) / (100.5 − 99.5) = 0.6`；整带口径 `(100.1 − 99.3) / (100.9 − 99.3) = 0.5`。
