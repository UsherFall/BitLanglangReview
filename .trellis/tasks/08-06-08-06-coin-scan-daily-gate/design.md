# 选币数据源替换为币安 — Design

## 架构总览

选币(TradeReview 之外)数据源从 OKX 切到**币安 USDT-M 永续**(fapi)。FreeReplay/TradeReview **保持 OKX 不动**。通过**数据源接口**抽象,构建时按环境变量选实现,留「切换交易所」口子。

```
app-plugin.ts (wiring)
   ├─ MARKET_DATA_SOURCE=binance(默认) → BinanceTickerSource + BinanceCandleSource → 喂 CoinScanService + AlertMonitor
   └─ MARKET_DATA_SOURCE=okx           → OkxTickerSource + OkxCandleSource     → 同上(兼容回退)
FreeReplay/TradeReview → 始终用 OkxCandleSource(不动)
```

## 接口抽象

新建 `src/server/market-data.ts` 定义三个接口:

```ts
export type Ticker = {
  instrument: string;
  quoteVolume24h: number;
  lastPrice: number;
  change24h: number;
};

export interface TickerSource {
  listTickers(): Promise<Ticker[]>;
}

export type CandleRequest = {
  instrument: string;
  timeframe: ReviewTimeframe;
  anchor: number;
  direction: 'earlier' | 'later';
  limit: number;
};

export interface CandleSource {
  getCandlesticks(request: CandleRequest): Promise<Candlestick[]>;
}
```

`CoinScanService` / `AlertMonitor` 改依赖 `TickerSource`/`CandleSource` 接口(现为具体类)。

## 实现拆分

| 模块 | OKX(现有,改名/适配) | 币安(新增) |
| --- | --- | --- |
| tickers | `okx-tickers.ts` → 实现 `TickerSource`,保留 `OkxTicker` 内部 | `binance-tickers.ts`:`fapi/v1/ticker/24hr` 全量,过滤 USDT 永续,按 quoteVolume 排序 |
| K 线 | `candlestick-service.ts` → 实现 `CandleSource`(OKX history-candles) | `binance-candles.ts`:`fapi/v1/klines`,适配 anchor/direction/limit/contiguity |
| instrument 名录 | `okx-instrument-service.ts`(FreeReplay 用,不动) | 本期不需要(选币池由 tickers 推导) |

## 币安适配细节

### tickers(`fapi/v1/ticker/24hr`)
- 单次全量,无需分页。过滤 `symbol` 为 USDT-M 永续(从 `fapi/v1/exchangeInfo` 的 `contractType==PERPETUAL && quoteAsset==USDT` 交集,或直接按 `quoteVolume` 排序全量)。
- 排除稳定币对:`USDCUSDT`(清单可扩展:USDC/FDUSD/DAI 等报价对)。
- `quoteVolume24h = Number(quoteVolume)`(币安已是 USDT 计价,无需 `volCcy * last` 折算 — 与 OKX 不同)。
- `change24h = Number(priceChangePercent)`(币安直接给百分比)。
- 黄金 XAUUSDT/XAGUSDT/PAXGUSDT/XAUTUSDT 自然在池内。

### K 线(`fapi/v1/klines`)
- 字段:`[openTime, open, high, low, close, volume, closeTime, quoteVol, trades, takerBuyBase, takerBuyQuote, ignore]`。
- `timestamp = openTime`(UTC 0:00 边界,日线天然对齐用户视图,**不加 OKX 的 -8h 偏移**)。
- 形成 bar 过滤:`openTime + intervalMs(timeframe) <= anchor`(与 OKX 同式,但币安 openTime 已对齐边界)。
- `direction` 映射:`earlier` → `endTime=anchor` + 分页;`later` → `startTime` 方向。limit 同现有。
- contiguity:复用现有 `contiguousCandles` 逻辑(同文件,独立于 OKX 边界处理)。
- 缓存:复用 `CandlestickStore`。instrument 名 `XAUUSDT` 与 OKX `XAU-USDT-SWAP` 不同 → 缓存键天然隔离,无冲突。

### 形成 bar / boundary
- 现有 `candlestick-service.ts` 的 `boundaryAnchor` 有 OKX 特有的 `-8h`(1D 上海时区)偏移。币安实现**不含**该偏移(UTC 0:00 即边界)。

## 切换口子

`app-plugin.ts`:

```ts
type TradingReviewApiPluginOptions = {
  serverChanKey?: string;
  marketDataSource?: 'binance' | 'okx';   // 新增
};
// 默认 'binance';`process.env.MARKET_DATA_SOURCE` 兜底
```

wiring:

```ts
const source = options.marketDataSource ?? process.env.MARKET_DATA_SOURCE ?? 'binance';
const tickerSource = source === 'okx' ? new OkxTickerSource() : new BinanceTickerSource();
const candleSourceForScan = source === 'okx' ? new OkxCandleSource(candleStore) : new BinanceCandleSource(candleStore);
// FreeReplay 始终 OkxCandleSource(candleStore)
```

**注意**:选币与 FreeReplay 现在是两个 CandleSource 实例(一个币安、一个 OKX),但**共享同一 CandlestickStore**。OKX 与币安 instrument 名不同 → 缓存无冲突。若未来同 instrument 跨源,需加源前缀,本期不做。

## 影响面

| 文件 | 改动 |
| --- | --- |
| `src/server/market-data.ts` | 新增:接口 |
| `src/server/binance-tickers.ts` | 新增:币安 tickers |
| `src/server/binance-candles.ts` | 新增:币安 K 线 |
| `src/server/okx-tickers.ts` | 适配实现 `TickerSource`(改导出) |
| `src/server/candlestick-service.ts` | 适配实现 `CandleSource`(或保留类,另抽接口) |
| `src/server/coin-scan-service.ts` | 依赖接口,不再 import `fetchOkxTickers` |
| `src/server/alert-monitor.ts` | `TickerFetcher` → `TickerSource`;注入币安实现 |
| `src/server/app-plugin.ts` | wiring + 环境变量切换 |
| `src/domain/coin-scan.ts` | 不改(选币逻辑独立于数据源) |
| `src/ui/CoinScanPanel.tsx` | `shortInstrument` 兼容无后缀名 |
| `tests/*` | coin-scan-service、alert-monitor 测试适配接口;新增 binance 模块测试 |
| `.trellis/spec/server/market-data.md` | 契约更新 |

## 兼容与回滚

- 默认 `binance`:选币/警报行为变(池从 OKX SWAP → 币安永续)。
- `MARKET_DATA_SOURCE=okx` 回退原行为(兼容)。
- FreeReplay/TradeReview 零改动。
- 风险文件:`src/server/app-plugin.ts`(wiring)、`coin-scan-service.ts`、`alert-monitor.ts`。各可独立回滚。
- 币安限频:选币 topN 逐标的拉 K 线(上限 topN=50 请求/次扫描),fapi 2400 req/min 配额充足。

## 关键权衡

- **接口 + 两实现**:改动中等,但 FreeReplay 与选币解耦,后续「切换交易所」自然扩展。代价:两套 CandleSource 并存,币安 K 线逻辑需复制 contiguity/分页(不复用 OKX 类)。
- **选币全链路币安**:黄金 PAXGUSDT/XAUUSDT 只有币安有,必须全链路币安才能扫出。代价:FreeReplay 与选币缓存并存,但 instrument 名隔离。
- **警报切币安**:选币「设警报」的币安名才能被监控。代价:旧 OKX 警报(若存在)失效,但命名不同天然隔离。
