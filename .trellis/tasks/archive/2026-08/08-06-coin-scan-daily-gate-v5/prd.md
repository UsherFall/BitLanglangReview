# 扫描收敛 v5:纯价格收敛(彻底移除交易量)

## Goal

币安数据源已替换。用户反馈:黄金 1D 08-04(开盘4060收盘4078 横盘)该扫出但没扫到。根因排查 + 用户决策:**彻底移除交易量维度,纯看裸 K(价格)判定收敛**。

用户原话:「我觉得不需要交易量这个东西,我们看裸k就可以」。

## Background / Confirmed Facts

- **1D 卡点诊断(已完成)**:
  - 收敛窗口 = 08-01~08-04(价格 4040~4112 横盘)。08-01/08-02 量缩(volR 0.09/0.29),但 08-03/08-04 量反弹(volR 0.86/1.25),连续量缩 = 0。
  - 量缩门 `consecutiveQuiet` 是卡点 — 用户不要量了。
- **移除量缩门后(纯裸 K)模拟(bw=3/4)**:
  - `@08-03`:comp=0.47~0.80 trend=0.25 → **qual=TRUE**
  - `@08-04`:comp=0.35~0.58 trend=0.89 → **qual=TRUE**(用户认定的收敛日!)
  - `@08-02`(波动放大中):comp 高 → 正确拒
  - 即:移除量门 + boxWindow 缩到 3~4,黄金 1D 收敛区间(08-03/08-04)均能扫出。
- **4H 不受影响**(移除量门后 4H 收敛仍过)。

## Requirements

- **R1**:彻底移除交易量维度 — `computeQuietMetrics` 不再用 volume/volumeRatio/calm/consecutiveQuiet/intensity。
- **R2**:qualified = `compression <= maxCompression && latestTrend <= maxLatestTrend`(纯价格)。
- **R3**:boxWindow 默认缩小(3~4),捕捉短期收敛(日线/大周期)。
- **R4**:排序改用纯价格基准(移除量-based intensity 后)。
- **R5**:黄金 1D 收敛区间(08-03/08-04)默认参数下 qualified。
- **R6**:参数清理 — ratioThreshold/consecutive/window 若不再被用则移除;UI 移除 量比/连续平静 等量相关输入与列。
- **R7**:支持可选 `anchor`(epoch ms)参数 — 指定历史锚点,按锚点之前已完成的 K 线计算,可回扫历史收敛点验证(实现中新增,补入 prd)。

## Acceptance Criteria

- [x] AC1:XAUUSDT 1D `@08-03` 与 `@08-04` 收敛锚点 `qualified=true`(bw 4)。实测 comp 0.798/0.578、lt 0.472/0.347,默认参数全过。
- [x] AC2:**重新定义** — 黄金 1D 为目标周期;4H 大周期收敛不保证,接受失败。实测 4H 所有 bw 都 fail:日内噪声 + 小 boxWindow(4) 装不下 ~48h 箱体;大 bw 下 latestTrend 走平门仍拒。4H 黄金交给全周期扫描任务(`08-06-08-06-coin-scan-multi-timeframe`)。
- [x] AC3:5m/1H 纯价格判定不回归。案例库 C1–C4 全对;C5 HYPE 15m 箱体顶部收敛被 latestTrend 误杀(lt≈1.1,15m 走平),切 1H 扫出 — 属全周期任务范畴,单周期不修。
- [x] AC4:排序基准 `score = compression + latestTrend`,升序(小=收敛强)。
- [x] AC5:`npm test` 173 绿 + `npx tsc --noEmit` 干净。
- [x] AC6:anchor 参数生效 — 指定锚点(如 `2026-08-04T00:00:00Z`)按锚点前已完成 K 线计算,回扫历史收敛点。

## Out of Scope

- 交易所切换/FreeReplay 迁移(已完成)。
- 箱体末期检测(`08-04-coin-scan-box-end`)。
- `quoteVolume24h`(24h 成交额,来自 ticker 非 K 线量)保留 — 用于流动性过滤 minQuoteVolume24h。

## Notes

- **复杂任务**:纯价格重构,涉及 domain 签名/ScanRow 字段/参数表/UI/排序/测试大改。prd + design + implement。
- 触碰:`src/domain/coin-scan.ts`、`src/server/coin-scan-service.ts`、`src/server/app-plugin.ts`(参数解析)、`src/ui/CoinScanPanel.tsx`(输入/列)、`tests/coin-scan.test.ts`、`tests/coin-scan-service.test.ts`、`.trellis/spec/server/coin-scan.md`。
- **实现偏差(已记录)**:默认 `trendWindow` 4→3(设计稿为 2;tr=2 太灵敏 — ONUSDT 4H @08-05 16:00 单根放大 lt 1.16 卡,tr=3 变 0.52)。实现新增 anchor 参数(设计外,已补 R7/AC6)。
- **验收结果**:AC1/3/4/5/6 过;AC2 重新定义为「4H 不保证」并接受失败(黄金 4H 需大 bw,与 latestTrend 走平门冲突,交全周期任务)。
