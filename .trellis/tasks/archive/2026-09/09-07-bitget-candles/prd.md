# 个人交割单复盘使用 Bitget k 线 + 数据源模块化

## Goal

"Bitget复盘"复盘页面的 k 线目前与交割单复盘一样由 OKX 提供,用户期望它在复盘时反映 Bitget 交易所实际行情。目标:为该页(下称"个人交割单复盘")引入 **Bitget 公开 k 线数据源**并按模块绑定默认源;同时把"图表 k 线数据源"做成**模块化、可插拔**的通用机制,为将来其他模块切换源(如回溯复盘)铺路。

## Background (confirmed by inspection)

- `app-plugin.ts:43`:`FreeReplay / TradeReview always use the OKX candle service`,与 `marketDataSource` 无关;`/api/candles`(app-plugin.ts:114)由 `CandlestickService` 服务,硬编码 `https://www.okx.com/api/v5/market/history-candles`(candlestick-service.ts:25),无来源参数。
- Bitget 现有接入仅持仓历史同步:`BitgetClient`(bitget-client.ts)只有 `fetchHistoryPositionsPage`。
- Bitget symbol(`BTCUSDT`)→ OKX 仪器名 `BTC-USDT-SWAP` 由 `bitgetSymbolToOkxInstrument`(bitget-position.ts:29)转换后进入统一 Trade 队列/图表 → 查 Bitget 需逆映射。
- `CandleSource`/`CandleRequest`(market-data.ts:40/30);现有 OKX 与 Binance 两种实现,`BinanceCandleSource`(binance-candles.ts)是现成模板;各源以 native 仪器名落库避免缓存冲突(Binance `XAUUSDT` vs OKX `XAU-USDT-SWAP`,binance-candles.ts:20-24)。
- UI:`ReviewMode='trade'|'bitget'|'freeReplay'|'scan'`(App.tsx:88);bitget 队列走 `/api/bitget/trades`(App.tsx:104);`TradeChart`(App.tsx:1450)仅收 `trade`/`timeframe`,图表请求统一 `/api/candles?instrument=...`(App.tsx:1579/1753/1287)。
- 已实测 Bitget 公开接口 `GET https://api.bitget.com/api/v2/mix/market/candles?productType=USDT-FUTURES&symbol=BTCUSDT&granularity=1H`:免签名;返回 `{code,msg,data}`;行 `[ts(ms), open, high, low, close, baseVol, quoteVol]`;日/月线按 **UTC+8** 对齐(与 OKX 日线偏移一致);`1m..1W/1M` 均支持;**历史深度受限**(BTCUSDT 2022 年中已无数据,约 2023 起可查)。

## Requirements

- **R1 个人复盘默认源 = Bitget**:`reviewMode==='bitget'` 的交易图 k 线一律从 Bitget 公开行情接口拉取;缓存按 native 仪器名(`BTCUSDT`)落库,与 OKX(`BTC-USDT-SWAP`)互不污染。
- **R2 模块化源选择**:新增来源标识(如 `'okx' | 'bitget'`);`/api/candles` 增加 `source` 参数(缺省 `okx`,向后兼容);后端按来源选 CandleSource 实现;前端按 review mode → candleSource 绑定传参;新来源只需新增 CandleSource 实现与绑定,不改图表组件硬编码分支。交割单复盘固定 `okx`。
- **R3 不做自动回退**:所选源拿不到数据(请求空/失败/映射失败)时返回空 candles,前端维持"没有拿到 K 线";绝不静默混用另一源数据。
- **R4 仪器映射**:Bitget 请求前把 OKX 风格 `BTC-USDT-SWAP` 逆映射为 `BTCUSDT`;纯函数并与 `bitgetSymbolToOkxInstrument` 互逆,附单测;不可映射返回空。
- **R5 改名**:该 tab 可见文案 "Bitget复盘" → "个人交割单复盘"(mode title、切换按钮);技术文案(API key 说明等)保持 Bitget 语义不变。
- **R6 Bitget 行情语义**:剔除未完成 bar(`ts + step <= anchor`);沿用各源 "fetch → filter → store → listCached" 与新鲜度判定模式;granularity 与 `reviewTimeframes` 一一对应;周期窗口语义与现有 OKX 行为保持一致。

