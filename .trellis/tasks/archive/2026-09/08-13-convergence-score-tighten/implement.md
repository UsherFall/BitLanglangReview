# Implement: 纯波动收缩 — 删三角 + band vs 前段 + 统一窗口 + 缓存刷新

## Checklist(全部完成)

### 1. `src/domain/coin-scan.ts` — 删三角 + 重写检测器
- [x] 删除 `detectSwings`/`backscanWindow`/`classifyStructure`/`STRUCTURE_SWING_N`/
      `isBetterStructure`/`SwingPoint`/三角参数与回归辅助(整文件重写)。
- [x] `ConvergenceStructure` 只剩 `'convergence'`;`StructureResult.touchCount` 恒 0(保留契约)。
- [x] 新 `detectConvergence`(band vs 前段):
  - 门槛:G1 flatness(edge 回归漂移 ≤ `flatRatio×runMed`,相对波段自身噪声——兼拒趋势与
    大跌后宽幅喘息)、G2 shrink(`runMed < convergenceRatio×preMed`,0.9)、G3 包含(±10%)。
  - 评分 `0.7×relativeCalm + 0.3×length`(无 coinVol、无绝对阈值)。
- [x] `probeStructure` 转发 `detectConvergence`;`defaultStructureParams` 填
      minRun/convergenceRatio/flatRatio/lengthScale。
- [x] 常量:`DEFAULT_CONVERGENCE_RATIO=0.9`、`DEFAULT_CONVERGENCE_FLAT_RATIO=2.0`、
      `CONVERGENCE_SCORE_CALM_WEIGHT=0.7`、`CONVERGENCE_SCORE_LENGTH_WEIGHT=0.3`。

### 2. `src/server/coin-scan-service.ts` — 统一窗口
- [x] `perTimeframeLimit`(1D=40/其他=100)→ 单值 `SCAN_WINDOW=100`(用户决定跨周期一致)。
- [x] 注释同步(去三角/箱体表述)。

### 3. 缓存过期刷新
- [x] `src/server/binance-candles.ts` + `src/server/candlestick-service.ts`(OKX):
      `isCacheFresh`——「现在」扫描时缓存最新一根落后 anchor 超 2 步即强制刷新;
      历史锚点恒走缓存。

### 4. UI
- [x] `CoinScanPanel.tsx` `structureLabel` 只剩「收敛」;过时注释更新。

### 5. 测试
- [x] `tests/coin-scan.test.ts` 重写(14 用例):band vs 前段入选、无收缩拒、短温和带 <0.7、
      突破拒、前段不足 null、非正价 null、大跌后喘息被检出(已知后果)、温和收缩 <0.7、
      convergenceRatio 严格性、probeStructure 转发、趋势拒、常量/默认参数。
- [x] `tests/coin-scan-service.test.ts` 重写(12 用例):strong/weak/uptrend 三种 bars,
      统一窗口 100、minScore 门(0.5/0.7)、排序、中性零、多周期单行等。
- [x] `tests/binance-candles.test.ts` 新增:缓存过期刷新 + 新鲜复用。

### 6. 真实扫描验证(实时数据)
- [x] 默认 0.7:2 个币(AKE 0.79 / APR 0.72),全为「收敛」,无三角标签。
- [x] minScore 0.5:42 币,BR 出现(0.62,5m/15m/1H/1D 收敛)——BR 是温和收缩,检测器认出,
      被 0.7 门槛隐藏。**用户决定:默认保持 0.7**(宁少勿滥)。
- [x] CBRS 型被 flatness 门解决(edge 漂移 1.04% > 容差 0.85%),未复现为强收敛。
- [x] `npx tsc --noEmit` 干净;全量 **172/172** 通过。

## 校准参考(真实数据)

| 场景 | band/preceding | relativeCalm | 分(0.7/0.3, len 满) | 默认 0.7 显示 |
|---|---|---|---|---|
| BR 5m(现在) | 0.84 | 0.16 | ~0.41 | 否(0.62 为最优带) |
| AKE 1D(强收缩) | ~0.3 | ~0.7 | ~0.79 | 是 |
| 趋势通道 | — | — | flatness 拒 | 否 |

## 回滚点

- 检测器全是文件顶常量,可单点回退。删除的三角导出不再有引用(grep 确认)。
- 缓存 freshness 只在「当前锚点」生效,历史锚点行为不变。
