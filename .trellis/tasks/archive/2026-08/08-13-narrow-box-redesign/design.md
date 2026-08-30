# Design: volatility-based 收敛 (convergence) detection

## 核心思路

fractal 触碰式箱体检测有盲区：窄箱体 fractal 触碰天然少（8/12 07:15 箱体区只有 1 个低点
触碰）。改用**波动率直接检测平静带**——纯 bar 滑动扫描，不依赖 fractal。

## `detectConvergence(candles, params)`

对每个可能的段起点 `s`（从当前 bar 往前穷举），段 `[s..last]` 须过 4 道门：

1. **平边门**（自适应）：`max(lowDrift, highDrift) ≤ flatRatio × coinVol`。
   - `coinVol` = 窗口每根 bar 波动率 (high-low)/low 的中位数（该币自身常态）。
   - `flatRatio=1.2`：边可漂移最多 1.2 个常态 bar。跨币种/周期缩放。
   - 关键区分：8/12 低点平（漂 0.34% vs coinVol 0.39% → 过）；8/13 低点抬 916→923
     （漂 0.7% vs coinVol 0.40% → 拒 → 归三角）。
2. **收敛门**（相对前段）：`runMed < convergenceRatio × preMed`。
   - `runMed` = 段波动中位数；`preMed` = 段前**等长**段的中位数（对称比较，非固定 40 根）。
   - `convergenceRatio=0.8`：至少安静 20%。
   - 中位数对尖刺稳健 → **允许内部尖刺**（08:15 大棒被吸收）。
3. **绝对安静门**：`runMed < 0.8 × coinVol`。段必须真低于该币常态波动。
   - 拒「比临近尖峰安静但波动仍 ≥ 常态」的平尾巴（8/13 尾巴、三角 fixture 平 bar）。
   - 这是区分「真收敛」与「平尾巴」的关键（谁分高谁赢的补充）。
4. **范围门**（动态）：当前价在段 `[minLow, maxHigh]` 内（容差 10%×范围高）。段往前扩展时
   顶/底随新高新低重画。

段长 ≥ `minRun`（5）。

**分数**：`clamp01(relativeCalm + 0.5×absoluteCalm + 0.1×lengthNorm)`。
- `relativeCalm = 1 - runMed/preMed`、`absoluteCalm = 1 - runMed/coinVol`、
  `lengthNorm = runLen/16`。
- 8/12 长收敛 ~0.97；8/13 尾巴被门 3 拒。

## probeStructure 集成

- fractal 三角扫描（`classifyStructure` 现仅返回 triangle）照旧。
- `detectConvergence` 跑一次，与最优三角**按分数比大小，谁高谁赢**：
  - 8/12：收敛 0.975 > 假三角 0.855 → 收敛 ✓。
  - 8/13：收敛被绝对安静门拒 → 三角 0.812 ✓。

## 类型与清理

- `ConvergenceStructure = 'triangle' | 'convergence'`（`box` 删除）。
- `classifyStructure` 删除 box 分支（三角-only）；`backscanWindow` 去掉 boxConvergenceData。
- `StructureParams` 删 `maxBoxRelativeHeight`/`minSpanBox`/`preBoxAmplitude`/`boxBarAmplitude`；
  加 `minRun`/`flatRatio`/`convergenceRatio`/`lengthScale`。
- UI `structureLabel`：「箱体」→「收敛」。

## 参数

| 参数 | 默认 | 含义 |
|---|---|---|
| `minRun` | 5 | 段最少 bar 数 |
| `flatRatio` | 1.2 | 平边漂移 ≤ 1.2×coinVol |
| `convergenceRatio` | 0.8 | 段波动 < 前段 80% |
| `lengthScale` | 16 | 长度满分对应 bar 数 |
| absoluteRatio | 0.8 | 段波动 < coinVol 的 80%（绝对安静门，常量） |
