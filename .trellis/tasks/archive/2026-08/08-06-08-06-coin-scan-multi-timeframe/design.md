# 扫描全周期收敛(每币一行 + 收敛周期列)— Design

## 架构总览

单周期扫描 → **全周期扫描(唯一模式)**。一次点扫描跑 5 个周期(5m/15m/1H/4H/1D),结果**每币一行**,显示「收敛周期」列(如 `1H`、`1H,4H`)。每周期判定沿用纯价格门(compression + latestTrend),**plateau 多窗口连续收敛**滤孤立误报。解决案例库 C5:「15m 走平扫不出,切 1H 就扫出」—— 每币在自然周期显形,不改 latestTrend。

**用户决策(2026-08-06)**:多周期替换单周期,是唯一模式。timeframe 选择器移除,校准靠行内展开看各周期 comp/lt。

```
点扫描
  → ticker 拉一次 → filter minQuoteVolume24h → topN(按成交额)
  → 每周期 × 每币拉 K(limit 13,并行池,缓存去重)
  → 每 (币, 周期): computePlateau(扫 bw∈{3,4,5,6},plateau≥2 连续合格)
  → 每币一行:任一周期 qualified 即出现,收敛周期列 = qualified 周期集
  → 排序:qualifiedCount 降序,再 bestScore 升序
```

## 领域模型变更

### 新增 plateau(多窗口连续收敛)

`computeQuietMetrics` 保持不变(单 bw 纯价格门)。新增 `computePlateau`,对同一组已完成 K 线扫多个 bw,取「连续合格窗口数」:

```ts
export const PLATEAU_BOX_WINDOWS = [3, 4, 5, 6] as const;   // 扫的 bw 集(固定)
export const DEFAULT_PLATEAU_MIN = 2;                       // 连续 ≥2 窗口合格

export type PlateauWindow = {
  boxWindow: number;
  compression: number;
  latestTrend: number;
  score: number;
  qualified: boolean;
};

export type PlateauResult = {
  windows: PlateauWindow[];     // 按 PLATEAU_BOX_WINDOWS 顺序
  plateauWidth: number;         // 最长连续 qualified 窗口数
  compression: number;          // 最佳窗口(bestBoxWindow)的 comp
  latestTrend: number;          // 最佳窗口的 lt
  score: number;                // 最佳窗口的 score
  bestBoxWindow: number;        // qualified 窗口里 score 最小者;无 qualified 则全窗口 score 最小者
  qualified: boolean;           // plateauWidth >= plateauMin
};

export function computePlateau(candles, params: PlateauParams): PlateauResult | null
```

- **每 bw 的 trendWindow**:`tr(bw) = min(trendWindow, boxWindow)`。bw=3 + 默认 tr=3 → latest 窗口 == recent、middle == prior,`latestTrend == compression`(退化,bw3 由 compression 门承载)。**实测确认**:bw=3 用 tr=2 太灵敏(HYPE 1H lt 0.905>0.9 险挂,单根放大翻转判定);用 tr=3 精确复现案例库(comp/lt 数值全对)。bw=4→3、bw=5→3、bw=6→3 不变。
- **每 bw 判定**:`computeQuietMetrics(candles, { boxWindow: bw, maxCompression, maxLatestTrend, trendWindow: tr(bw) })`;不足历史/非正价格 → null → 该 bw 计为不 qualified(不进连续段)。
- **plateauWidth**:`windows` 中 qualified 的**最长连续**子段长度(prd R3「连续 ≥2 窗口」)。
- **qualified**:`plateauWidth >= plateauMin`。
- **最佳窗口**:qualified 窗口里 `score` 最小者(展示 comp/lt/score/bestBoxWindow)。qualified 窗口的 comp/lt 必 ≤ 阈值,score 必有限(LARGE_RATIO 不会被 qualified),bestScore 不溢出。
- **plateau 需要的历史**:最大 bw=6 → 需 ≥ 2×6=12 根已完成 K 线。取 13 根去 forming = 12 根。不足的周期(如 1D 只上市 8 天)bw=5/6 窗口 null → 天然不参与连续段,不误伤小 bw 合格。

### `ShrinkScanParams` 变更

```ts
export type ShrinkScanParams = {
  method: 'shrink';
  topN: number;
  minQuoteVolume24h: number;
  anchor?: number;              // epoch ms;缺省 now
  maxCompression?: number;      // 缺省 0.8
  maxLatestTrend?: number;      // 缺省 0.9
  trendWindow?: number;         // 缺省 3;每 bw tr = min(tr, bw-1)
  plateauMin?: number;          // 缺省 2;≥1
};
```

