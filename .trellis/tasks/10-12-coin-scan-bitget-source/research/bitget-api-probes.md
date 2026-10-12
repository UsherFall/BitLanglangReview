# Bitget v2 公开行情实测记录（2026-10-12）

选品扫描接 Bitget 源前的探针结论。全部免鉴权，`api.bitget.com` 直连。官方文档页（bitget.com/api-doc）JS 渲染抓不到内容，以下均为 curl 实测。

## 端点

### Tickers（永续全量）

```
GET https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES
```

- 一次返回全部 820 个 USDT 永续（~413KB），HTTP 200
- 关键字段：`symbol`（原生 `BTCUSDT`）、`lastPr`、`change24h`、`quoteVolume`、`usdtVolume`（后两者相等，USDT 计价）
- **`change24h` 是小数不是百分数**：BTCUSDT 实测 `0.00744` = +0.74%，映射到项目 `Ticker.change24h`（百分数契约）必须 ×100
- 稳定币对：实测仅 `USDCUSDT` 在列；其余（FDUSD/DAI/TUSD/USDD/USDP/USD1/USD0）当前未上市，稳定币集合保留防新增
- 交割合约：`deliveryStartTime` 全部为空 → USDT-FUTURES 列均为永续，无需交割过滤
- 头部 header：`X-MBX-USED-REMAIN-LIMIT: 19`（恒定）

### Candles（K 线）

```
GET https://api.bitget.com/api/v2/mix/market/candles?productType=USDT-FUTURES&symbol=BTCUSDT&granularity=1H&limit=N
```

- 免鉴权；行格式 `[timestamp(ms), open, high, low, close, baseVolume, quoteVolume]`，旧→新
- **granularity 大小写**：mix 必须大写 `1H/4H/1D/1W/1M`（合法值 `1m,3m,5m,15m,30m,1H,4H,6H,12H,1D,1W,1M` + UTC 变体）；spot 反而小写（`1h/1day`）。项目 `ReviewTimeframe`（`1m/5m/15m/1H/4H/1D/1W/1M`）与 mix token 1:1，可透传
- 缺 `productType` 报 400172；`granularity=1h`（小写）报 400171 并列合法值
- `limit` 最大实测 1000（200 亦正常）；扫描窗口 100/200 单请求足够
- **`endTime` 语义**：`endTime=X&limit=3` 返回 ts ≤ X 的最新 3 根（实测 endTime=05:00 → 03/04/05 三根）→ `earlier` 方向用 `endTime=anchor-1`+limit 正确
- **`startTime` 无 `endTime` 时**：窗口被钳到 `startTime + 90 天`，返回该窗口内最新 limit 根（实测 startTime=2024-10-04 limit=5 granularity=1D → 返回 2024-12-28~2025-01-01）
- 单请求 `startTime~endTime` 跨度上限 90 天（spec 记载超限 HTTP 400 code 00001）

## 限频实测

| 探针 | 结果 |
|---|---|
| 60 发 @ 20 并发 | 60×200，零 429 |
| 150 发 @ 30 并发 | 150×200，零 429 |
| 持续 10 worker × 20s | **仅 13 发完成，单请求 ~2s，全部 200** → 软限速（延迟膨胀），非 429 |
| 事后串行 5 发 | 0.5–1.6s/发（含 TLS 全握手） |

结论：公开接口名义 20 次/秒/IP（header `X-MBX-USED-REMAIN-LIMIT: 19`），突发容忍度高，但持续并发会被软限速。**必须加 pacer**：设计取 50ms 间隔 + 10ms 抖动（=20 req/s），750 请求冷扫描 pacing 下限 37.5s。

## 历史深度（BTCUSDT）

| granularity | 深度 |
|---|---|
| 1D | ≥ 2 年（2024-12 有数据） |
| 5m | 滚动窗口约 3-4 个月：2026-06-21 有、2026-05-28 空、2025-08-12 空 |

spec（market-data.md）记载"5m ≈ 30 days"偏悲观，实测 ~112 天仍有数据。对扫描无影响（刷新扫描只要最近 100-200 根）；锚定历史扫描超窗口返空。

## 对本任务的设计输入

1. `defaultBitgetMarketFetchJson`：pace(50ms) + labeledFetch（无 key、silent monitor）
2. `BitgetTickerSource`：`usdtVolume`→quoteVolume24h、`change24h`×100、稳定币剔除、30s TTL + in-flight
3. `BitgetCandleSource`：granularity 透传、earlier=`endTime=anchor-1`、later 90 天钳制、-8h 边界、**store 键 `bitget:` 前缀**（market-data.md 09/07 命名空间规则的强制要求）
4. 延迟预期：本机单请求 0.5-2s（含握手；undici 连接复用后更低），750 请求并发 5 预计 1-3 分钟
