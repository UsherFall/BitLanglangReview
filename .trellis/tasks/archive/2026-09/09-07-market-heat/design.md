# 市场热度复盘 — 技术设计

## 架构与边界

三个相对独立的工作块，按依赖顺序落地（顺序见 implement.md）：

1. **删价格警报**：减少一个 Binance 请求消费者，让限速改造的收口最小化。
2. **全局共享保守限速器**：`binanceRateGate`（http.ts:105）已让 scan/告警在 429/418 时全管线停发；但**请求启动速率**仍各自为政（scan 有私有 `scanPacer`，告警/未来的热度没有）。把节奏器下沉到 Binance 数据源内部。
3. **市场温度面板**：新 domain + 新 server service + 新 API + 新 UI 浮层。

### 1. 删除价格警报（清理范围已核实）

- 删：`src/domain/price-alert.ts`、`src/server/alert-store.ts`、`src/server/alert-monitor.ts`、`src/server/notify.ts`
- `src/server/app-plugin.ts`：去 import（8-9,24）、去 `alertMonitorIntervalMs`(32)、去 notifier/alertMonitor 装配(62-66)、去 `/api/alerts` 路由(221-255)及残留 `TradingReviewApiPluginOptions.serverChanKey`。
- `src/ui/CoinScanPanel.tsx`：去掉「价格警报」区块(167-211)、`alerts/alertConfig/...` state 与 load/save/delete/reactivate（含 props `alertInstrument`/`onAlertInstrumentChange`）；`CoinScanResults` 去掉「设警报」行按钮(288-302)及其 props（影响 App.tsx 741 传参）。App.tsx:195 相关 state 删除。
- `src/ui/styles.css`：删 `.coin-scan-alerts` 段(1605-1694)。
- 测试：删 `tests/alert-monitor.test.ts`、`tests/alert-store.test.ts`、`tests/price-alert.test.ts`、`tests/serverchan-notifier.test.ts`；检查 `tests/coin-scan-service.test.ts:310` 注释引用是否纯注释（若是则顺手改词）。
- DB 表 `price_alerts`：**不做迁移删除**，无害残留、便于未来恢复。删除后没有任何代码建该表。
- 验证：`grep -rn "alert\|ServerChan\|SERVERCHAN\|价格警报\|设警报" src tests`（排除已删文件）无残留；`npm test` 全绿。

### 2. 全局共享保守限速器

**原则：限速发生在真正向外发 Binance 请求的那一层，所有 Binance 消费者自动共享一个请求速率预算；OKX 请求不受影响。**

- 把 `createRequestPacer` 从 `coin-scan-service.ts` 移到 `src/server/http.ts`（紧邻 `binanceRateGate`），并建模块级单例：
  - `BINANCE_MIN_INTERVAL_MS = 110`（≈9 req/s，保守但可接受）
  - `BINANCE_PACE_JITTER_MS = 15`
  - `export const binanceRatePacer = createRequestPacer(BINANCE_MIN_INTERVAL_MS, BINANCE_PACE_JITTER_MS)`
- **只在真正出网的取数点 pace**：
  - `BinanceCandleSource.getCandlesticks`（binance-candles.ts）：cache 命中直接返回（**不 pace**，历史锚点复用是热度二次打开 0 请求的关键）；决定 `fetchJson` 前 `await binanceRatePacer.pace()`。
  - `BinanceTickerSource.listTickers`（binance-tickers.ts）：命中 30s TTL/in-flight 直接返回；真实请求前 pace。
- `CoinScanService`：删除私有 `scanPacer`/`SCAN_*` 常量与所有 `pace()` 调用（coin-scan-service.ts:16-27,64-65,91,120），限速下沉后行为自动继承。并发仍由 `mapLimit(..., 5)` 控制——全局 pace 已把请求**启动**串行化，并发只影响在途。
- `binanceRateGate` 的 429/418 处理**不动**（http.ts:120-155）。
- 效果：scan 300 klines ≈ 110ms×300 ≈ 33s（从 ~15s 变慢，用户已接受）；热度 ~80+1 ≈ 9s；两者并发叠加仍被同一 pace 串行，不会翻倍。

