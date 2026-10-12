# Design — 选品收敛打分与扫描池调整

## 1. 边界与改动面

| 层 | 文件 | 改什么 |
|---|---|---|
| domain | `src/domain/coin-scan.ts` | 新增"每周期阈值偏移"常量 + 有效阈值函数(纯函数) |
| server | `src/server/coin-scan-service.ts` | 合格判定改用有效阈值;排序改为"最高合格级别优先" |
| domain | `src/domain/scan-scope.ts` | `topN` 60 → 150;`MarketDataSource` 类型 + 分源下限表 + `defaultScanParams(source, scope)` |
| server | `src/server/app-plugin.ts` | 按请求选源;`/api/scan/config`;缺省下限改用 `defaultScanParams` |
| ui | `src/ui/CoinScanPanel.tsx` | "行情源"选择行;默认值按源推导;请求带 `source` |

**不改**:`detectConvergence` / `score` 公式(09/20 决策:score 只表示缩量深度)、限流 pacer/gate、池的选池口径(仍用当前实时成交额)。`minQuoteVolume24h` 的**默认值**由单一值改为分源分级(见 2.4)。

## 2. 契约

### 2.1 domain 新增(`src/domain/coin-scan.ts`)

```ts
/**
 * 单旋钮的每周期偏移:大级别收敛门槛更低。UI 仍只有一个"结构强度阈值"旋钮
 * (默认 0.6);每周期有效阈值 = max(0, minScore + offset)。
 */
export const TIMEFRAME_SCORE_OFFSET: Readonly<Partial<Record<ReviewTimeframe, number>>> = {
  '5m': 0, '15m': 0, '1H': 0, '4H': -0.05, '1D': -0.10,
};

/** 某周期的有效合格阈值(下界夹到 0,避免负阈值)。 */
export function timeframeMinScore(timeframe: ReviewTimeframe, minScore: number): number {
  return Math.max(0, minScore + (TIMEFRAME_SCORE_OFFSET[timeframe] ?? 0));
}
```

> 类型是 `Partial<Record<...>>` 而非 `Record<...>`:`ReviewTimeframe` 有 8 个成员(含 `1m/1W/1M`),扫描只测 5 个,未收录周期按偏移 0 处理(`?? 0`),与 5m/15m/1H 同待遇。

- 默认 0.6 时:5m/15m/1H=0.60,4H=0.55,**1D=0.50**。
- **向后兼容**:service 的 `minScore` 缺省是 `0`,加上偏移后 1D 得 `max(0,-0.10)=0`,与改动前逐字节一致;受影响面只有"显式传 minScore"的调用(即 UI)。

### 2.2 server 合格判定(`coin-scan-service.ts:137-140`)

```ts
const converged = scanTimeframes.filter((tf) => {
  const s = structures[tf];
  return s.qualified && s.score >= timeframeMinScore(tf, minScore);
});
```

### 2.3 server 排序(`coin-scan-service.ts:160`)

新增"级别序" = `scanTimeframes` 的下标(5m=0 … 1D=4)。每行取 `highestLevel = max(level(c) for c in convergedTimeframes)`。

```ts
rows.sort((a, b) =>
  b.highestLevel - a.highestLevel ||   // 1) 最高合格级别 desc
  b.qualifiedCount - a.qualifiedCount || // 2) 合格周期数 desc
  b.bestScore - a.bestScore);            // 3) 最强分 desc
```

- 等键时靠 JS 稳定排序保留原 ticker(成交额)顺序 —— 满足既有稳定序测试。
- `ScanRow` 契约**不新增字段**(`highestLevel` 仅排序期局部变量);`convergedTimeframes` 已按升序排列,`strongestTimeframe = convergedTimeframes.at(-1)`,UI 需要时可直接推导,无需入参。

### 2.4 行情源类型 + 分源下限(`src/domain/scan-scope.ts`)

```ts
export const MARKET_DATA_SOURCES = ['binance', 'okx', 'bitget'] as const;
export type MarketDataSource = (typeof MARKET_DATA_SOURCES)[number];
export const DEFAULT_MARKET_DATA_SOURCE: MarketDataSource = 'bitget';
export function isMarketDataSource(v: unknown): v is MarketDataSource {
  return (MARKET_DATA_SOURCES as readonly unknown[]).includes(v);
}

export type ScanParams = { topN: number; minQuoteVolume24h: number };

/**
 * 下限按"源 × scope"分级:下限是护栏,`topN` 是硬门槛,故下限必须低于该源的
 * topN 门槛(topN 才会先卡住)。成交量与交易所体量强相关 —— Bitget 24h 成交额
 * 约为 Binance 的 1/10,沿用 Binance 的 10M 会把 Bitget 池压到 33 个。
 */
const SCAN_PARAM_DEFAULTS: Readonly<Record<MarketDataSource, Readonly<Record<ScanScope, ScanParams>>>> = {
  binance: { crypto: { topN: 150, minQuoteVolume24h: 10_000_000 }, equity: { topN: 30, minQuoteVolume24h: 10_000_000 } },
  bitget:  { crypto: { topN: 150, minQuoteVolume24h:    500_000 }, equity: { topN: 30, minQuoteVolume24h: 3_000_000 } },
  okx:     { crypto: { topN: 150, minQuoteVolume24h:  1_000_000 }, equity: { topN: 30, minQuoteVolume24h: 1_000_000 } },
};

export function defaultScanParams(source: MarketDataSource, scope: ScanScope): ScanParams {
  return SCAN_PARAM_DEFAULTS[source][scope];
}
```

