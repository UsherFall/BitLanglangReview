# fix: triangle price-inside tolerance collapses at near-apex convergence

## Goal

修复三角结构的「价格在结构内」门：当前 bar 两条趋势线接近相交（width→0）时，
容差 `0.1 × width` 随 width 塌成 ~0，把接近完全收敛（apex 就在当前 bar）的三角
误判为「已走完」。接近收敛的三角本是最强蓄力，应放行。

触发场景（真实数据，Binance MUUSDT 15m，8/13 00:30 +08）：
- 上升三角候选：平顶 926–932 + 抬高低点 887→921，span 17 ≥ 13，flat-side range 过，
  边有效性过。
- 但当前 bar width ≈ 0.02，旧容差 = 0.002；当前价 924.11 距下轨 2.56 → 被拒为「已突破」。

## Requirements

1. 三角「价格在结构内」门容差增加地板，不随 width→0 塌陷。
2. 地板基准 = 该币自身每根平均振幅（priorAmplitude × lastPrice），与既有
   `maxFlatDriftRatio` 相对自身振幅的哲学一致。取 1.0×（一根平均 K 的毛刺余量）。
   - 真突破（价格离 apex 移动数根 K）仍拒绝；仅吸收 apex 附近的正常 1–2 根毛刺。
3. 地板为新校准旋钮，进 `StructureParams` + `defaultStructureParams`（如 `slopeTolerance`
   等既有旋钮），保持内部可调、测试可直接传入。
4. `priorAmplitude` 缺省时（直接 classify 单测无 candle 上下文）退回旧行为
   `0.1 × width`，向后兼容。
5. 不改 `widthCurrent <= 0` 的已走完门（apex 已在当前 bar 之后才拒绝），不改
   `minSpanTriangle`，不改 box 分支（box 另行讨论）。

## Acceptance Criteria

- [ ] 对 8/13 00:30 +08 Binance MUUSDT 15m，`probeStructure` 返回 triangle（当前 null）。
- [ ] 新增合成回归测试：近 apex（width 小但 > 0）三角、当前价略破下轨（在 1.0×prior×lastPrice
      内）→ classify 为 triangle；同几何但不带 priorAmplitude → 维持旧行为。
- [ ] 已有 tests/coin-scan.test.ts 全部通过（floor 只放松不收紧，已有拒绝用例依赖
      width/edge/range/recency 门，不受影响）。
- [ ] 真突破回归不受损：当前价距 apex 超数根 K 时仍 reject。

## Notes

- 属轻量任务，PRD-only。改动集中在 `src/domain/coin-scan.ts` 三角分支 + 1 个常量/参数。
- box 分支的 0.1×boxHeight 容差本次不动；「窄箱体收敛」需求另开讨论。
