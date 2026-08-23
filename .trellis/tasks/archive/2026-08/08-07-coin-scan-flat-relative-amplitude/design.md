# Design: 平边判定相对自身振幅

## 问题

`classifyStructure` 的 flat 边判定:

```ts
const highDrift = (Math.abs(highLine.slope) * highSpan) / meanHigh;
const lowDrift = (Math.abs(lowLine.slope) * lowSpan) / meanLow;
const highFlat = highDrift <= params.slopeTolerance;  // 0.02
```

drift 是**相对 mean price** 的百分比。低波动币(XRP priorAmp 0.56%)一段 0.9% 的持续缓降,drift 0.9% < 2% → 判平 → 误判 falling 三角。

## 修复

flat 判定改为**相对该币自身振幅**:

```ts
// 平边:边的 net drift 相对自身平均振幅不能太大。
// 相对 mean price 的 2% 对低波动币太宽(0.9% 下移已是其振幅 1.6 倍)。
// 改为 drift / priorAmplitude <= maxFlatDriftRatio。
const prior = params.priorAmplitude;  // probeStructure 已注入
const driftRatio = prior !== undefined && Number.isFinite(prior) && prior > 0
  ? Math.max(highDrift, lowDrift) / prior   // 或分别算 high/low
  : 0;  // prior 缺省时回退(不误伤直接单测)
```

- **新常量** `DEFAULT_MAX_FLAT_DRIFT_RATIO`(建议 1.0 = 边漂移不得超过自身平均振幅的 1×)。XRP 案例:0.9%/0.56% = 1.6 > 1.0 → 拒。真实箱体:箱体边几乎不动,drift ≈ 0 → 过。
- 阈值语义:一条"平边"允许的最大净漂移 = 自身平均振幅的 N 倍。1.0 语义清晰:边漂移超过一个自身振幅就不算平。
- 校准:XRP 需 >1.6 才过门 → 设 1.0 稳拒。但需验证真箱体/三角的平边 driftRatio 远小于 1.0(正常箱体 drift ≈ 0)。

## 应用范围

- **箱体分支**:`highFlat`/`lowFlat` 用新判定(相对振幅)。
- **三角分支**:
  - `rising`(highs flat):highs flat 判定用新逻辑。
  - `falling`(lows flat):lows flat 判定用新逻辑。
  - `symmetric`:无 flat 边,不受影响(highFalling/lowRising 用 drift > tolerance 判定,保持)。
- **highFalling/lowRising 判定**(drift > tolerance)保持用原 slopeTolerance,不改为相对振幅 —— 那是"趋势边"判定,方向性已有单调门兜底。

## 边界

- `priorAmplitude` 缺省(直接 classifyStructure 单测无蜡烛):driftRatio = 0 → 门跳过,回退旧 `drift <= slopeTolerance`。probeStructure 总注入,实盘总是新行为。
- `priorAmplitude` 为 0 或 NaN:同缺省处理。

## 兼容

- 接口不变(StructureParams 加 `maxFlatDriftRatio?` 可选字段 + 新常量导出)。
- 服务层/API/UI 不动。
- 现有测试:真箱体/三角合成数据需验证新门不误伤;若误伤,调整合成数据使其符合真实形态。
