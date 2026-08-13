# Implement: 窄箱体 (narrow box) detection redesign

## Checklist

### 1. `src/domain/coin-scan.ts` — 参数与常量
- [ ] `StructureParams` 加 `preBoxAmplitude?`、`boxBarAmplitude?`（含 doc）。
- [ ] 加常量 `DEFAULT_PREBOX_LOOKBACK = 40`（前段 lookback 上限）、`BOX_CONVERGENCE` 相关阈值。
- [ ] `defaultStructureParams` 填新默认（若为参数化）。

### 2. box 分支改造（`classifyStructure`）
- [ ] flatness：`highFlat`/`lowFlat` 去掉 `maxFlatDriftRatio` 相对项，回归绝对
      `highDrift ≤ slopeTolerance`。
- [ ] 收敛门替换 `lowVolatility`：`boxBarAmplitude < preBoxAmplitude`（缺省 → 旧行为）。
- [ ] score 重构：`score = w1·flatness + w2·convergence + w3·touch`，权重初值待校准。

### 3. backscan 隔离 + box 优先
- [ ] `isBetterStructure` 加 kind 优先级 `box > triangle`。
- [ ] 验证 backscanWindow Phase 1/2 对 8/12 09:45 隔离出箱体段；若 Phase 1 命中短三角
      优先，加 box 优先处理。

### 4. probeStructure 数据流
- [ ] probeStructure 每个候选计算 `preBoxAmplitude`（段前 min(span,40) bar 均振幅）、
      `boxBarAmplitude`（段内均振幅），注入 classifyStructure。
- [ ] 无前段 bar 时 preBox 缺省 → 收敛门跳过。

### 5. 测试
- [ ] 新增回归：8/12 型窄箱体（收敛对比前段）classify = box 且 score ≥ 0.7。
- [ ] 新增回归：安静币常态（前后波动相当）不误报 box。
- [ ] 新增回归：box 优先于三角（同窗口）。
- [ ] 更新受影响的既有 box fixtures（传 preBox/boxBar 或调整断言）。
- [ ] 全部 tests/coin-scan.test.ts 通过；`npx vitest run` 全量过；`npx tsc --noEmit` 干净。

### 6. 真实数据验证
- [ ] 8/12 04:00-09:30 窗口 classify = box ≥0.7。
- [ ] 8/12 09:45 锚点完整 probe = 15m box。
- [ ] 8/13 00:30 15m 仍 = 三角（不回归）。
- [ ] 附近锚点抽样（8/12 10:00、11:00 等）不异常刷出 box。

## 校准循环

```
对 8/12 box: score 目标 ≥0.7
  调 w1/w2/w3 → 8/12 score
  若未达: 调 narrowness/高度项或 touch scale
验证既有 fixtures score 不失衡
```

## Validation Commands

```bash
npx vitest run tests/coin-scan.test.ts   # 核心
npx vitest run                            # 全量
npx tsc --noEmit                          # 类型
node .scratch/box-verify.mjs              # 真实数据 8/12 box + 8/13 三角
```

## Review Gates

- 每步后跑 `coin-scan.test.ts`。
- 全部完成后跑全量 + tsc + 真实数据三锚点。
- 用户 review 验收后再 commit。