- 取值依据(2026-10-12 实测,见 `prd.md` Background):各源"下限下池规模 ≥ topN 门槛"。
- 移除旧 `DEFAULT_SCAN_PARAMS`(单一 scope 维度);3 个消费者(`app-plugin` / `CoinScanPanel` / 测试)改 `defaultScanParams`。
- `MarketDataSource` 定义在 domain,`app-plugin` 的 option 类型改用它(消除内联字面量)。

### 2.5 服务端按请求选源(`src/server/app-plugin.ts`)

- 启动期:`defaultSource = isMarketDataSource(raw) ? raw : DEFAULT_MARKET_DATA_SOURCE`,其中 `raw = options.marketDataSource ?? process.env.MARKET_DATA_SOURCE`。(非法值由原来的→binance 改为→bitget,与"默认 bitget"一致。)
- 为三个源各建一份 `{ tickerSource, candleSource, rateGate }`:

  | source | ticker | candle | gate |
  |---|---|---|---|
  | binance | `binanceTickerSource` | `binanceCandleSource` | `binanceRateGate` |
  | okx | `okxTickerSource`(上提为常量) | `candleService` | `binanceRateGate` |
  | bitget | `bitgetTickerSource` | `bitgetCandleSource` | `bitgetMarketRateGate` |

- 每个源各建一个 `CoinScanService` / `MarketHeatService`(`Record<MarketDataSource, …>`)。二者均无跨请求可变状态;`MarketHeatService` 的 anchor cache **本就应按源隔离**,分实例正好。
- `GET /api/scan/config`(注册在 `/api/scan` **之前**,否则被前缀匹配吃掉)→ `{ source: defaultSource }`,供 UI 初始化选择器。
- `/api/scan`(含 `method=heat`):`source` 经 `isMarketDataSource` 校验,缺省/非法 → `defaultSource`;`shrink` 缺省参数用 `defaultScanParams(source, scope)`。
- `ShrinkScanParams` 新增可选 `source?: MarketDataSource` 并回显进 `params`(UI 可据此标注结果来自哪个源)。类型同文件已 import `ScanScope`,再加 `MarketDataSource` 不引入循环。
- `/api/market-heat`(复盘面板的"温度",`MarketHeatPanel` 调用):本次**不**纳入 UI 换源,固定走 `defaultSource` 的 heat 服务。

### 2.6 UI 选源(`src/ui/CoinScanPanel.tsx`)

- 新增"行情源"选择行(币安 / OKX / Bitget),状态 `source`,初值 `DEFAULT_MARKET_DATA_SOURCE`;挂载时 `GET /api/scan/config` 校正(失败则保留初值)。
- 参数默认值改由 `defaultScanParams(source, scope)` 推导;`source` 或 `scope` 变化时重算 `topN` / `minQuoteVolume24h` 输入框。
- 扫描请求加 `source`;`minScore` 旋钮默认仍 `0.6`,仍不新增阈值输入框。

## 3. 数据流(不变)

`/api/scan?source=X` → 按 `X` 选 `{tickerSource, candleSource, gate}` → `CoinScanService.scanShrink` → tickerSource(实时池,topN=150)→ candleSource(锚点 K 线)→ `probeStructure`(逐周期)→ **每周期阈值判定** → **最高级别优先排序** → `ScanResponse`(回显 `params.source`)。

`GET /api/scan/config` 只回答启动源,不触网。

## 4. 限流与时长

- topN=150 ⇒ 150 × 5 = **750** 次 klines(weight 2)= 1500 weight;110ms pacer ⇒ ~**82s** 冷启动(未命中缓存时)。
- 每分钟请求上限 ~545 ⇒ 每分钟权重 ~1090,仍 ≤ 45% 的 2400 上限 → **不引入 418 风险**(pacer/gate 未改)。
- 锚点历史扫描命中缓存后基本不再发请求;`refresh` 仅对"当前"扫描为真。

## 5. 关键取舍

- **不改 score 公式**:用户诉求是"大级别更值钱",但 09/20 已刻意移除 length bonus 并论证过;方案用"合格门槛 + 排序"表达,而不是把级别塞回 score。这样 `强度分` 列仍是原始缩量深度,语义不漂移。
- **单旋钮 + 内部偏移**:避免 UI 出现 5 个阈值框;偏移是小常量(-0.05/-0.10),既能让 1D≈0.51 入选,又不放开小级别。
- **topN=150 而非去 topN**:去 topN 会让池随行情漂移且单次数分钟;150 是"覆盖到 STRK 当时量级(169 名)"与时长之间的折中。

## 6. 兼容性 / 迁移 / 回滚

- 无数据迁移;纯常量与排序逻辑。
- 缺省 `minScore=0` 路径行为不变;历史锚点缓存继续复用。
- 回滚 = 还原 3 个源文件(coin-scan.ts / coin-scan-service.ts / scan-scope.ts)+ 1 处文案。

## 7. 风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 列表变长 | 1D/4H 门槛降低会多出"只有大级别收敛"的币 | 偏移很小;基础旋钮仍 0.6;`弱收敛`可再调严 |
| 排序变化冲击手感 | 原 `qualifiedCount` 优先改为级别优先 | `收敛结构` 列已列出合格周期,顺序可解释;文档同步 |
| 扫描变慢 | 60→150 使冷扫 ~33s→~82s | 手动触发;UI 提示;缓存命中后更快 |
| 规格文档过期 | `server/coin-scan.md` 记录了 60/topN 与 0.6 单阈值 | Phase 3 更新 spec |
| 换源后结果不可比 | 不同源池/成交额口径不同,切源后 `bestScore` 不可跨源比较 | 结果回显 `params.source`;UI 标注当前源 |
| 三份服务实例 | 每源各建 ticker/candle/scan/heat 实例 | 均无跨请求可变状态;ticker/metadata 自带 TTL 缓存,按需拉取 |
