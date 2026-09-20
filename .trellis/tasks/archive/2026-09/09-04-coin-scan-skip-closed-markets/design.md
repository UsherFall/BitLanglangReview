# 技术设计：选币扫描跳过休市的传统市场合约

## 分层与文件

| 文件 | 层 | 职责 |
| --- | --- | --- |
| `src/domain/market-session.ts` | domain（纯函数，无 IO） | 市场类别 + 时段判定 + NYSE 节假日表 |
| `src/server/binance-instrument-metadata.ts` | server | 拉 `fapi/v1/exchangeInfo` → `symbol → MarketClass`，带缓存 |
| `src/server/binance-tickers.ts` | server | ticker 上补 `marketClass`（新增可选字段） |
| `src/server/market-data.ts` | server | `Ticker` 增加可选 `marketClass` |
| `src/server/coin-scan-service.ts` | server | 在 `slice(0, topN)` 前剔除休市标的，回传 `skippedInstruments` |
| `src/domain/coin-scan.ts` | domain | `ScanResponse` 增加可选 `skippedInstruments` |
| `src/ui/CoinScanPanel.tsx` | ui | 展示「已跳过 N 个休市标的」 |
| `tests/market-session.test.ts` 等 | tests | 时段/映射/接入三层测试 |

方向：domain 只放纯判定，IO 与缓存都在 server，UI 只做展示。这与仓库现有约定一致（`src/domain/coin-scan.ts` 是纯算法，`src/server/*` 负责数据源与缓存）。

## 数据契约

```ts
// src/domain/market-session.ts
export type MarketClass = 'CRYPTO' | 'US_EQUITY' | 'HK_EQUITY' | 'KR_EQUITY' | 'CN_EQUITY' | 'COMMODITY' | 'PRE_IPO';

/** 一个市场的交易时段定义（本地时间，分钟为单位）。 */
export type MarketSessionSpec = {
  timezone: string;                 // IANA
  /** 每周交易日：0=周日 … 6=周六 */
  tradingDays: readonly number[];
  /** 一个或多个开盘区间，左闭右开 */
  windows: readonly { startMinute: number; endMinute: number }[];
  /** 全天休市日（本地日期 'YYYY-MM-DD'） */
  holidays?: readonly string[];
  /** 提前收盘日：本地日期 → 当天的收盘分钟 */
  earlyCloses?: Readonly<Record<string, number>>;
};
```

`CRYPTO` / `COMMODITY` / `PRE_IPO` 没有 `MarketSessionSpec`（`isMarketOpen` 恒为 true）。

```ts
export function marketSession(marketClass: MarketClass): MarketSessionSpec | null;
export function isMarketOpen(marketClass: MarketClass, atMs: number): boolean;
export function localMarketParts(atMs: number, timezone: string): { date: string; weekday: number; minuteOfDay: number };
```

## 时区换算实现要点

用 `Intl.DateTimeFormat` 的 `formatToParts`（locale 固定 `en-US`，`hourCycle: 'h23'`）取本地 `year/month/day/hour/minute`，并把 weekday 用 `Date.prototype.getUTCDay` 作用在「格式化出的本地 Y-M-D 构造的 UTC 零点」上：

- 直接对时间戳取 `getUTCDay()` 是 UTC 的星期，跨日界会错（北京时间周一 07:00 是 UTC 周日 23:00）。
- 用本地日期构造 `Date.UTC(y, m-1, d)` 再取 `getUTCDay()` 即得本地星期，无需引入日期库。

夏令时由 IANA 时区数据（`America/New_York` 等）自动处理，不存在手写的 ±4/±5 偏移。

## 美股节假日表

`US_NYSE_HOLIDAYS`（`{ 'YYYY-MM-DD': 'holiday' | 'early:<minute>' }` 或分开两个表）。覆盖 2026 / 2027：

- 2026：01-01、01-19、02-16、04-03（Good Friday）、05-25、06-19、07-03（独立日顺延）、09-07、11-26、12-25；提前收盘 13:00：11-27、12-24。
- 2027：01-01、01-18、02-15、03-26（Good Friday）、05-31、06-18（六月节顺延）、07-05（独立日顺延）、09-06、11-25、12-24（圣诞顺延）；提前收盘 13:00：11-26。

