# Implement: Bitget k 线源 + 模块化数据源选择

执行前先跑 `python ./.trellis/scripts/get_context.py --mode phase --step 1.4` 及 `/trellis-before-dev` 加载本项目分层规范。实现顺序以"先领域/后端、后前端、再测试回归"为准。

## Ordered Checklist

### 1. 领域层
- [ ] `src/domain/candlestick.ts`:新增 `export type CandleSourceId = 'okx' | 'bitget';`
- [ ] `src/domain/bitget-position.ts`:新增 `okxInstrumentToBitgetSymbol(instId)` 纯函数(`BTC-USDT-SWAP`↔`BTCUSDT` 逆映射,非 `*-USDT-SWAP` 返 null)。

### 2. 后端源
- [ ] `src/server/http.ts`:新增 `defaultBitgetMarketFetchJson(url: string)`,复用 `labeledFetch(url, 'Bitget request failed')`;测试文件 http-proxy/http-retry 若有按导出快照的需检查。
- [ ] 新增 `src/server/bitget-candles.ts`:`BitgetCandleSource implements CandleSource`,模板 `BinanceCandleSource`(binance-candles.ts):
  - endpoint `https://api.bitget.com/api/v2/mix/market/candles`,params `productType=USDT-FUTURES` + `symbol` + `granularity`(=ReviewTimeframe 直映,收口 `toBitgetGranularity()`)。
  - earlier:`endTime = anchor - 1`;later:`startTime = anchor + 1`;升序;过滤 `earlier: ts + step <= anchor` / `later: ts > anchor`;save + listCached。
  - 复制 OKX 的 `boundaryAnchor`(-8h)、`contiguousCandles`、`isCacheFresh` 为模块内函数(语义一致)。
  - **实证校正**:对真实接口核验 `startTime/endTime` 是否边界对齐、是否返回含 anchor 的半支 bar,必要时调整窗口参数并同步单测。

### 3. 后端路由
- [ ] `src/server/app-plugin.ts`:
  - 构建 `bitgetCandleSource = new BitgetCandleSource(candleStore)`。
  - `/api/candles` 读 `source` 参数(白名单 okx/bitget,缺省 okx);bitget 分支先 `okxInstrumentToBitgetSymbol` 逆映射,失败回 `{candles: []}`。
  - `getCandlesForMode` 参数 `candleService` → 泛化 `source: CandleSource`(instrument 已转换),三 mode 逻辑不动。

### 4. 前端
- [ ] `src/ui/App.tsx`:
  - 顶部加 review-mode 绑定表 `{ endpoint, candleSource }`(trade→okx、bitget→bitget;freeReplay/scan=null),`tradeReviewEndpoint` 改查表。
  - `TradeChart` props 加 `candleSource: CandleSourceId` 与 `tradesEndpoint: string`;三处 `/api/candles` URL 追加 `source=`;show-all-markers fetch(App.tsx:1498)改 `tradesEndpoint`。
  - 改名:`reviewModeTitle` 与切换按钮( App.tsx:100/595)"Bitget复盘"→"个人交割单复盘";`reviewModeNavLabel` 'B'→'个'。

### 5. 测试
- [ ] 新 `tests/bitget-candles.test.ts`(mock fetch;仿 binance-candles.test.ts)。
- [ ] `tests/bitget-import.test.ts`/`bitget-position.test.ts` 补逆映射往返用例。
- [ ] `tests/app-bitget-mode.test.tsx`:按钮名更新;补"bitget 模式图表请求含 source=bitget"断言;交割单模式含 source=okx 断言。

### 6. 验证与收尾
- [ ] `npm test` 全绿;`npm run typecheck`(或 tsconfig 对应脚本)与 lint 通过。
- [ ] 手动冒烟:交割单复盘 k 线仍从 OKX;个人复盘打开一笔近单显示 Bitget k 线;故意选历史过深交易验证空态文案。
- [ ] 检查 AGENTS/spec 一致性;回归 scan/market-heat/freeReplay。

## Validation Commands

- `npm test`(vitest)
- `npm run typecheck` / `npx tsc --noEmit`
- `npm run lint`(若配置)
- 真实接口探针:`curl "https://api.bitget.com/api/v2/mix/market/candles?productType=USDT-FUTURES&symbol=BTCUSDT&granularity=1D&startTime=...&endTime=..."` 核验窗口语义

## Risky Files / Rollback Points

- `src/server/bitget-candles.ts`(新):窗口语义若与真实接口不符,只需调整该文件 filter/window + 单测。
- `src/server/app-plugin.ts`:source 参数缺省 okx 保底,改动天然向后兼容;若出问题,回退点 = 只删 source 分支。
- `src/ui/App.tsx`(绑定表 + TradeChart props + 改名):改名与绑定解耦,可分两个 commit 便于回退。
- `src/domain/*`:纯函数,低风险。

## Follow-up Checks (before task.py start)

- [ ] jsonl manifests:若按 sub-agent 派发需保证非空;内联实现则依赖 trellis-before-dev 加载规范。
- [ ] prd AC1–AC8 全部可测并有对应用例。
- [ ] freeReplay 切换任务(回溯复盘源切换)已在 prd Out of Scope 记录,另开任务跟进。
