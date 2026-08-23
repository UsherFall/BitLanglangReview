# 扫描收敛 v5:纯价格收敛(彻底移除交易量)— Design

## 架构总览

从「量缩 + 压缩 + 收窄」三信号 → **纯价格两信号**:`compression` + `latestTrend`。交易量相关(volumeRatio/calm/consecutiveQuiet/intensity/量比列/连续平静列)彻底移除。boxWindow 默认缩小,捕捉短期收敛。

```
computeQuietMetrics(completed bars)
  → compression = meanAmp(recent boxWindow) / meanAmp(prior boxWindow)
  → latestTrend = meanAmp(latest trendWindow) / meanAmp(middle trendWindow)
  → qualified = compression <= maxCompression && latestTrend <= maxLatestTrend
  → score = compression + latestTrend(排序,小=收敛强)
```

## 领域模型变更

### `computeQuietMetrics` 简化

当前实现(量+价混合)改为纯价格:

```ts
// 移除:volumeAverages / volumeRatios / amplitudeRatios / calm / consecutiveQuiet /
//       intensity / currentVolume / averageVolume / ratio / amplitudeRatio
// 保留:compression / latestTrend / qualified(两门)

export type QuietMetrics = {
  compression: number;      // meanAmp(recent boxWindow)/meanAmp(prior boxWindow); LARGE_RATIO 哨兵
  latestTrend: number;      // meanAmp(latest trendWindow)/meanAmp(middle); LARGE_RATIO 哨兵
  score: number;            // compression + latestTrend(排序基准,小=收敛强)
  qualified: boolean;       // compression <= maxCompression && latestTrend <= maxLatestTrend
};
```

`computeQuietMetrics` 签名简化为:

```ts
computeQuietMetrics(candles, { boxWindow, maxCompression, maxLatestTrend, trendWindow }): QuietMetrics | null
```

- 移除参数:`ratioThreshold`、`consecutive`、`window`(不再需要)。
- 数据不足守卫:`count < 2 * boxWindow || count < 2 * trendWindow` → null(移除 `window + consecutive`)。
- 不再需 volume 窗口均 > 0 检查(无 volume)。仅保留 `low <= 0` 价格检查。
- LARGE_RATIO 哨兵逻辑保留(prior/middle 均幅 0 边界)。

### `ScanRow` 字段

```ts
export type ScanRow = {
  instrument: string;
  lastPrice: number;
  change24h: number;
  quoteVolume24h: number;      // 保留:来自 ticker,用于 minQuoteVolume24h 流动性过滤
  compression: number;
  latestTrend: number;
  score: number;               // 排序用
  qualified: boolean;
};
```

移除:`currentVolume/averageVolume/ratio/amplitudeRatio/intensity/consecutiveQuiet`。

### 参数

`ShrinkScanParams` 保留:`timeframe/topN/minQuoteVolume24h/boxWindow/maxCompression/maxLatestTrend/trendWindow`。
移除:`ratioThreshold/consecutive/window`。

**默认值调整**(捕捉短期收敛):
- `DEFAULT_BOX_WINDOW = 4`(原 12 — 12 根日线稀释短期收敛)
- `DEFAULT_MAX_COMPRESSION = 0.8`(不变)
- `DEFAULT_MAX_LATEST_TREND = 0.9`(不变)
- `DEFAULT_TREND_WINDOW = 2`(原 4 — 跟随小 boxWindow)

> **权衡**:boxWindow 12→4 全局变化。5m/1H 下小窗口 = 只要求「最近 4 根比前 4 根缩」,更敏感更短视。原 12 根 12 天对日线太长。全局默认 4 可能让 5m 更易收敛(短窗口),需验收观察。用户可调 boxWindow。

## 排序

`intensity`(量+振幅比)移除。新排序基准 = `score = compression + latestTrend`(两者都小 = 收敛强),升序。收敛最强的排最前。

- 权衡:compression 与 latestTrend 同量纲(均幅比),可相加。qualified 池内按 score 排;未 qualified 的也显示但排后面(score 仍可比)。
- `ScanResponse.scanned` 排序:`score` 升序。

## 路由 / service

- `app-plugin.ts`:移除 `ratioThreshold/consecutive/window` 解析。保留 `boxWindow/maxCompression/maxLatestTrend/trendWindow`。
- `coin-scan-service.ts`:limit 公式 `max(window+consecutive, 2*boxWindow)+1` → `2*max(boxWindow, trendWindow)+1`(不再有 window/consecutive)。简化。形成 bar 过滤不变。

## UI

`CoinScanPanel.tsx`:
- 移除输入:`量比阈值(ratioThreshold)`、`连续根数(consecutive)`、`均量窗口(window)`。
- 移除列:`量比`、`当前量`、`均量`、`振幅比`、`强度分`、`连续平静`。
- 保留:扫描数量/压缩窗口/压缩阈值/收窄阈值/趋势窗口/最低成交额。
- 保留列:币/最新价/24h涨跌/成交额/压缩比/收窄趋势/状态/操作。

## 兼容 / 回滚

- **破坏性**:参数表删 3 个(`ratioThreshold/consecutive/window`)、ScanRow 删 6 字段、UI 删 3 输入 + 6 列。单客户端可接受。
- **回滚点**:`src/domain/coin-scan.ts`(核心语义)、`src/server/app-plugin.ts`(参数)。各可单提交回滚。
- 默认 boxWindow 12→4 影响所有周期判定,验收重点。
- 测试:`tests/coin-scan.test.ts` 大改(移除量相关用例,新增纯价格用例)、`tests/coin-scan-service.test.ts` 适配新参数/字段。

## 关键权衡

- **移除量 = 更纯粹的价格收敛**:符合用户「看裸K」。代价:失去「蓄力」信号(量缩常预示突破),纯价格可能把「长期低波动但无方向」的也选进。用户明确接受。
- **boxWindow 12→4**:捕捉短期收敛(黄金日线 4 天横盘)。代价:更短视,5m/1H 更敏感。可调。
- **score = comp+trend 排序**:简单可解释。代价:未 normalized 权重,若用户想突出某信号需加权(后续)。