**移除**:`timeframe`、`boxWindow`。**新增**:`plateauMin`。`DEFAULT_BOX_WINDOW` 仍导出但不再被路由/服务使用(plateau 内部扫固定 bw 集);保留不删避免破坏外部引用?→ **删**。`scanTimeframes` 保留(全周期就是它)。

> 决定:移除 `DEFAULT_BOX_WINDOW` 导出。旧 UI/测试若引用 → 一并改。单客户端可接受破坏性变更。

### `ScanRow` / `ScanResponse` 变更

```ts
export type ScanTimeframeResult = {
  timeframe: ReviewTimeframe;   // '5m'|'15m'|'1H'|'4H'|'1D'
  compression: number;
  latestTrend: number;
  score: number;
  plateauWidth: number;
  bestBoxWindow: number;
  qualified: boolean;           // plateauWidth >= plateauMin
};

export type ScanRow = {
  instrument: string;
  lastPrice: number;
  change24h: number;
  quoteVolume24h: number;
  timeframes: ScanTimeframeResult[];        // 全 5 周期,按 scanTimeframes 序
  convergenceTimeframes: ReviewTimeframe[]; // qualified 子集(收敛周期列数据源)
  qualifiedCount: number;
  bestScore: number;            // qualified 周期里 score 最小者;行必 ≥1 qualified → 恒有限
  qualified: boolean;           // qualifiedCount >= 1(恒 true,兼容保留)
};

export type ScanResponse = {
  scanned: ScanRow[];           // 只含收敛的币(≥1 周期 qualified)
  qualifiedCount: number;       // = scanned.length
  params: ShrinkScanParams;
  scannedAt: string;
};
```

**决定:scanned 只含收敛币**(prd R2「币在任一周期收敛即出现」)。非收敛的 topN 池不显示 — 宁少勿滥,和用户口径一致;行内展开看各周期数值,校准靠它。不再有扁平 `compression/latestTrend/score` 顶层字段 → 移入 `timeframes[]`。

## 排序

`scanned.sort`:先 `qualifiedCount` 降序(多周期收敛优先),再 `bestScore` 升序(同周期数里收敛最狠的在前)。UI 不再重复排序(服务已排好)。

## 路由 / service

### app-plugin.ts

- 删 `timeframe` 解析 + `timeframe must be one of...` 校验 + `boxWindow` 解析 + `trendWindow <= boxWindow` 校验。
- 增 `plateauMin` 解析(optional,≥1 校验)。
- `trendWindow` 校验简化为 `>= 1`(tr≤bw 由 computePlateau 内部处理)。
- 调 `scanShrink` 传新 params。

### coin-scan-service.ts — 全周期聚合

```
scanShrink(params):
  tickers = tickerSource.listTickers()
  top = filter(quoteVolume24h >= minQuoteVolume24h).slice(0, topN)
  anchor = params.anchor ?? now
  // 拉 K:每 (币, 周期) 一任务,并行池(并发 ~10);candle 源自带缓存,重复扫描去重
  tasks = top.flatMap(coin => scanTimeframes.map(tf => ({coin, tf})))
  results = await mapLimit(tasks, 10, async ({coin, tf}) => {
    candles = candleSource.getCandlesticks({
      instrument: coin.instrument, timeframe: tf, anchor,
      direction: 'earlier', limit: 2*max(PLATEAU_BOX_WINDOWS)+1,   // = 13
    });
    completed = candles.filter(c => c.timestamp + timeframeMs(tf) <= anchor);  // 按时间去 forming
    return { coin, tf, plateau: computePlateau(completed, params) };
  })
  // 聚合行
  for coin in top:
    tfResults = scanTimeframes.map(tf => toScanTimeframeResult(results, coin, tf))  // plateau null → qualified false
    converged = tfResults.filter(r => r.qualified)
    if (converged.length === 0) continue
    rows.push({ ...coin fields, timeframes: tfResults, convergenceTimeframes: converged.map(tf), qualifiedCount, bestScore: min(converged.score), qualified: true })
  rows.sort((a,b) => b.qualifiedCount - a.qualifiedCount || a.bestScore - b.bestScore)
  return { scanned: rows, qualifiedCount: rows.length, params, scannedAt }
```

- **limit 13**:`2*max(3,4,5,6)+1`。去 forming 后 12 根,满足 bw=6 需 12。每周期独立去 forming(anchor 应用到各周期,prd R5)。
- **性能(R6)**:首次 250 次 K 拉取(topN=50×5),并行池并发 10 → ~28 轮 × ~150ms ≈ 4-5s < 15s;缓存后秒回。ticker 只拉一次。
- **数据量**:250×13 根,微。

## UI

### CoinScanPanel.tsx(参数区)

