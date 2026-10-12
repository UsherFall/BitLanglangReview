# Design: Bitget 标的分类与热度切源

## 1. 分类映射（纯函数）

新建 `src/domain/bitget-market-class.ts`：

```ts
export function bitgetMarketClass(isRwa: string | undefined): MarketClass | undefined {
  if (isRwa === 'NO') return 'CRYPTO';
  if (isRwa === 'YES') return 'US_EQUITY';
  return undefined; // 缺值/未知 → 不分类（按加密，与币安 metadata 降级语义一致）
}
```

- 两类是用户决策（PRD 约束）：黄金/原油/指数/港股/pre-IPO 一律 `US_EQUITY`，接受美股时段门控后果。
- 缺值返回 `undefined` 而不是默认某类：未分类合约保持可扫（metadata  outage 不空池），由 `metadataAvailable()` 报告状态。
- 纯函数 + 表驱动测试（YES/NO/缺值/异常值四类输入）。

## 2. Metadata 源（服务层）

新建 `src/server/bitget-instrument-metadata.ts`，结构仿 `binance-instrument-metadata.ts`：

- 端点：`GET https://api.bitget.com/api/v2/mix/market/contracts?productType=USDT-FUTURES`
- 返回 `data: [{ symbol, isRwa, ... }]` → `Map<symbol, MarketClass>`（经 `bitgetMarketClass`，undefined 不入 map）
- TTL 6h + in-flight 去重；模块级共享工厂 `bitgetInstrumentMetadata()`（同 `binanceInstrumentMetadata()` 模式）
- 失败 / 非数组 / 无 data → 空 map，**绝不抛错**；`size === 0` 即"不可用"信号
- fetcher 用 `defaultBitgetMarketFetchJson`（走 pacer + gate + 12s 超时，与其它 Bitget 调用同预算）

## 3. BitgetTickerSource 挂分类

`src/server/bitget-tickers.ts` 改造（对齐 `BinanceTickerSource` 的既有形状）：

```ts
constructor(
  private readonly fetchJson: FetchJson = defaultBitgetMarketFetchJson,
  private readonly metadataSource: BitgetInstrumentMetadataSource | null = null,
) {}
```

- `fetchAndMap` 并行拉 tickers + metadata（`Promise.all`，同币安）
- 每个分类 symbol 挂 `marketClass`；未分类不挂
- `metadataOk = metadataSource !== null && metadata.size > 0`；实现 `metadataAvailable(): boolean`
- 排序 / 过滤 / TTL / in-flight 逻辑不变

装配侧：`app-plugin.ts` 改为 `new BitgetTickerSource(undefined, bitgetInstrumentMetadata())`。

## 4. 市场热度跟随数据源

`app-plugin.ts` 现状：`new MarketHeatService(binanceTickerSource, binanceCandleSource)` 硬编码。

改为传入当前数据源实例：

```ts
const marketHeatService = new MarketHeatService(tickerSource, scanCandleSource);
```

- binance 模式：`tickerSource`/`scanCandleSource` 即币安实例 → 与扫描共享，30s ticker TTL / 6h metadata 缓存共享语义不变
- bitget 模式：热度读 Bitget tickers + candles（candle 键 `bitget:` 前缀，天然隔离）
- okx 模式：热度随之读 OKX（原为硬编码币安）——行为变化，PRD 已列为预期
- `MarketHeatService` 本身零改动：构造已接收 `(tickerSource, candleSource)`，内部已用 `isScannable`/`isMarketOpen` 消费 `marketClass`

## 5. 数据流与行为变化

```
MARKET_DATA_SOURCE=bitget（默认）
  tickerSource = BitgetTickerSource(+bitgetInstrumentMetadata 6h TTL)
     ├→ isRwa=NO  (466) → CRYPTO     → 加密 scope，24/7，可扫
     └→ isRwa=YES (354) → US_EQUITY  → 股票 scope，04:00–20:00 ET 门控，可扫
  marketHeatService 同源
```

- 加密扫描不再出现 TSLA/NVDA/XAU/SPY（PRD AC1）
- 股票 scope 从"空池"变为 RWA 合约（受美股时段门控；闭市时进 `skippedInstruments`）
- 黄金等 24/7 产品每天丢 ~8h bar，session-only 序列在断层截断——两类决策的已知代价，PRD 约束已记录

## 6. 测试策略

| 文件 | 覆盖 |
|---|---|
| `tests/bitget-market-class.test.ts`（新） | YES→US_EQUITY、NO→CRYPTO、undefined/异常→undefined |
| `tests/bitget-instrument-metadata.test.ts`（新） | symbol→class 映射、isRwa 异常值跳过、TTL+in-flight、网络失败降级空 map 不抛错、非数组降级 |
| `tests/bitget-tickers.test.ts`（增补） | 挂 marketClass（两类）、metadataAvailable 正常/降级、未分类 symbol 不挂 |
| `tests/market-heat-service.test.ts`（增补） | 用 Bitget 形状的假源验证热度消费 marketClass（闭市跳过、RWA 归股票 scope 不进加密池）——若现有测试已覆盖则只补 bitget 分支 |

注入式测试：两个源都接受 `fetchJson` / metadata fetch 注入，断网跑。

## 7. 风险与权衡

- **门控误伤**：24/7 的 RWA 产品（黄金/指数/FX）被美股时段门控，序列断层 → 这些合约的收敛扫描基本无果。用户明确接受（"纯两类，黄金也门控"）。
- **HK/日韩/pre-IPO 错时段**：按美股时段门控（无细分符号表的代价）。pre-IPO 无真实市场，其"安静"可能被读成收敛——两类决策的已知边界。
- **热度随源切换**：okx 模式热度数据从币安变 OKX，历史热度口径随之变；模块一致性优先（用户要求"整个模块默认 bitget"）。
- **metadata  outage**：contracts 拉取失败 → 全量无 class → 股票重新淹没加密扫描，但响应带 `metadataUnavailable` 警告（现有机制，UI 已渲染）。

## 8. 回滚

- 运行期：`MARKET_DATA_SOURCE=binance` 完全回到改动前行为（热度/扫描/分类均币安口径）。
- 代码级：新增两文件 + 两处装配改动 + 测试，file 级 revert 无牵连；无 schema 变更、无数据迁移。
