# 执行计划：选币扫描跳过休市的传统市场合约

前置：先读 `.trellis/spec/domain/index.md`、`.trellis/spec/server/index.md`、`.trellis/spec/frontend/index.md` 的 Pre-Development Checklist 与 Quality Check。

## 步骤

### 1. domain：市场时段（新文件 `src/domain/market-session.ts`）

- [ ] 定义 `MarketClass`、`MarketSessionSpec`、`MARKET_SESSIONS`、`US_NYSE_HOLIDAYS` / `US_NYSE_EARLY_CLOSES`（2026 + 2027）。
- [ ] `localMarketParts(atMs, timezone)`：用 `Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year/month/day/hour/minute })` 的 `formatToParts` 取本地日期与 `minuteOfDay`；weekday 用本地日期构造 `Date.UTC(y, m-1, d).getUTCDay()`。
- [ ] `isMarketOpen(marketClass, atMs)`：无 spec 的类别（`CRYPTO`/`COMMODITY`/`PRE_IPO`）恒 true；否则 交易日 ∩ 非节假日 ∩ 落在任一窗口（提前收盘日用当天收盘分钟截断最后一个窗口，左闭右开）。
- [ ] 文件顶部注释写明「NYSE 节假日表每年需补充下一年度」。

### 2. server：币安合约元数据（新文件 `src/server/binance-instrument-metadata.ts`）

- [ ] `BinanceInstrumentMetadataSource`：`fetchJson('https://fapi.binance.com/fapi/v1/exchangeInfo')` → `Map<string, MarketClass>`；TTL 6h + in-flight 合并；异常/非数组 → 返回空 Map。
- [ ] `underlyingType → MarketClass` 映射（`COIN`/`INDEX`→`CRYPTO`，`EQUITY`→`US_EQUITY`，`HK_EQUITY`/`KR_EQUITY`/`CN_EQUITY` 各自，`COMMODITY`→`COMMODITY`，`PREMARKET`→`PRE_IPO`，未知→不写入 Map（即无时段限制））。
- [ ] 复用 `src/server/http.ts` 的 `defaultBinanceFetchJson` / `FetchJson`，与 `BinanceTickerSource` 同一套路。

### 3. server：Ticker 带上类别

- [ ] `src/server/market-data.ts`：`Ticker` 增加可选 `marketClass`。
- [ ] `src/server/binance-tickers.ts`：`BinanceTickerSource` 注入 `BinanceInstrumentMetadataSource`（构造函数可选参数，默认新建，测试可传入假的），`fetchAndMap` 里合并 `marketClass`；元数据为空时字段缺省。

### 4. server：扫描过滤

- [ ] `src/domain/coin-scan.ts`：`ScanResponse` 增加可选 `skippedInstruments?: string[]`。
- [ ] `src/server/coin-scan-service.ts`：`scanShrink` 内先算 `anchor`，再「成交额门槛 → 休市剔除 → `slice(0, topN)`」；收集 `skippedInstruments`，非空时写入响应。

### 5. ui：提示

- [ ] `src/ui/CoinScanPanel.tsx`：结果区展示「已跳过 N 个休市标的：…」（N>0 才显示，名称超 8 个截断 + `title` 全量）。

### 6. 术语

- [ ] `CONTEXT.md`：新增 **TradFi Instrument（传统市场合约）**、**Market Session（交易时段）**、**Session Gating（休市跳过）** 三条术语；更新 **Coin Scan** / **Shrink Method** 条目说明「扫描池排除所属市场休市的标的」；补一条 Example Dialogue（美股休市时扫描为什么没有 TSLA）。

### 7. 测试

- [ ] `tests/market-session.test.ts`（新）：美股开盘/收盘/盘前边界；周六周日；夏令时切换（2026-03-08 / 2026-11-01 当天 09:30 ET 仍判定开盘）；节假日 2026-12-25 全天休市；提前收盘 2026-11-27 13:00 前开/后关；港股午休 12:00–13:00 休市；韩股 09:00–15:30；A 股午休；`CRYPTO`/`COMMODITY`/`PRE_IPO` 恒开；断言当前年份在节假日表覆盖范围内。
- [ ] `tests/binance-instrument-metadata.test.ts`（新）：映射正确；缓存复用（第二次不请求）；响应非数组 → 空 Map；抛错 → 空 Map。
- [ ] `tests/binance-tickers.test.ts`：ticker 带上 `marketClass`；元数据不可用时不带该字段且 ticker 正常返回。
- [ ] `tests/coin-scan-service.test.ts`：休市的美股/韩股被剔除且**不占 topN 名额**（池子里塞满休市 TradFi 时，加密标的仍全部进入扫描）；`anchor` 用历史时刻（周六）时同样过滤；开盘时刻不过滤；响应带 `skippedInstruments`；元数据失败时等同不过滤。

### 8. 验证

```bash
npx vitest run
npx tsc --noEmit
```

- [ ] 全绿后回到 `.trellis/spec/*/index.md` 的 Quality Check 逐项自检。

## 回滚点

- 若 domain 时区换算在 Windows/Node 上出现 `hourCycle` 兼容问题：退回 `hour12: false` + 处理 `'24'` → `'00'`，不要改成手写 UTC 偏移。
- 若元数据请求在生产环境经常失败导致过滤不生效：确认降级路径（不过滤、扫描正常返回）已测试覆盖，而不是加重试。

## Validation Status（2026-09-06）

- `npx tsc --noEmit` ✅
- node 全量 `npx vitest run --pool=vmForks --exclude '**/*.test.tsx' tests/`：**33 files / 193 tests** ✅（新增 market-session 12、metadata 7、tickers +4、coin-scan-service +4）
- spec 已同步：`server/coin-scan.md`（gating 决策/伪代码/响应类型）、`server/market-data.md`（Ticker.marketClass + 元数据源）、`CONTEXT.md`（3 术语 + 示例对话）。
- jsdom UI 用例本机仍受 jest-dom 环境问题影响（既有，另任务）；CoinScan 提示行为建议 dev server 手验。
