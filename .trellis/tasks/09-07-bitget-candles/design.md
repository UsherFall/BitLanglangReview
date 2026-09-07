# Design: Bitget k 线源 + 模块化数据源选择

## 架构总览

```
                       ┌──────────────────────────────────────────────┐
   /api/candles        │  source 参数 → 选择 CandleSource               │
  ?source=okx|bitget   │   okx    → CandlestickService (OKX 现有)      │
   instrument=OKX名     │   bitget → BitgetCandleSource (新增)          │
                       └───────┬───────────────────────┬──────────────┘
                               │                       │
                     (instrument 不变)      (instrument 逆映射为 BTCUSDT)
                               │                       │
                       www.okx.com/...        api.bitget.com/api/v2/mix/market/candles
```

- **来源标识** `CandleSourceId = 'okx' | 'bitget'` 放在领域层(如 `src/domain/candlestick.ts`),UI 与服务端共同引用,避免 UI import 服务端 `market-data.ts`。
- **CandleSource 契约不变**(market-data.ts:40)。新增 `BitgetCandleSource` 实现同一接口;`CandleRequest.instrument` 语义约定为"所选源的 native 仪器名"(与 Binance 源现状一致)。
- **/api/candles 负责映射**:前端始终以 `trade.instrument`(OKX 风格,如 `BTC-USDT-SWAP`)调用;路由按 `source` 决定是否逆映射为 Bitget native symbol 后再分发给具体源。
- **缓存隔离**:各源以 native 仪器名落库(bitget 存 `BTCUSDT`,okx 存 `BTC-USDT-SWAP`),`CandlestickStore` schema 不动,沿用 Binance 先例。同一把 `candleStore` 实例共享即可。

## 后端

### 新增 `src/server/bitget-candles.ts`

类 `BitgetCandleSource implements CandleSource`,以 `BinanceCandleSource` 为模板:

```ts
constructor(store: CandlestickStore, fetchJson: FetchJson = defaultBitgetMarketFetchJson)
```

- `getCandlesticks(request)` 骨架与 Binance 源一致:先 `listCached` 命中新鲜度则直接返回;否则请求 Bitget → 归一化 → 过滤 → `store.save` → `listCached`。
- **Endpoint**:`GET https://api.bitget.com/api/v2/mix/market/candles`,query:`productType=USDT-FUTURES`、`symbol=<native>`、`granularity=<timeframe 直映>`、`limit`。
- **granularity**:`ReviewTimeframe` 八档与 Bitget granularity 字符串一致(`1m/5m/15m/1H/4H/1D/1W/1M`),仍收口到 `toBitgetGranularity()` 单一函数。
- **时间窗口**:
  - `direction='earlier'`:`endTime = anchor - 1`,`limit`。
  - `direction='later'`:`startTime = anchor + 1`,`limit`。
  - 首版语义以 Binance 模板为准;**实现期在真实接口上核验** startTime/endTime 是否需要边界对齐、是否返回含 anchor 的半支 bar,单测随之校正。
- **过滤**(完成 bar + 方向):`direction='earlier'` 取 `timestamp + step <= anchor`;`direction='later'` 取 `timestamp > anchor`;然后升序。
- **日线/月线对齐**:实测 Bitget 日/月线按 UTC+8 首对齐,与 OKX 一致 → 直接复用 OKX 的 `boundaryAnchor`(-8h)、`contiguousCandles`、`isCacheFresh` 语义(candlestick-service.ts:57/65/81),复制为模块内私有函数,保证与现状 OKX 图窗口行为一致。
- 错误抛出沿用 `defaultFetchJson` 语义(`HTTP xxx`),路由转 502;空 `data` 正常返回空数组。

### `src/server/http.ts` 小扩展

Bitget 行情为公开免签 GET。`defaultBitgetFetchJson(url, headers)` 需要 headers 参数且用于私密接口;新增 `defaultBitgetMarketFetchJson(url)`(无 headers),内部复用 `labeledFetch(url, 'Bitget request failed')`(走同一代理/超时/重试)。

### `src/server/app-plugin.ts` 改动