- **删**:`时间周期` 下拉、`压缩窗口(boxWindow)` 输入。
- **增**:`连续收敛窗口(plateauMin)` 输入(min 1,默认 2)。
- **保留**:扫描数量/压缩阈值/收窄阈值/趋势窗口/最低成交额/扫描时间点。
- 扫描 query:删 `timeframe`/`boxWindow`,加 `plateauMin`。

### CoinScanResults.tsx(结果表)

- 列:`币 | 最新价 | 24h 涨跌 | 成交额 | 收敛周期 | 状态 | 操作`。
  - 收敛周期:`row.convergenceTimeframes.join(', ')`,空 → `—`(行必非空,理论不发生)。
  - 状态:`合格`。
- **展开行(R4)**:点「详情」按钮(或币名)切换子行,显示该币各周期明细表:`周期 | 压缩比 | 收窄趋势 | score | 窗口(bestBw) | plateau宽 | 状态`。未合格周期也显示(灰),校准用。
- 表头:`扫描 {scanned.length} 个 · 收敛 {qualifiedCount} 个 · 全周期`。

### styles.css

- `.coin-scan-detail-row` / 展开行样式(子表、缩进、qualified 高亮)。

## 兼容 / 回滚

- **破坏性**:route 删 `timeframe`/`boxWindow`、响应 ScanRow 顶层扁平字段移入 `timeframes[]`、UI 删选择器/压缩窗口。**唯一调用方是 CoinScanPanel** → 单客户端,可接受。FreeReplay/TradeReview/alert 不碰 `/api/scan`。
- **回滚点**:`src/domain/coin-scan.ts`(computePlateau + 类型)、`src/server/coin-scan-service.ts`(聚合)。各可单提交回滚。
- **DEFAULT_BOX_WINDOW 删除**:旧测试若引用 → 同步改;避免死导出。
- **测试**:`tests/coin-scan.test.ts` 加 computePlateau 单测、`tests/coin-scan-service.test.ts` 改多周期聚合、旧用例适配新类型。

## 关键权衡

- **替换而非并存**:用户决策。代价:单周期微调(只看 1 个周期)不再直接可用;补偿:行内展开看各周期数值,阈值校准仍可。减少契约面(少一个 mode 维度)。
- **plateau 扫 bw∈{3,4,5,6} 固定**:案例库验证:好案例连续宽 2~3(C1/C2 {3,4} 宽2、C3 {3,4,5} 宽3),坏案例 C4 孤立 0 → 宽 2 阈值天然区分。不暴露 bwRange 参数,避免过度调参;plateauMin 暴露,用户可调(≥1 即退化回单窗口)。
- **每 bw 独立 tr(bw)=min(tr,bw-1)**:避免 bw=3/tr=3 退化;保持 tr 语义「latest 窗口比 middle 窄」。代价:小 bw 的 tr 更小,更灵敏 — 但 plateau 连续段要求抵消单窗口灵敏。
- **scanned 只含收敛币**:结果更聚焦(宁少勿滥)。代价:看不到「接近收敛」的池;需要时后续加「显示全部」开关,不在本任务。
- **排序 qualifiedCount 优先**:多周期收敛 = 更强信号(跨周期一致 = 真收敛)。bestScore 平局决胜。
- **黄金 4H(F3)仍不保证**:多周期模式下 4H 若收敛会出现在收敛周期列;不收敛则不显示。不特别处理,接受(案例库 F3 记录)。

## 验收对照(案例库,已真数据验证 2026-08-06)

| 案例 | 周期 | 期望 | 实测(默认参数) | 结果 |
|---|---|---|---|---|
| C1 黄金 | 1D 08-04 | 应出 | plateau {3,4} 宽2 | ✓ |
| C2 黄金 | 1D 08-03 | 应出 | plateau {3,4} 宽2 | ✓ |
| C3 ONUSDT | 4H @08-05 08:00Z | 应出 | plateau {3,4,5} 宽3(comp 0.522/0.524) | ✓ |
| C4 HYPE | 4H now | 不应出 | 孤立 bw4(comp 0.635/lt 0.836),宽1 < 2 | ✓ 拒 |
| C5 HYPE | 15m@08-03 11:00Z | 拒 | lt 0.905>0.9(tr=2 时);tr=3 退化后 15m 仍拒(lt≈1.1) | ✓ 拒 |
| C5 HYPE | 1H@08-03 11:00Z | 应出 | plateau {3,4} 宽2(comp 0.61~0.67/lt 0.669) | ✓ → 收敛周期 1H |

> 关键修正:`tr(bw)=min(trendWindow, boxWindow)`。bw=3 用 tr=2 时 HYPE 1H lt 0.905 险挂(>0.9);tr=3(退化,lt==comp)后精确复现案例库数值。bw=3 由 compression 门承载(退化),其余 bw 不变。