## Acceptance Criteria

- [ ] AC1 在个人交割单复盘队列打开任一交易,k 线请求含 `source=bitget` 且后端命中 `api.bitget.com`;交割单复盘 k 线仍命中 `okx.com`,无回归。
- [ ] AC2 同仪器在 OKX 与 Bitget 的缓存互不覆盖(`BTC-USDT-SWAP` vs `BTCUSDT`);重复打开源各读各的缓存。
- [ ] AC3 Bitget 源无数据/失败时图表显示"没有拿到 K 线",不自动使用 OKX。
- [ ] AC4 `okxInstrumentToBitgetSymbol` 与 `bitgetSymbolToOkxInstrument` 互逆(BTCUSDT ↔ BTC-USDT-SWAP);非 USDT 永续输入返回 null;单测通过。
- [ ] AC5 tab 按钮与标题显示"个人交割单复盘";既有 `app-bitget-mode.test.tsx` 等断言更新并通过。
- [ ] AC6 图表组件按 review mode 传 `source`(不硬编码);交割单=okx、bitget=bitget 两端绑定各一处配置可查。
- [ ] AC7 `npm test`(或对应 test 命令)、typecheck/lint 全绿;binance/okx 扫描、freeReplay 行为不变。
- [ ] AC8 (一致性修复)个人复盘模式下图内"显示同币种全部标记"从 `/api/bitget/trades` 拉取,不再误用 `/api/trades`(workbook 队列)。

## Out of Scope

- 回溯复盘(freeReplay)数据源切换 UI → 另开任务,复用本任务的模块化机制(需要 Bitget 合约列表、会话按源隔离等)。
- Bitget 私有/账户 API 新能力(仅用公开行情接口)。
- `CandlestickStore` schema 迁移(source 列):以 native 仪器名命名空间方案替代,无需迁移。
- 交割单复盘、选币(scan)、市场热度、freeReplay 的数据源不变。
- 跨源数据差异的标注/对比。

## Key Decisions

| 决策 | 结论 |
|---|---|
| 应用范围 | 仅个人交割单复盘(bitget mode)切换为 Bitget 源;交割单复盘固定 OKX |
| 源缺数据 | 不回退,显示空态 |
| 改名 | "Bitget复盘" → "个人交割单复盘" |
| freeReplay 切换 | 另开子任务,本任务只做底层模块化机制 |
| 模块化方案 | 来源枚举 + 后端 `CandleSource` 注册表 + 前端 mode→source 绑定(表驱动) |
| 缓存隔离 | 各源按 native 仪器名落库,沿用 Binance 先例,不改 schema |

## Risks / Deferred

- **历史深度**:Bitget mix k 线对 BTCUSDT 仅回溯到约 2023;过早个人持仓会空态 —— 已按 R3 "不回退"接受。实现期以实际接口返回为准。
- **月线边界近似**:`1M` 日历月按 UTC+8 对齐;图表窗口沿用现有 OKX 的 30 天 step 语义(boundaryAnchor),1M 长周期前后翻页可能轻微错位,与现状一致,不做额外修正。
- **源选择契约**:`CandleRequest.instrument` 语义 = "所选源的 native 仪器名";`/api/candles` 负责在 okx/bitget 间映射,前端始终传 OKX 风格名(现有 trade.instrument 即 OKX 风格)。
- **window 语义待实证**:Bitget `startTime/endTime` 是否要求边界对齐、是否返回包含 anchor 的半支 bar,实现首版后在真实接口上核验并校正(单测 mock 可能偏离真实语义)。
- 回溯复盘的源切换任务仍需要:BITGET 合约列表接口、freeReplay session 存储按源隔离、仪器列表 UI 等(未在此任务范围)。