1. 构建:`const bitgetCandleSource = new BitgetCandleSource(candleStore)`;维持 `candleService`(OKX)不变。
2. `/api/candles`(app-plugin.ts:114):
   - 读 `source` 参数,白名单 `'okx' | 'bitget'`,非法/缺省 → `'okx'`(向后兼容,现有调用方不变)。
   - `okx` 分支:instrument 原样进入 `CandlestickService`(现状)。
   - `bitget` 分支:`okxInstrumentToBitgetSymbol(instrument)`;null → 直接回 `{ candles: [] }`;否则以 native symbol 进入 `BitgetCandleSource`。
   - `getCandlesForMode` 的参数从 `candleService: CandlestickService` 泛化为 `source: CandleSource`(instrument 已由路由转换),三种 mode 逻辑不动。

### 新增映射 `src/domain/bitget-position.ts`

```ts
export function okxInstrumentToBitgetSymbol(instId: string): string | null
```

`BTC-USDT-SWAP` → `BTCUSDT`;非 `X-USDT-SWAP` 形态返回 null;与 `bitgetSymbolToOkxInstrument` 互逆(正则处理大写字母数字 base)。

## 前端

### `App.tsx` 的 review-mode 绑定(表驱动,模块化落点)

在 App 顶部或工具区新增绑定表,替代散落的硬编码:

```ts
type ReviewModeBinding = { endpoint: string; candleSource: CandleSourceId };
const reviewModeBindings: Record<ReviewMode, ReviewModeBinding | null> = {
  trade:      { endpoint: '/api/trades',         candleSource: 'okx' },
  bitget:     { endpoint: '/api/bitget/trades', candleSource: 'bitget' },
  freeReplay: null, // 走 FreeReplayChart/自有流程
  scan:       null,
};
```

- `tradeReviewEndpoint(mode)` 可改为查该表(行为不变)。
- review workspace 渲染 `TradeChart` 时传 `candleSource={reviewModeBindings[reviewMode].candleSource}`。

### `TradeChart`(App.tsx:1450)

- props 增加 `candleSource: CandleSourceId`(以及可选的 `tradesEndpoint: string`)。
- 三处 `/api/candles` URL(initial App.tsx:1579、later 1753、earlier 1287)统一追加 `source=<candleSource>`。
- "显示同币种全部标记" fetch(App.tsx:1498)改用 `tradesEndpoint`(bitget 模式 → `/api/bitget/trades`),修复既有跨源误用(AC8)。
- 空数据/失败路径不变(维持"没有拿到 K 线"),满足 R3。

### 改名(App.tsx)

- `reviewModeTitle`(App.tsx:100)bitget 分支 → `'个人交割单复盘'`。
- 切换按钮( App.tsx:595)文案 → `'个人交割单复盘'`。
- `reviewModeNavLabel`(App.tsx:95)bitget 分支 `'B'` → `'个'`(与交割单 `'交'` 风格一致;tooltip title 已说明全名)。
- 空态/API key 文案(App.tsx:787、BitgetControlBar)保留 Bitget 语义,不改。

## 测试

- **新单测** `tests/bitget-candles.test.ts`(mock fetchJson):仿 `binance-candles.test.ts`,覆盖 granularity 直映、earlier/later 窗口参数、完成 bar 过滤、空 data、缓存命中与 fresh 判定、native 落库键。
- **映射单测**:在 `bitget-import.test.ts` 或 `bitget-position.test.ts` 补 `okxInstrumentToBitgetSymbol` 往返用例。
- **UI 测试**:`app-bitget-mode.test.tsx` 按钮名更新;新增带 trade 的 fixture 断言图表请求 URL 含 `source=bitget`;交割单模式仍为 `okx`(补一条)。
- **回归**:跑全量 test;确认 scan/binance、freeReplay(OKX 路由)用例不受影响。

## 边界与兼容

- 缺省 `source=okx` 保证旧调用(freeReplay、OtherCoinChart、热力图链路)零改动。
- `CandleRequest.instrument` native 语义仅在新增源内约束;`market-data.ts` 补注释。
- 数据格式:Bitget baseVol 用于 `Candlestick.volume`,与 OKX/Binance 现状一致。