维护约束：

- 文件顶部注释写明「每年需补充下一年度」。
- 测试断言「当前年份 ∈ 已覆盖年份」，否则报错提示更新（防止忘记维护导致静默失效）。
- 未覆盖的年份：**不做**节假日过滤（只判周一至周五 + 时段），行为退化为「可能多扫」，不会误杀。

## 类别映射（server）

```ts
// src/server/binance-instrument-metadata.ts
export type BinanceInstrumentMetadata = { marketClass: MarketClass };

export class BinanceInstrumentMetadataSource {
  constructor(fetchJson?: FetchJson);
  /** 拉 exchangeInfo 并缓存；失败返回空 Map（调用方按「无元数据」降级为不过滤）。 */
  async load(): Promise<Map<string, MarketClass>>;
}
```

- TTL 6 小时 + in-flight 合并（与 `BinanceTickerSource` 同一套写法：模块内 `cache` / `inflight`）。
- exchangeInfo 响应 ~1.1 MB 且 `?symbol=` 参数无效，只拉全量一次并长期缓存，不接受按 symbol 过滤。
- `underlyingType → MarketClass` 映射表集中在 domain 之外（这是币安的字段语义，属于 server 适配层），未知值 → 无时段限制。

## Ticker 契约变更

```ts
// src/server/market-data.ts
export type Ticker = {
  instrument: string;
  quoteVolume24h: number;
  lastPrice: number;
  change24h: number;
  /** 该合约所属市场类别；缺省（OKX 或元数据不可用）= 无时段限制。 */
  marketClass?: MarketClass;
};
```

- `BinanceTickerSource.listTickers()` 在映射 ticker 时合并元数据 Map；元数据拉取失败时 `marketClass` 缺省 → 不过滤（R1 降级要求）。
- `OkxTickerSource` 不改动。

## 扫描接入（`CoinScanService.scanShrink`）

```ts
const anchor = params.anchor ?? Date.now();
// 顺序：成交额门槛 → 休市剔除 → topN 切片
const pool = tickers.filter((t) => t.quoteVolume24h >= params.minQuoteVolume24h);
const open: Ticker[] = [];
const skippedInstruments: string[] = [];
for (const ticker of pool) {
  if (isMarketOpen(ticker.marketClass ?? 'CRYPTO', anchor)) open.push(ticker);
  else skippedInstruments.push(ticker.instrument);
}
const top = open.slice(0, params.topN);
```

- 只在 `skippedInstruments.length > 0` 时写入响应。
- 被跳过的标的不产生任何 klines 请求（直接省掉 topN×5 的预算，这是休市时段扫描变快的主因）。

## 响应与 UI

```ts
// src/domain/coin-scan.ts
export type ScanResponse = {
  // ...既有字段
  /** 因所属市场休市而被排除的 instrument（不含未进池、未过门槛的标的）。 */
  skippedInstruments?: string[];
};
```

`CoinScanPanel` 在结果区加一行（仅当非空）：

```
已跳过 19 个休市标的：NVDAUSDT、MSTRUSDT、TSLAUSDT …
```

名称列表超过 8 个时截断为「前 8 个 + 等 N 个」，完整列表放进 `title`。

## 不做的事

- 不改 `alert-monitor`（价格提醒不受市场时段影响；休市时的提醒仍有意义）。
- 不引入任何日期/节假日 npm 依赖。
- 不对商品（XAU/CL/BZ/NATGAS…）做时段过滤：实测 XAU 全天有量，且各品种时段与结算间歇不同，容易误伤。
- 不做「量能自证」兜底（本次选内置日历方案）。若后续发现节假日/特殊休市仍产生噪声，再作为独立任务加。

## 兼容性 / 回滚

- `marketClass`、`skippedInstruments` 均为可选字段，旧的前端/测试无需改动即可编译。
- 回滚只需删掉 `scanShrink` 里的 `isMarketOpen` 过滤分支（其余是无副作用的加法）。
