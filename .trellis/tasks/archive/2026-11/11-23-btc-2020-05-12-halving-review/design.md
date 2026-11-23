# Design — 热度扫描升级为活跃度粗筛

## 1. 目标与边界

把选品 `heat` 从“市场温度 + 24h涨跌榜”升级为“市场温度 + 单币活跃度工作清单”。算法只负责缩小看图范围，不判断收敛、方向或买卖点，也不要求用户启用标线监控。

保留两条互补路径：

- `shrink`：低波动/横盘候选，覆盖 `position-7 / 22 / 58` 这类低活跃但可能有结构的样本；
- `heat`：放量与波动扩张候选，覆盖高分歧、当前加速或热度后降温的样本。

## 2. 现有问题

- `src/server/market-heat-service.ts:122-123` 仅按24h净涨跌取双侧前10，不能表达放量、真实波幅或近期节奏；
- `src/domain/market-heat.ts:38` 已保存 `windowQuoteVolume`，但只用于展示，没有相对自身基线；
- `src/ui/HeatScanResults.tsx` 目前只是复用市场温度视图，没有独立工作清单；
- 仅成交额 Top80 会漏掉排名稍后、但正在放量或扩张的币。

## 3. 架构与数据流

```text
TickerSource.listTickers()
  ├─ 市场池 = 过滤后 Top80（不变）
  └─ 活跃池 = 过滤后 Top120（新增，测试 poolTopN 同时覆盖两者）
         ↓ 每币并行两类读取（HEAT_CONCURRENCY 保持 3）
  15m × 100：滚动24h收盘、跨度、成交额、最近4h强度
  1D  × 21 ：过滤未完成日线后取最近20个完整日线作基线
         ↓
  HeatRow（旧字段 + 可选活跃字段）
         ├─ 市场 tier/stats/topGainers/topLosers：仍只读 Top80 + review coin
         └─ activityCandidates：Top120 全量排序，null 指标置后
         ↓
  HeatScanResults：前20 + 排序 + 展开 + 看图
  MarketHeatView / MarketHeatPanel：保持原样
```

不新增数据库表，不改变 Candlestick Cache schema；新增日K读取复用同一 `CandleSource`、缓存与限频路径。

## 4. 领域契约

### 4.1 `HeatRow` 新增可选字段

```ts
quoteVolumeRatio20d?: number | null;
rangeRatio20d?: number | null;
activityScore?: number | null;
recent4hVolumeIntensity?: number | null;
```

旧字段 `instrument / changePct / windowQuoteVolume / isReviewCoin` 不变。字段可选只为兼容现有测试和旧调用构造的对象；生产服务在可计算时给数值，不可计算时给 `null`。

### 4.2 `MarketHeatResult` 新增

```ts
activityCandidates?: HeatRow[];
activityPoolSize?: number;
```

- `activityCandidates`：活跃池内有24h数据的全部候选，按 `activityScore` 降序；`null` 置后，同分按 `abs(changePct)` 降序；
- `activityPoolSize`：本次活跃池目标规模，生产默认120，测试显式 `poolTopN` 时与该覆盖值一致；
- `stats.poolSize / coveredCount / tier / topGainers / topLosers` 继续只反映 Top80 + review coin，不混入新增40个候选。

### 4.3 公式

```text
currentQuote = Σ(close × volume) over completed 15m bars in rolling 24h
dailyQuote[d] = close[d] × volume[d] for each of 20 completed 1D bars
quoteVolumeRatio20d = currentQuote / median(dailyQuote)

currentRangePct = (max(high) - min(low)) / firstOpen in rolling 24h × 100
dailyRangePct[d] = (high[d] - low[d]) / open[d] × 100
rangeRatio20d = currentRangePct / median(dailyRangePct)

activityScore = sqrt(quoteVolumeRatio20d × rangeRatio20d)

recent4hVolumeIntensity =
  (quote(last 16 completed 15m bars) / 16) /
  (quote(earlier completed 15m bars in the 24h window) / earlierBarCount)
```

约束：

- 基线只取 anchor 前已完成日线；请求21根以防当前日K未完成，过滤后取20根；
- 当前24h仍使用原 `heatRowFromCandles` 的 completed-bar guard；
- 任一基线缺失、为零、非有限数或历史不足 → 对应比率和 `activityScore = null`；
- `recent4hVolumeIntensity` 在前序K线为空或成交额为零时为 `null`；
- 活跃度只是几何排序量，不映射方向、胜率或交易建议。

