# Design: 纯波动收缩 — band vs 前段,删三角,统一窗口,缓存刷新

## 边界

- `src/domain/coin-scan.ts`:删除三角相关(swing/backscan/classifyStructure/STRUCTURE_SWING_N/
  isBetterStructure/三角参数),重写 `detectConvergence`。
- `src/server/coin-scan-service.ts`:窗口统一为单值常量。
- `src/server/binance-candles.ts`:缓存过期刷新。
- `src/ui/CoinScanPanel.tsx`:`structure` 只可能 `'convergence'`,UI「收敛结构」列恒显示
  收敛——若代码里还有三角 label 分支一并清理。

## 新 detectConvergence(纯 band vs 前段)

```
对每个候选带 [start, last] (runLen = last-start+1, >= minRun):
  band      = bars[start..last]
  preceding = bars[start-runLen..start)      // 同长度、紧邻在前
  runMed = median(band 每根单根波动)
  preMed = median(preceding 每根单根波动)

门槛:
  G1 收缩:  runMed < convRatio × preMed        // 比前段安静;convRatio 默认 0.8
  G2 包含:  lastPrice 在 [band低, band高] ±10% 内 // 未突破
  (无 flatness 门 —— 用户只要求波动对比;无 coinVol —— 无绝对/自身基线)

评分(平静主导):
  relativeCalm       = clamp01(1 - runMed / preMed)
  lengthContribution = clamp01(runLen / lengthScale)
  score              = clamp01(0.7 × relativeCalm + 0.3 × lengthContribution)
```

相对前段对比的意义:强收缩(带 ≪ 前段)拿高分;带 ≈ 前段不入选。**已知后果:CBRS 型
「大跌后喘息」(带 0.43 vs 前段 1.33 = 0.32)会被判为强收缩**——用户前轮称其为垃圾;
本轮用户选择纯 band vs 前段,故先按此实现,真实扫描结果里标注,由用户决定是否加排除。

## 评分校准预期

| 案例 | 带/前段 | relativeCalm | 分(0.7/0.3, 长度满) | 说明 |
|---|---|---|---|---|
| BR 5m(现在) | 1.04/1.24=0.84 | 0.16 | ~0.41 | 温和收缩,分低 |
| 强收缩(带=前段一半) | 0.5 | 0.5 | ~0.65 | 达标附近 |
| 3× 收缩 | 0.33 | 0.67 | ~0.77 | 强 |
| 带≈前段 | ~1 | ~0 | ~0.3(仅长度) | 不入选 |

门槛(convRatio 0.8)与分数诚实地把温和收缩排在低位;用户看过真实扫描后定 minScore。

## 统一窗口

`perTimeframeLimit` 改为单值 `DEFAULT_SCAN_WINDOW = 100`(5m/15m/1H/4H/1D 同)。
窗口需容下 band + preceding(min 2×minRun,实际带可到窗口一半)。

## 缓存过期刷新(binance-candles.ts)

现状:`cached.length >= limit` 即返回缓存,不刷新 → 扫描「现在」用陈旧 K 线。

修复:方向为 `earlier` 且锚点接近当前(`anchor > now - 2×step`)时,若缓存最新一根
`anchor - newest > 2×step` 则视为过期,强制拉取刷新后返回;否则(历史锚点)走缓存。
```
async getCandlesticks(request):
  cached = listCached(request)
  if cached.length >= limit and isFresh(request, cached): return cached
  ...拉取 + save + 返回

isFresh(request, cached):
  if request.direction !== 'earlier': return true
  step = timeframeMs(request.timeframe)
  if request.anchor <= Date.now() - 2*step: return true   // 历史锚点
  newest = cached[last]?.timestamp ?? 0
  return request.anchor - newest <= 2*step                 // 缓存覆盖到当前边界
```

## 兼容与清理

- 删除 `ConvergenceStructure` 的 `'triangle'`;`StructureResult.structure` 类型收窄。
- 删除三角参数(slopeTolerance/touchMin/maxRecentBars/minSpanTriangle/structureTolerance/
  boxRangeTolerance/maxFlatDriftRatio/priceToleranceFloorRatio/lastPrice/priorAmplitude/
  currentIndex/…)以及 `detectSwings`/`backscanWindow`/`classifyStructure`/`STRUCTURE_SWING_N`/
  `isBetterStructure`/`SwingPoint`/回归辅助。`probeStructure` 简化为只调 `detectConvergence`。
- `edgeDrift`/`median` 等工具保留(detectConvergence 用)。
- 缓存修复仅动 `binance-candles.ts`;OKX candleService 也有相同缓存逻辑吗?实现时核对
  `candlestick-service.ts`,如相同问题一并处理或注明。
