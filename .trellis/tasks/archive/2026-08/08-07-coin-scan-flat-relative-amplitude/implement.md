# Implement: 平边判定相对自身振幅

## 执行顺序

1. **domain(`src/domain/coin-scan.ts`)**:
   - 加 `DEFAULT_MAX_FLAT_DRIFT_RATIO = 1.0` 常量导出 + `StructureParams.maxFlatDriftRatio?` 字段 + `defaultStructureParams` 填充。
   - `classifyStructure`:flat 判定改为相对 priorAmplitude。箱体 high/low 边、三角 rising 的 highs / falling 的 lows 用新判定。priorAmplitude 缺省时回退旧 `drift <= slopeTolerance`。
   - highFalling/lowRising 保持原逻辑(趋势边方向性,单调门兜底)。

2. **测试(`tests/coin-scan.test.ts`)**:
   - **XRP 回归**:精确 swings(lows [1.0388,1.0410,1.0317,1.0292], highs [1.0582,1.0540,1.0371,1.0389])+ priorAmplitude 0.0056 + currentIndex → classifyStructure null。
   - **真箱体仍过**:现有 box 合成(高波动→低波动箱)验证新门不误伤。
   - **真三角仍过**:对称/上升/下降三角合成验证平边 driftRatio 小于阈值。
   - **边界**:driftRatio 恰 = 阈值过,> 阈值拒。
   - **priorAmplitude 缺省**:回退旧行为,现有无 prior 的单测仍绿。

3. **验证**:`npx tsc --noEmit` + `npm test` 全绿。

## 验证命令

```bash
npm test
npx tsc --noEmit
```

## 后续检查

- [ ] 实盘重扫:XRP 消失,其余真收敛保留。
- [ ] 阈值 1.0 若误伤真箱体/三角,回退到更高值(如 1.5)并记录。
