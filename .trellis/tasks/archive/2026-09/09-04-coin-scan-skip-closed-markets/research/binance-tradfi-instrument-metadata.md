# 币安 TradFi（传统市场）合约的标识与交易时段

调研日期：2026-09-04，全部结论来自实盘接口验证（非文档推测）。

## 1. 怎么区分美股/港韩股合约：exchangeInfo 有标识

`GET https://fapi.binance.com/fapi/v1/exchangeInfo`（约 1.1 MB，全量 895 个合约）每个 symbol 带：

```json
{
  "symbol": "TSLAUSDT",
  "contractType": "TRADIFI_PERPETUAL",
  "underlyingType": "EQUITY",
  "underlyingSubType": ["TradFi"]
}
```

- 加密永续：`contractType = "PERPETUAL"`，`underlyingType` 以 `COIN` 为主。
- 传统市场：`contractType = "TRADIFI_PERPETUAL"`，`underlyingSubType` 含 `"TradFi"`。

`underlyingType` 分布（实测）：

| underlyingType | 数量 | 归类 |
| --- | --- | --- |
| `COIN`（各 subType：AI/DeFi/Meme/Alpha…） | ~700 | 加密 |
| `EQUITY`（含 1 个 ETF） | 156 | 美股 |
| `HK_EQUITY` | 15 | 港股 |
| `KR_EQUITY` | 8 | 韩股 |
| `CN_EQUITY` | 2 | A 股 |
| `COMMODITY` | 8 | XAU/XAG/XPT/XPD/CL/BZ/NATGAS/COPPER |
| `INDEX` | 3 | 加密指数（不是 TradFi） |
| `PREMARKET`（subType 含 `Pre-IPO`） | 2 | OPENAI / ANTHROPIC |

**不能用名字匹配**：`MSTRUSDT`、`COINUSDT`、`BEUSDT`、`VUSDT`、`DISUSDT`、`MUUSDT`、`SNDKUSDT`、`SOXLUSDT` 看着像币，实际都是股票/ETF。

**注意**：`fapi/v1/exchangeInfo?symbol=TSLAUSDT` 的 `symbol` 参数被忽略，仍返回全量列表 —— 只能拉全量再客户端过滤。

## 2. 没有交易时段字段，也没有交易日历接口

- exchangeInfo 的 symbol 对象字段全集里没有任何 session / trading-hours / 交易日历相关字段（字段列表：`symbol, pair, contractType, deliveryDate, onboardDate, status, maintMarginPercent, requiredMarginPercent, baseAsset, quoteAsset, marginAsset, pricePrecision, quantityPrecision, baseAssetPrecision, quotePrecision, underlyingType, underlyingSubType, triggerProtect, liquidationFee, marketTakeBound, maxMoveOrderLimit, filters, orderTypes, timeInForce, permissionSets`）。
- 探测过 `fapi/v1/tradingDay`、`fapi/v1/tradingHours`、`fapi/v1/marketStatus`，全部返回 404 HTML（不存在）。
- 结论：**「是否开盘」必须自己算**。

## 3. 休市时 K 线不会断，只是量塌掉（这正是不做过滤就一定误报的原因）

TSLAUSDT 最近 500 根 5m（2026-09-02 20:35Z → 09-04 14:10Z）逐小时统计：**每小时都满 12 根，一根不断**。但成交量差距 40 倍以上：

- 开盘时段 13Z（= 09:30 ET）：125,770
- 美股盘后 00–05Z（= 20:00–01:00 ET）：2,930 ~ 3,535

缩量扫描看的是「近段波动率 / 量能低于前段」，休市时段天然满足，所以休市时这些合约必然被扫出来。

## 4. 商品（黄金等）不能套用同样的时段过滤

XAUUSDT 最近 48 根 1h：最低 3,797（21Z）、最高 159,015（12Z），**全天都有量，没有死亡时段**；且不同品种（XAU/XAG/CL/BZ/NATGAS）各自的交易所时段和休市间隙都不一样（CME 黄金每天还有 60 分钟结算间歇）。

→ 商品类（`COMMODITY`）不做时段过滤，避免误伤。用户提到的「黄金开盘时间不一样」正对应这一条。

## 5. 污染程度实测（把 exchangeInfo 和 24hr ticker 做 join）

`ticker/24hr` 按 24h quote volume 排序后的 USDT 永续 topN 构成：

| topN | COIN | EQUITY | KR_EQUITY | HK_EQUITY | COMMODITY |
| --- | --- | --- | --- | --- | --- |
| 30 | 15 | 10 | 1 | 0 | 4 |
| 60（面板默认值） | 37 | 17 | 2 | 0 | 4 |
| 100 | 62 | 31 | 2 | 1 | 4 |

即默认 `topN=60` 时，**19/60 ≈ 32% 的扫描池是有时段的传统市场合约**；它们不只是会误报，还会挤掉真正想扫的加密合约名额。所以过滤必须发生在 `slice(0, topN)` **之前**。

几个具体标的的排名（2026-09-04）：

- XAUUSDT #5（$2,582M）、SKHYNIXUSDT #10（$1,227M）、CLUSDT #12、XAGUSDT #13、NVDAUSDT #22、MSTRUSDT #29、CRCLUSDT #30、TSLAUSDT #33、SAMSUNGUSDT #45（$170M）
- OPENAIUSDT #148（$21M）、ANTHROPICUSDT #204（$10M）、HK0700USDT #397（$2.3M）→ 均在默认 topN=60 之外

## 6. 开源节假日数据源的取舍

| 方案 | 优点 | 缺点 |
| --- | --- | --- |
| 内置 NYSE 节假日表（推荐） | 零依赖、零额外请求、离线可用、行为可预期 | 每年需要手工补一年（约 10 行） |
| npm `date-holidays` | 数据全、自动更新 | 包体大（多国假日数据），且它给的是「国家假日」不是「交易所日历」，仍要自己映射半天休市 |
| 运行时查第三方 HTTP 日历 API | 不用维护 | 引入外网依赖 + 失败兜底，本地工具有这个脆弱点不划算 |

结论：内置表 + 在代码注释里写明「每年需更新」，并在测试里加一条「当前年份必须在覆盖范围内」的断言防止忘记。
