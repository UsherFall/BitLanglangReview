# 个人复盘默认数据源改为 Binance,停用 Bitget 行情源

## Goal

用户发现 Bitget 公开 k 线按周期**滚动留存**(实测 5m≈30d、15m≈1-2月、1H≈60-90d、4H≈数月,1D/1W/1M 深;老币 BTC 同规则),导致"个人交割单复盘"的旧单在小周期(1m~4H)必然拿不到数据。决定:**个人交割单复盘的图表默认改用 Binance 行情**(Binance USDT-M 无该留存限制,深度可到 2021+);同时**撤回 Bitget 行情接入**,避免死代码。无数据不回退(Binance 无此币永续 → 空态)。

## Background (confirmed)

- **滚动留存(09/07 实测)**:Bitget `/api/v2/mix/market/candles` 对 BTCUSDT 按周期保留:5m~2026-08-08 起(约30d)、15m~约1-2月、1H~2026-07 中(约60-90d)、4H~2026-01 前空(约数月);1D 可到 2024、1W/1M ≥3年。ZEC 的日线起 2025-11 与 5m 起 2026-08 正是该规则的投影(非币种上线晚)。
- **对比**:Binance `fapi/v1/klines` BTC 5m/1D 可到 2021,ZEC 5m 到 2024,无滚动留存;OKX `history-candles` BTC 5m/1D 可到 2022(主流币深),个别币按上线时间(如 ZEC-USDT-SWAP 约 2025-06)。
- 已落地但将被本任务**撤回/替换**的代码(前两个 commit):
  - `src/server/bitget-candles.ts`(`BitgetCandleSource`,含 90 天 interval 上限处理)
  - `src/server/http.ts::defaultBitgetMarketFetchJson`
  - `src/domain/bitget-position.ts::okxInstrumentToBitgetSymbol`(路由唯一用途)
  - `/api/candles` 的 `source=bitget` 分支;`tests/bitget-candles.test.ts`;app-bitget-mode 的 `source=bitget` 断言
- 保留:tab 改名「个人交割单复盘」、`reviewModeBindings` 模块化绑定、`BitgetControlBar`/`/api/bitget/trades`(持仓仍从 Bitget 同步)。
- 现状 `BinanceCandleSource`(binance-candles.ts)已存在并供 coin scan 使用;`app-plugin.ts` 已持有 `binanceCandleSource` 实例。

## Requirements

- **R1 个人复盘图表源 = Binance**:`reviewMode==='bitget'`(个人交割单复盘)的图表请求 `source=binance`;Binance USDT-M 无滚动留存,历史深度覆盖持仓旧单。
- **R2 撤回 Bitget 行情**:删除 `BitgetCandleSource`、`defaultBitgetMarketFetchJson`、`okxInstrumentToBitgetSymbol`、路由 `source=bitget` 分支及对应测试;不留死代码。
- **R3 /api/candles 支持 binance 源**:`source=binance` 时经 `okxInstrumentToBinanceSymbol`(OKX 名 `ZEC-USDT-SWAP` → `ZECUSDT`)进入 `BinanceCandleSource`;不可映射返回 `{candles:[]}`。缺省仍是 `okx`,现有调用零改动。
- **R4 域名映射**:新增纯函数 `okxInstrumentToBinanceSymbol`,与 bitget 侧符号规则一致(`*-USDT-SWAP` → base`USDT`),附单测。
- **R5 模块化保留**:来源标识 `CandleSourceId` 调整为 `'okx' | 'binance'`;`reviewModeBindings.bitget.candleSource='binance'`;图表组件不感知具体交易所。
- **R6 无回退**:Binance 无此币/拉不到 → 空态,不自动换源、不加提示(与用户此前决定一致)。

## Acceptance Criteria

- [ ] AC1 个人交割单复盘打开任一持仓,图表请求 URL 含 `source=binance`,后端命中 `fapi.binance.com`;交割单/回溯仍命中 OKX,无回归。
- [ ] AC2 ZEC 之类旧单(2026-06)在 5m 能出图(实测 Binance 该时点有数据);无币安永续的币显示空态。
- [ ] AC3 `BitgetCandleSource`/`okxInstrumentToBitgetSymbol`/`defaultBitgetMarketFetchJson` 及 `tests/bitget-candles.test.ts` 已删除,无残留引用。
- [ ] AC4 `okxInstrumentToBinanceSymbol` 单测通过(`ZEC-USDT-SWAP→ZECUSDT`,`1000PEPE-USDT-SWAP→1000PEPEUSDT`,非法名→null)。
- [ ] AC5 全量 `npm test`(PowerShell 下)与 `tsc --noEmit` 通过;spec(market-data/api-plugin)同步。

## Out of Scope

- 交割单复盘 / 回溯复盘(freeReplay)数据源切换(仍 OKX)。
- 无数据自动回退 OKX(用户确认不回退、空态)。
- Bitget 持仓同步(`/api/bitget/*`、BitgetControlBar)不受影响。
- UI 空态提示文案改造(维持现状)。
