# Implement: 选品扫描切换 Bitget 行情源

顺序依赖：步骤 1 是其余步骤的地基；2→3 是 ticker 链，1→4 是 candle 链；5 最后装配。每步独立可回滚。

## 步骤

- [x] 1. `src/server/http.ts`：Bitget 公开行情通道
  - [x] 新增 `bitgetMarketRatePacer = createRequestPacer(50, 10)` 与 `bitgetMarketRateGate = createRateGate()`
  - [x] `fetchJsonWithRetry` 增加 `sourceLabel = '币安'` 参数，替换 286/290/293 行硬编码文案；`labeledFetch` 透传
  - [x] 新增 `defaultBitgetMarketFetchJson(url)`：pace → `labeledFetch(url, 'Bitget request failed', bitgetMarketRateGate, silentWeightMonitor)`；catch 中 AbortError → `Bitget request timed out after 12s`
  - [x] `tests/http-retry.test.ts` 增补：sourceLabel 生效（Bitget 429 警告文案）、AbortError 翻译
  - [x] 验证：`npx vitest run tests/http-retry.test.ts`
- [x] 2. `src/domain/stablecoin-quotes.ts`：抽出 `STABLECOIN_QUOTE_PAIRS`（含注释），`binance-tickers.ts` 改 import
  - [x] 验证：`npx vitest run tests/binance-tickers.test.ts`
- [x] 3. `src/server/bitget-tickers.ts` + `tests/bitget-tickers.test.ts`
  - [x] `BitgetTickerSource`：全量 tickers、endsWith('USDT') + 稳定币剔除、×100、`usdtVolume`→`quoteVolume24h`、降序、非有限过滤、30s TTL + in-flight 去重、可注入 `fetchJson`
  - [x] 验证：`npx vitest run tests/bitget-tickers.test.ts`
- [x] 4. `src/server/bitget-candles.ts` + `tests/bitget-candles.test.ts`
  - [x] 以 `git show 99a0a8f^:src/server/bitget-candles.ts` 为底：granularity 透传、earlier=`endTime=anchor-1`+limit、later=`startTime=anchor+1` + `endTime` 90 天钳制、-8h 边界、收盘 bar 过滤、`code!='00000'` 抛错
  - [x] 新增 `BITGET_KEY_PREFIX='bitget:'`：store 读写加前缀、网络用裸名；**回归测试断言 `store.save` 收到 `bitget:BTCUSDT`**
  - [x] 补 `coversAnchorBar` 缓存门（照 `binance-candles.ts`）；granularity 映射覆盖全部 `reviewTimeframes` 的测试
  - [x] 验证：`npx vitest run tests/bitget-candles.test.ts tests/binance-candles.test.ts`
- [x] 5. `src/server/app-plugin.ts` 装配
  - [x] `TradingReviewApiPluginOptions.marketDataSource` 加 `'bitget'`
  - [x] 实例化 Bitget 两源；三元选择 ticker/candle 源；`CoinScanService` 第三参按源传 `bitgetMarketRateGate` / `binanceRateGate`
  - [x] 市场热度两条 Binance 源不动
- [x] 6. 全量验证
  - [x] `npm test`
  - [x] `npx tsc --noEmit`
- [x] 7. 集成实测（dev server）
  - [x] `MARKET_DATA_SOURCE=bitget npm run dev`，加密 scope 扫描：非空行、instrument 原生 symbol、change24h 百分数量级、quoteVolume24h 与 Bitget usdtVolume 对得上
  - [x] devtools network：无 `fapi.binance.com` 请求；响应无币安限频警告
  - [x] 股票 scope：空结果（预期），UI 空态正常
  - [x] 不设 env 重启：行为与当前一致（默认 binance）
- [x] 8. 规格更新（Phase 3.3）
  - [x] `.trellis/spec/server/market-data.md`：装配代码块加 bitget 分支；新增「Bitget (Coin Scan)」小节（端点、×100、pacer/gate、`bitget:` 前缀命名空间、保留窗口）；缓存键规则补记 Bitget 已前缀化
  - [x] `.trellis/spec/server/coin-scan.md`：数据源可切描述补 bitget；股票 scope 在 Bitget 源下为空的预期写进契约

## 验证命令

```bash
npx vitest run tests/http-retry.test.ts tests/bitget-tickers.test.ts tests/bitget-candles.test.ts
npm test
npx tsc --noEmit
MARKET_DATA_SOURCE=bitget npm run dev
```

## 评审门

- 步骤 4 后：撞键回归测试必须存在且红→绿过（先写测试看到它抓得住未前缀化）
- 步骤 6 后：全绿 + tsc 零错误才进集成实测

## 回滚点

- 每步独立：file 级 revert 不影响其他源
- 运行期回滚：`MARKET_DATA_SOURCE` 不设即 Binance
- 无 schema 变更、无数据迁移
