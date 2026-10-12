# Bitget isRwa 分类与热度切源 — 探针记录（2026-10-12）

## contracts 端点

```
GET https://api.bitget.com/api/v2/mix/market/contracts?productType=USDT-FUTURES
```

免鉴权，一次返回全部 820 个合约。关键字段：`symbol`、`baseCoin`、`isRwa`、`symbolType`、`symbolStatus`。

## isRwa 分布（实测）

| isRwa | 数量 | 含义 |
|---|---|---|
| NO | 466 | 真加密 |
| YES | 354 | RWA：美股、港股（HKD 后缀）、韩/日股、黄金白银原油、指数 ETF、FX、pre-IPO |

样例字段对比：

```
BTCUSDT  { baseCoin: 'BTC',  symbolType: 'perpetual', isRwa: 'NO'  }
TSLAUSDT { baseCoin: 'TSLA', symbolType: 'perpetual', isRwa: 'YES', openTime: '1769994062288' }
NVDAUSDT { baseCoin: 'NVDA', symbolType: 'perpetual', isRwa: 'YES' }
XAUUSDT  { baseCoin: 'XAU',  symbolType: 'perpetual', isRwa: 'YES' }
CLUSDT   { baseCoin: 'CL',   symbolType: 'perpetual', isRwa: 'YES' }
```

- `symbolType` 全部为 `perpetual`（820/820），`symbolStatus` 全部 `normal` —— 无细分信号
- 唯一定量分类信号就是 `isRwa` 布尔

## RWA 构成（354 个 base 的全量清点）

- 美股（多数）：AAPL/TSLA/NVDA/MSTR/COIN/CRCL…含美股上市 ADR（BABA/JD/PDD/NIO）与杠杆 ETF（TSLL/CONL/NVDL/SOXL）
- 港股：以 `HKD` 后缀区分（TENCENTHKD/XIAOMIHKD/SHEINHKD/MINIMAXHKD…）；无后缀的同名标的（TENCENT/MEITUAN）应为美国 OTC
- 韩/日股：SAMSUNG/SKHYNIX/HYUNDAI/LGELECTRONICS/NAVER/SONY/SOFTBANK/KIOXIA…
- 商品：XAU/XAG/XPT/XPD/XAUT/PAXG/COPPER/CL/BZ/NATGAS
- 指数/ETF：SP500/NDX100/HSI/KR200/JP225/SPY/QQQ/IBIT/KWEB…
- FX：EURUSD/GBPUSD/USDJPY/USDBRL
- pre-IPO：OPENAI/ANTHROPIC/SHEIN/UNITREE/MOONSHOT/MINIMAX/ZHIPU/POLYMARKET

## 用户决策（10/12）

**只分两类：加密货币 vs 其他。** 不建细分符号表。

- `isRwa=NO` → `CRYPTO`（加密 scope，24/7，可扫）
- `isRwa=YES` → `US_EQUITY`（股票 scope，04:00–20:00 ET 门控，可扫）

接受后果（用户明确："纯两类，黄金也门控"）：黄金/原油/指数/FX 等 24/7 产品被美股时段门控，每天丢约 8 小时 bar，session-only 序列在断层处截断，这些合约的收敛扫描基本无果；港股/日韩/pre-IPO 按美股时段门控（错时段，两类决策的已知边界）。

## 热度切源

- `MarketHeatService` 构造已接收 `(tickerSource, candleSource)`，app-plugin 硬编码币安实例是唯一切换点
- 改为传入当前数据源实例即可；bitget 模式 candle 键 `bitget:` 前缀天然隔离
- okx 模式热度随之读 OKX（原硬编码币安）——预期行为变化
