# 收敛检测重构:纯波动收缩,删三角,无自身典型

## Goal

把「选币」检测重构为**纯波动率收缩**模型:扫描只看「安静带 vs 前段」的相对波动对比,
删除 fractal 三角模块,不做币自身典型回看,跨周期统一窗口。同时修复扫描数据缓存过期问题。

## Requirements (用户 8/13 晚确认)

1. **删除三角模块**:`detectSwings`/`backscanWindow`/`classifyStructure`(fractal 三角)
   完全移除,结构类型只保留 `convergence`。
2. **不做「币自身典型」回看**:不要 coinVol 基线,不做绝对波动阈值。
   「波动率越来越小」= **安静带中位数波动 < 前段同长度中位数波动**(相对前段对比)。
3. **回看窗口跨周期统一**:不随 5m/15m/1H/4H/1D 变化(原来 1D 用 40,其余 100)。
4. **缓存过期修复**:扫描「现在」时,若缓存最新一根 K 线已过期(超过一个周期),强制
   从交易所刷新,不返回陈旧数据。历史锚点(过去时刻)不受影响。
5. 评分平静主导(相对安静度 + 长度),无绝对阈值。

## Acceptance Criteria

- [x] 三角相关导出(`detectSwings`/`backscanWindow`/`classifyStructure`/`STRUCTURE_SWING_N`
      及三角参数)从 `coin-scan.ts` 删除;`ConvergenceStructure` 只剩 `'convergence'`。
      UI `structureLabel` 只剩「收敛」。
- [x] `detectConvergence` 只用 band vs preceding 相对对比(shrinh 门 + flatness 门 + 包含门),
      无 coinVol、无绝对阈值。
- [x] 每周期同一窗口(SCAN_WINDOW=100,5m~1D 一致)。
- [x] 缓存过期后扫描「现在」强制刷新(Binance + OKX 两处);历史锚点仍走缓存。
      新增 binance-candles 回归测试。
- [x] 全量测试 **172/172** + `npx tsc --noEmit` 干净;新增回归:band vs 前段收缩入选、
      前段相同拒绝、趋势被 flatness 拒、缓存过期刷新。
- [x] 真实扫描(实时数据)验证:三角标签消失,结果全为「收敛」。默认 0.7 只剩 2 个强收缩
      (AKE 0.79 / APR 0.72);BR 是温和收缩(0.62,4 周期),检测器认出但被 0.7 门槛隐藏,
      用户可手动调低。**用户决定:默认保持 0.7**。CBRS 型被 flatness 门意外解决
      (edge 漂移超容差),无需单独排除——已验证。

## Notes

- 前一轮已完成:评分从「长度主导 0.85」改为「平静主导 0.7/0.3」、删除了 relativeCalm 与
  前段门槛——本轮按用户最新指示改为「纯 band vs 前段」并删三角。部分前轮改动被本轮取代。
- 缓存过期是新发现的问题(8/13):`binance-candles.ts` 缓存满 100 根即不再刷新,
  重复扫描「现在」返回陈旧 K 线。