## 5. UI 设计

### 5.1 `HeatScanResults`

保留顶部 `MarketHeatView` 的市场温度区域，下面新增「活跃度候选」表格：

| 币 | 活跃度 | 成交额倍数 | 波幅倍数 | 近4h强度 | 24h涨跌 | 24h成交额 | 操作 |
|---|---:|---:|---:|---:|---:|---:|---|

- 默认：`activityScore` 降序，前20；
- 排序：综合活跃 / 成交额倍数 / 波幅倍数 / 24h绝对涨跌；`null` 永远置后；
- 筛选：全部 / 近4h加速 / 近4h降温 / 历史不足，便于区分当前急动与前面活跃后降温；
- 「显示更多 / 收起」在20与全量之间切换；
- 「看图」复用 App 的 `openLevelDrawer(instrument)`，只打开同 `scanSource` 的 `OtherCoinChart`，不要求画线或进入监控；
- 原24h涨跌榜可保留在折叠区，不再作为主要工作清单；
- 明示：`活跃度 = √(成交额倍数 × 波幅倍数)，只表示相对自身活跃，不预测方向。近4h > 1 为加速，< 1 为降温。`

### 5.2 App 与样式

- `App.tsx` 向 `HeatScanResults` 传 `onOpenChart={openLevelDrawer}`；
- `MarketHeatView.showBoards` 默认 true，嵌入活跃扫描传 false，避免重复展示旧涨跌榜；
- 新表格复用 `coin-scan-table` 基础样式，仅补充活跃度标签、排序按钮和数字列样式；
- `MarketHeatPanel` 继续只调用 `MarketHeatView`，不显示新增候选表。

## 6. 兼容与权衡

### 活跃池120而非全市场逐币计算

Top120 给 Top80 以外的新活跃币机会，同时把新基线读取限制在可接受范围。生产每币需要15m + 1D 两类请求，最多约240次请求；仍走原有并发和限频。代价是比原扫描慢，换取更少漏报。当前24h成交额在120名以后的币仍可能漏掉，这是明确的覆盖边界，不声称全市场无遗漏。

### 20个完整日线作基线与实时锚点

相比给每币读取20日15m数据，额外数据量小。滚动24h与完整日线并非完全同形窗口，因此UI和spec必须写“相对过去20个完整日线中位数”，不声称与研究中逐小时滚动基线逐值相同。

实时扫描的15m请求先向下取整到已完成15m边界；1D请求按 `app-plugin` 传入的行情源日界取整：Binance `utc`，OKX/Bitget `shanghai`。这样 OKX 的 earlier-contiguity seed 不会把最新已完成K线或日K整段拒绝。所有24h变化、参考收盘和 completed-bar 判断仍使用原始 anchor。服务测试同时覆盖 UTC 与 Shanghai 日界。

### 历史锚点

现有池由当前 ticker 快照确定，历史锚点没有当时 ticker 排名。此次不改变该限制；历史扫描用于研究字段形态，不用于宣称当时的真实全市场排名或回测命中率。

## 7. 测试策略

### 服务

- 24h与20日基线公式、几何活跃度和近4h强度；
- Top120 活跃候选排序，Top80 tier/stats 不变；
- Top80 外候选进入列表；
- 历史不足、零基线、空K线、anchor 未完成K线；
- 同 anchor 缓存不重复取数、警告和休市逻辑不变。

### UI

- 默认前20、活跃度降序、null 置后；
- 各排序方式、展开/收起；
- 看图回调触发正确 instrument；
- 旧 `MarketHeatView` / `MarketHeatPanel` 测试保持通过。

### 全量

```bash
npx tsc --noEmit
npm test
```

如环境允许，再分别用默认源与 Binance 做一次真实扫描，检查返回字段、候选数量、null 处理和限频警告；网络失败不伪报通过。

## 8. 回滚

1. UI 隐藏活跃候选表即可回到旧热度视图，旧字段和旧市场温度不受影响；
2. 服务端移除活跃池和1D基线请求即可回到原请求量；
3. 无数据库迁移、无用户数据改写、无监控状态迁移，可直接按文件回滚，不需要数据恢复。