### 3. 市场温度面板

#### 新 domain 模块 `src/domain/market-heat.ts`
- 类型：
  - `MarketTier = 'hot' | 'warm' | 'neutral' | 'cool' | 'cold'`（展示文案 热市/偏热/中性/偏冷/冷市 在 UI 映射）
  - `HeatRow = { instrument: string; changePct: number; windowQuoteVolume: number; isReviewCoin: boolean }`
  - `MarketHeatResult = { tier; stats: { medianChangePct; upCount; downCount; volatileCount; coveredCount; poolSize }; topGainers: HeatRow[]; topLosers: HeatRow[]; reviewCoin: HeatRow | null; skipped: { closedCount; noDataCount; unmappedReviewInstrument: boolean }; warnings: string[] }`
- 常量（集中可标定，满足 AC6）：`HEAT_POOL_TOP_N=80`、`HEAT_WINDOW_MS=24h`、`HEAT_WINDOW_BARS=100`（15m × 100 覆盖 25h）、`TIER_UP_RATIO=0.6`、`TIER_MEDIAN_PCT=1`、`VOLATILE_THRESHOLD_PCT=5`。
- 纯函数 `classifyTier(upRatio, medianPct): MarketTier`（按 PRD 表格）与 `normalizeToBinance(symbol): string | null`（见下）——**无 IO，便于单测**。
- `normalizeToBinance`：OKX `BTC-USDT-SWAP` → 截 `-USDT` 取 `BTC` → `BTCUSDT`；Bitget/Binance `BTCUSDT` 原样（已是 Binance 命名）；`BASEUSDT` 形态 `USDT` 结尾剥一次再拼；无法解析返回 `null`（复盘币显示「无法归一到 Binance」）。

#### 服务 `src/server/market-heat-service.ts`
- 依赖注入（沿用 CoinScanService 风格，可测）：`TickerSource`、`CandleSource`、`Pick<RateGate,'takeWarnings'>`。**构造时始终注入 Binance 实现**（与 `MARKET_DATA_SOURCE` 解耦——热度池必须 Binance 命名才能拿到 MarketClass 与全池；OKX 模式下热度若网络不可达则端点返回 502 明确报错）。
- `computeHeat({ anchor, reviewInstrument })`：
  1. `takeWarnings()` 清旧告警（与 scan 同法）。
  2. **池**：`listTickers()`（BinanceTickerSource 自带 30s TTL）→ `isMarketOpen(marketClass, anchor)` 休市跳过（复用 domain/market-session.ts，无 class 视同 CRYPTO）→ 取前 `HEAT_POOL_TOP_N`。休市名单记入 `skipped.closedCount`。
  3. **per-anchor 行缓存（内存）**：`Map<anchor, Map<instrument, HeatRow>>`（上限 ~50 个锚点 LRU 驱逐）。锚点命中直接复用池行，**跨交易共享**；追加 `reviewInstrument`（若不在池内）单独取。
  4. 每币数据 = `candleSource.getCandlesticks({ instrument, timeframe:'15m', anchor, direction:'earlier', limit:100 })`（**refresh 缺省 false**，走共享缓存）。并发 `mapLimit(..., 3)`。请求实际出网由 binance-candles.ts 内部 pace 串行化。
  5. 计算单行：`cur = 最新 completed 收盘`；`ref = 收盘时间 ≤ anchor−24h 的最后一条`；`changePct = cur/ref−1`；`windowQuoteVolume = Σ(close_i×volume_i)`（**schema 无 quoteVolume，用 close×volume 近似 USDT 成交额**，榜单列标注「≈」）。ref 不存在（上市不足 24h / 覆盖不足）→ 记 `noData` 跳过，不计入统计。
  6. 统计与分档：对**有数据**的行算 median、up/down 家数、`|changePct|≥5` 家数 → `classifyTier`。`reviewInstrument` 无法归一 → `skipped.unmappedReviewInstrument=true`，不失败。
  7. 榜单：topGainers/topLosers 各 `HEAT_MOVERS_LIMIT=10`。
  8. 末尾 `takeWarnings()` 挂到返回（429 退避提示透出，行为与 scan 一致，满足记忆中的反馈约束）。

