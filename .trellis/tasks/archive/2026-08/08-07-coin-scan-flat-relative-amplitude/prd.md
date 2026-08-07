# 收敛结构-平边判定相对自身振幅(修XRP缓跌误判)

## Goal

修复收敛结构检测的 flat 边误判:XRP 1H 单边缓跌被误判成 falling 三角(score 0.90)。flat 边判定从"相对 mean price 的 drift"改为"相对该币自身振幅"。

## Background / Confirmed Facts

- 当前 flat 边判定(`classifyStructure`):`drift = |slope| × span / meanPrice <= slopeTolerance(0.02)`。
- XRP 1H 误判实况:swings lows=[1.0388, 1.0410, 1.0317, 1.0292],highs=[1.0582, 1.0540, 1.0371, 1.0389]。lows regression drift = 0.9% < 2% → 判平 → 组合成 falling 三角。
- 实际形态:08-06 白天窄带 1.044-1.055,08-07 02:00 后缓跌到 1.02。单边下跌。
- **根因**:drift 容差相对 mean price。XRP 是低波动币(priorAmplitude ≈ 0.56%),0.9% 结构下移占总价比例小,但相对其**自身振幅**是明显趋势(1.6×)。2% 容差对低波动币太宽。
- 用户选定修法:**drift 相对自身振幅**(方向 2)。
- 前身任务 `08-07-coin-scan-convergence-structure` 已归档(含 HEI 深跌毛刺 spread 门修复)。

## Requirements

- R1 flat 边判定改为 `drift / priorAmplitude <= 阈值` 而非 `drift <= slopeTolerance`。
- R2 应用范围:箱体的 high/low 边 + 三角的 flat 边(rising 的 highs、falling 的 lows)。
- R3 阈值作为新常量,默认值使 XRP 案例被拒、现有真箱体/真三角仍过。
- R4 `priorAmplitude` 缺省时(直接单测无蜡烛上下文)回退旧行为,不误伤。

## Acceptance Criteria

- [ ] AC1 XRP 1H 案例(swings lows 缓降 0.9%/0.56% 振幅)→ 返回 null,不再判 falling 三角。
- [ ] AC2 真实箱体(高波动→低波动箱)仍判 box(相对振幅比值远小于阈值)。
- [ ] AC3 真实三角(对称/上升/下降)仍判 triangle,平边相对振幅比值小于阈值。
- [ ] AC4 现有测试全绿 + tsc 干净。
- [ ] AC5 实盘重扫:XRP 不再出现在结果,其余真收敛币保留。

## Open Questions (blocking)

- 无。

## Notes

- 轻量算法门调整,但涉及 domain 契约 + 测试,写 design.md + implement.md。
- 阈值校准:需用 XRP 案例 + 现有真箱体/三角合成数据验证新阈值不误伤。
