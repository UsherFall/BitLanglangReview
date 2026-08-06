# 扫描收敛 v3:波动压缩判定

## Goal

v2(scale-free 箱体形状)仍误报:用户扫出 BEAT/UNI 等「收敛程度不够」的币。用户核心诉求(原话):「人眼观察能看出现在的波动明显比之前小,像三角收敛或箱体收敛,快出方向了」。v3 加**波动压缩(volatility compression)**判定——当前波动相对**自己过去**显著变小,并在结果里显示压缩数值让用户自己调阈值。

## Background / Confirmed Facts

- v2 判定:`calm = volumeRatio < ratioThreshold`(量缩);`boxTightness = R/(m√boxWindow) <= 0.9`(箱体形状);已上线、用户认可部分结果。
- 用户反馈:BEAT/UNI 等「看起来振幅过大 / 收敛程度不够」;PUMP/BNB/GRVT 感觉符合「小级别震荡」。
- 实证(5m 快照):boxTightness、单根均幅、压缩比**都无法单维度分开**用户的好/坏样本——用户判断是视觉综合,且数据实时漂移。任何单一公式难完美拟合。
- 关键洞察:用户要的不是「绝对安静」也不是「当前是箱体」,而是「**波动在收窄 = 比之前小**」的**张力**。平躺的币(UNI 式一直安静)没有张力,不算收敛。
- 用户明确:「不能单看百分比的均幅来判断收敛」→ 压缩比是相对自己过去,scale-free。

## 已定决策

| 决策 | 结论 |
| --- | --- |
| 压缩量度 | `compression = meanAmp(recent boxWindow) / meanAmp(prior boxWindow)`;recent/prior 各为相邻等长窗口(默认各 12 根) |
| 阈值 | `maxCompression`(默认 0.8,可调):recent 均幅 ≤ 0.8×prior 均幅 = 波动明显变小 |
| 现有门 | 保留量缩门(volumeRatio);**移除 boxTightness 箱体门**——用户目标「现在在收敛且收敛到极致」由 compression+latestTrend 承担,箱体度不是扫描必选。实证:黄金 4H 收敛窗口 compression 0.18~0.68(达标)却全被 box 1.13~1.81 拒,缓坡压缩不是紧箱体被误杀。 |
| 展示 | 结果表加 **压缩比/收窄趋势** 列,用户肉眼对照调阈值;箱体度列移除 |
| 可调 | compression 阈值、boxWindow、latestTrend 阈值、trendWindow 均可配;不新增绝对百分比判定(用户否了) |
| 边界 | prior 均幅 0 且 recent>0 → 压缩∞ → 拒(醒来不是收敛);双 0 → compression 0,量缩门兜底 |
| 1D 量缩 | 黄金 1D 卡在量缩门(quiet 不足)非 box 门;本任务只去 box,1D 另开任务处理 |

## Requirements

- **R1 domain**(`src/domain/coin-scan.ts`):新增 `compression`(recent/prior 各 boxWindow 根均幅比)与 `latestTrend`(最近 trendWindow 根 / 再前 trendWindow 根 均幅比);`DEFAULT_MAX_COMPRESSION = 0.8`、`DEFAULT_MAX_LATEST_TREND = 0.9`、`DEFAULT_TREND_WINDOW = 4`;`ShrinkScanParams`/`QuietMetricsParams` 加 `maxCompression`/`maxLatestTrend`/`trendWindow`;`qualified &&= compression <= maxCompression && latestTrend <= maxLatestTrend`;`QuietMetrics`/`ScanRow` 加 `compression`/`latestTrend` 字段(哨兵 LARGE_RATIO 防 Infinity)。**移除 boxTightness**:删 `DEFAULT_MAX_BOX_RATIO`、`maxBoxRatio` 参数、`boxTightness` 字段及其 qualified 判定;`boxWindow` 保留(压缩窗口)。
- **R2 service**(`src/server/coin-scan-service.ts`):拉取 limit = `max(window+consecutive, 2*boxWindow) + 1`;参数透传;params 回显三个参数。
- **R3 route**(`src/server/app-plugin.ts`):可选 `maxCompression`/`maxLatestTrend`/`trendWindow` 解析(optional,`<= 0` → 400;trendWindow 超 boxWindow 也 400)。
- **R4 UI**(`src/ui/CoinScanPanel.tsx`):参数区加 `maxCompression`(0.8)、`maxLatestTrend`(0.9)、`trendWindow`(4)输入;结果表加 压缩比/收窄趋势 列。
- **R5 spec**:`.trellis/spec/server/coin-scan.md` 更新契约。

## Acceptance Criteria

- [ ] AC1:`coin-scan.test.ts` — recent 均幅明显 < prior(0.3×)→ compression 过;recent ≈ prior(0.9×)→ compression 拒;prior=0 边界。
- [ ] AC2:`latestTrend` — 最近 T < 再前 T(0.7×)→ 过;≈1(0.93×)→ 拒;>1(1.4×)→ 拒;middle=0 边界。
- [ ] AC3:既有量缩门、compression、排序不回归;boxTightness 不再参与 qualified(移除后黄金 4H 收敛窗口可过);`coin-scan-service.test.ts` 全绿。
- [ ] AC4:结果表显示 压缩比/收窄趋势 列,无箱体度列;三参数可调。
- [ ] AC5:`npm test` 全绿 + tsc 干净。
- [ ] AC6:手动 4H 扫描黄金——收敛窗口应出;5m BEAT 仍对;用户对照两列调阈值。

## Out of Scope

- 三角收敛 vs 单边变缓的精细判别(当前用 boxTightness 近似;后续可加趋势方向分析)。
- 绝对均幅上限(v2 讨论过,用户否了单看百分比;可作为后续可选参数)。
- 底部震荡扫描(另一任务)。
- 箱体末期检测(`08-04-coin-scan-box-end`)。

## Notes

- 复杂任务:prd + design + implement。
- 触碰:`src/domain/coin-scan.ts`、`src/server/coin-scan-service.ts`、`src/server/app-plugin.ts`、`src/ui/CoinScanPanel.tsx`、`tests/coin-scan.test.ts`、`tests/coin-scan-service.test.ts`、`.trellis/spec/server/coin-scan.md`、`.trellis/spec/frontend/component-guidelines.md`。
- 风险:压缩比阈值 + 窗口长度需用户扫描校准;数据漂移导致快照判断不可靠,以用户扫描时刻为准。
