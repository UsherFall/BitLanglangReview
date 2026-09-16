# 设计：币安数据 + 时段表 + 会话序列

> 原 `design.md`（Yahoo 源 + 新鲜度门）在实现第 3 步被实测否掉，本文件是实际落地的设计。依据：`../09-16-coin-scan-equity-source/research/session-pollution-measurements.md`（全部为真机实测）。

## 1. 边界

只用币安 USDT-M 数据，改动四层：

| 层 | 文件 | 改动 |
|---|---|---|
| domain 池子策略 | `src/domain/scan-pool.ts`（新） | `isScannable(marketClass)` |
| domain 时段 | `src/domain/market-session.ts` | 美股窗口 09:30–16:00 → **04:00–20:00 ET**；新增 `isCandleInSession` |
| domain 类型 | `src/domain/market-class.ts`（新） | `MarketClass` 迁出，供策略与会话共用 |
| server 取数 | `src/server/coin-scan-service.ts` | 池子策略层 + 分周期取数窗口 + 会话序列过滤 |
| server 元数据 | `binance-instrument-metadata.ts` / `binance-tickers.ts` | 所有已分类标的都带 `marketClass`；新增 `metadataAvailable()` |
| server 热度 | `market-heat-service.ts` | 池子加 `isScannable` |
| UI | `CoinScanPanel.tsx` | `metadataUnavailable` 提示 |

**不动**：检测器（`coin-scan.ts`）、缓存、图表链路、`/api/scan` 参数、响应形状（只加一个可选字段）。

## 2. 池子策略（`scan-pool.ts`）

```
CRYPTO | COMMODITY | US_EQUITY | KR_EQUITY  → 入池
HK_EQUITY | CN_EQUITY | PRE_IPO             → 不入池（静默）
undefined（无分类 / 元数据降级）             → 入池（保守回退）
```

不入池 ≠ 跳过：`skippedInstruments` 只收「本次锚点上休市」的标的，池子外类别不报（避免每次扫描刷一堆无关提示）。

## 3. 时段与会话序列（`market-session.ts`）

- `isMarketOpen(marketClass, atMs)`：不变，只把美股窗口放宽到 04:00–20:00 ET。依据：实测 MUUSDT 在 04:00 ET 的中位振幅 0.222%，是盘后 17:00–19:00（0.055–0.077%）的 3–4 倍 —— 旧窗口把盘前这段最有活力的时间丢掉了。
- `isCandleInSession(marketClass, openMs, barMs)`：bar 跨度 `[open, open+barMs)` 与任何 session 窗口有交集即保留；未 gated 类别（`marketSession() === null`）恒返回 true。
  - 探针步长 `min(barMs, 15min)`：5m bar 1 次查询、1H 4 次、1D 96 次 —— 会话边界是整分钟、最短周期是 5m，故精确且便宜。
  - **必须用跨度判定**：币安 1D bar 开于 20:00 ET（UTC 00:00），「开盘时间在窗口内」会把每一根日线都剔掉；跨度判定恰好保留「含真实交易时段的那一天」，并自动剔掉周末与节假日（含 Labor Day：`2026-09-07T00:00Z` 的日线覆盖 Sun 20:00 → Mon 20:00 ET，而那个周一是节假日 → 无交集 → 剔除）。

## 4. 扫描流水线（`CoinScanService`）

```
listTickers()
  → 24h 成交额门槛
  → isScannable（池子策略，静默排除）
  → isMarketOpen(anchor)（休市剔除，计入 skippedInstruments）
  → slice(0, topN)
  → 每 (标的, 周期)：
        limit = session-gated ? 200 : 100
        candles = getCandlesticks(...)
        completed = candles.filter(未形成 && isCandleInSession)
        probeStructure(completed)
  → 排序 / 响应（形状不变）+ metadataUnavailable（降级时）
```

- **为什么 200**：会话序列会丢掉休市 bar。美股工作日 session 密度 16h/24h ≈ 67%、周末为 0；2× 让工作日拿满 100 根、周一早盘约 2/3（仍 ≥ 检测器的 `minRun×2 = 10` 下限），同时 `limit < 500` 仍是币安最便宜的 klines 权重档（weight 2），请求数不变。
- `skippedInstruments` 语义不变；`metadataUnavailable` 是唯一新增字段。

## 5. 元数据降级为什么必须可见

`binance-instrument-metadata.ts` 失败时降级为空 map → 所有标的 `marketClass` 缺失 → 池子策略全部放行、`isMarketOpen` 全部为真、`isCandleInSession` 全部为真 → **休市过滤整体失效**，休市股票会带着 7×24 假 K 线涌进结果（正是本任务要修的现象），而旧实现对此**没有任何提示**。

处置：`BinanceTickerSource` 记录「本次快照是否带类别」并暴露 `metadataAvailable()`；`CoinScanService` 为 false 时写 `metadataUnavailable`；面板显示「休市过滤未生效」。不选「元数据失败就让扫描失败」——加密扫描不该被一个元数据故障拖死。

## 6. 风险与回滚

| 风险 | 处置 |
|---|---|
| 时段表要维护（每年 NYSE 节假日） | 表已在仓库内，`tests/market-session.test.ts` 断言「覆盖当前年份」，漏了就测试失败 |
| 2× 原始窗口带来更多数据量 | 请求数不变、权重档不变；只影响传输字节 |
| 周一早盘/长周末后 session bar 不足 100 | 检测器设计上接受更短窗口（≥ 10 根即可），退化为较短的比较而非报错 |
| 共享出口 IP 被币安封（实测 418，`used-weight-1m` 低至 0） | 既有契约：418 快速失败 + 权重监控留痕；本次改动未触碰限速路径 |
| 回滚 | 改动集中在 6 个文件；`isScannable` 恒真 + `isCandleInSession` 恒真即退回改动前行为 |