#### API `src/server/app-plugin.ts`
- `GET /api/market-heat?anchor=<epochMs>&instrument=<reviewSymbol>`；参数非法（缺 anchor/instrument、anchor 非数）→ 400；错误 → 502（沿用现有约定）；成功 → `MarketHeatResult`。

#### UI
- 新组件 `src/ui/MarketHeatPanel.tsx`：props `{ instrument; entryTime; exitTime; onClose }`；浮层样式复用 `.other-coin-panel` 家族（styles.css 增 `market-heat-panel` 变体）。内部锚点切换「入场/离场」，`GET /api/market-heat`。
- 展示：温度大字（5 档配色沿用 good/bad/neutral 语义）、关键数字行、涨幅榜/跌幅榜两个小表、跳过与警告提示行。加载态显示「正在计算市场温度 x/80」（无精确进度则转圈 + 首次 ~10s 提示）；418 时显示返回的错误信息（不静默重试）。
- App.tsx：`detail-header` 的 `.timeframes` 内第三个按钮「热度」（其他币/龙头 之后，App.tsx:749-753），open state 与 `{heatOpen && <MarketHeatPanel .../>}`（756-757 同排）。当前交易切换时面板用新 trade 的 entry/exit 重新请求。自由回溯/选币不出现。

## 数据流

```
UI (MarketHeatPanel, trade detail header)
  → GET /api/market-heat?anchor=…&instrument=…
  → MarketHeatService.computeHeat
      ├─ pool: BinanceTickerSource.listTickers()  [30s TTL; pace 在源内]
      ├─ per-coin 15m candles: BinanceCandleSource.getCandlesticks  [共享缓存命中则 0 请求; 出网前全局 pace 110ms]
      │      └─ CandlestickStore (SQLite candles 表)  ← 写入 → 后续复用
      ├─ 计算 changePct / 近似成交额 / median / 广度 → tier
      └─ rows 按 anchor 内存缓存 (50 LRU)
  → MarketHeatResult JSON → 面板
```

## 兼容性与迁移

- `candles` 表结构不变；`price_alerts` 表保留但无代码引用。
- 符号命名空间：热度榜单/接口一律 Binance 命名（`BTCUSDT`）；复盘币按其源（OKX `-USDT-SWAP` / Bitget 平仓命名）归一，归一失败仅提示不失败。
- 行为变更提醒：选币单次扫描 ~15s → ~33s（用户已确认接受）；429/418 行为与 UI 提示不变。

## 重要取舍

- 限速下沉到源内 vs 服务层手动 pace：源内天然覆盖**所有** Binance 消费者（scan/热度/未来模块），不会漏加；缓存命中不 pace，保留 0 请求快路径。
- 池用「今天」的成交额 Top-N 代理「锚点当时」的主流（历史逐币成交额排行不可得）：已接受，上市晚于锚点的币走 noData 跳过，保证结论可用。
- 成交额用 close×volume 近似：schema 无 quote 列，避免 candles 表加列迁移；榜单列标注近似。
- 温度统计包含被强制纳入的复盘币：复盘币是该时刻实际被关注的对象，纳入比排除更能回答「这笔单在市场什么位置」。

## 运维 / 回滚

- 分块落地，每块独立验证（implement.md 有 gate）；每块一个 git commit，可单独 revert。
- 限速改造是 scan 行为的可感知变化点：该 commit 前单独跑一次 scan 计时。
- 内存 LRU 上限 50 锚点防泄漏；服务重启即清，无持久化需求。
