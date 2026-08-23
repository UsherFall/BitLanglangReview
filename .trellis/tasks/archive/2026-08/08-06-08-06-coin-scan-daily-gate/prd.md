# 选币数据源替换为币安(黄金 XAUUSDT 必检)

## Goal

用户反馈:黄金 8月4日「早上8点开盘」的日K(4H/日线)该被选币扫出,但没扫到。根因排查发现两件事:

1. **日线边界错位**:选币/行情数据源是 OKX(`XAU-USDT-SWAP`),其 1D bar 边界 = UTC 16:00(北京 0点),把「北京 8/5 全天」标成「08-04 日K」。用户看的图源边界 = UTC 0:00(北京 8点),该边界下「8月4日」是小阳线横盘(4044→4060),8月5日才是大阳线暴涨(+5%)。**同一日期标签,两套 K 线,导致「8月4日该扫出」判断错位。**
2. **量缩门对日线大周期误杀**(原始任务假设):黄金日线收敛窗口量缩连续根数不足 3 根,`consecutiveQuiet` 门槛卡掉。此问题随数据源更换需重新验证(币安 K 线边界不同,形态重判)。

**用户决策**:选币数据源整体替换为**币安**,架构设计**留切换口子**(后续做「切换交易所数据源」功能 + 对接 Free Replay)。黄金标的(币安 XAUUSDT)必须入扫描池。

**实测结论(币安 XAUUSDT + 当前算法,已回测)**:
- **4H 收敛已可扫出**:08-03T00:00 收敛窗口 `comp=0.20 trend=0.76 quiet=13 → QUALIFIED`。换币安边界后 4H 黄金收敛成立。
- **1D 仍差**:08-03 `comp=0.99 trend=0.80 quiet=2`(量缩差1根),08-04 `comp=0.92 quiet=0`(压缩略超+量缩0)。1D 关卡未过。
- 即:主问题是**数据源替换**;检测逻辑在 4H 已够,1D 需微调(量缩门槛 / 压缩阈值),次要。

## Background / Confirmed Facts

- **币安有真黄金永续**:`XAUUSDT`(黄金永续,24h quoteVolume 27.4亿,rank 3)、`XAGUSDT`(白银永续)。另有代币型 PAXGUSDT/XAUTUSDT。用户玩合约 → 数据源 = **币安 USDT-M 永续**(fapi)。
- **币安 USDT-M 永续验证通过**:
  - `fapi/v1/exchangeInfo` — 653 个 USDT 永续(含 XAUUSDT/XAGUSDT/PAXGUSDT/XAUTUSDT 贵金属)。
  - `fapi/v1/klines?symbol=XAUUSDT&interval=1d` — openTime 边界 UTC 0:00,字段 `openTime, open, high, low, close, volume, closeTime, quoteVol, trades, takerBuyBase, takerBuyQuote, ignore`;**XAUUSDT 8月4日 O=4060 H=4112 L=4050 C=4078 → amp 1.5% 横盘小阳线**(与用户视图一致),8月5日 C=4282 → 暴涨。
  - `fapi/v1/ticker/24hr` — 单次全量 728 个 USDT 永续,含 `quoteVolume`(USDT 计价直接可用)、`lastPrice`、`openPrice`、`priceChangePercent`。**无需分页。**
- **币安是永续合约**:无 OKX 式 `instType=SWAP` 区分(全 USDT-M 已是永续);symbol 无 `-USDT-SWAP` 后缀,如 `XAUUSDT`。`shortInstrument`/instrument 命名需适配。
- **稳定币对**:USDT-M 永续中仅 `USDCUSDT` 一个明显稳定币对(另有平台合成币如 USD1/TBY 需核实,但 qv 低不在 topN)。排除清单简单。
- **现有 OKX 数据源触点**(替换面):
  - `src/server/okx-tickers.ts` — 选币 + AlertMonitor 共用:全市场 ticker 拉取、按 24h quoteVolume 排序、`OkxTicker` 类型。
  - `src/server/candlestick-service.ts` — OKX history-candles,K 线缓存边界,`/api/candles` 与选币共用。
  - `src/server/okx-instrument-service.ts` — Free Replay 标的名录(OKX SWAP),经 `/api/free-replay/instruments`。
  - `src/server/coin-scan-service.ts` — 选币,用 tickers + candles,limit 公式 `max(window+consecutive, 2*boxWindow)+1`。
  - `src/server/alert-monitor.ts` — 警报,用 tickers 查最新价。
  - `src/server/app-plugin.ts` — wiring 上述所有。
- **spec 契约**(`.trellis/spec/server/market-data.md`):「Keep it a pure module function」「preserve BTC-USDT-SWAP style symbols」「Do not preload all history」「boundaryAnchor 的 UTC 偏移处理」。

## Requirements

- **R1 数据源抽象**:定义交易所数据源接口(`TickerSource`/`CandleSource`),币安实现 + 现有 OKX 实现并存,可切换。架构留「后续切换交易所」口子。
- **R2 币安 tickers**:`fapi/v1/ticker/24hr` 全量拉取 USDT 永续,排除稳定币对(`USDCUSDT` 等),按 `quoteVolume` 排序,产出 `Ticker { instrument, quoteVolume24h, lastPrice, change24h }`。黄金 XAUUSDT/XAGUSDT/PAXGUSDT/XAUTUSDT 在池内。
- **R3 币安 K 线**:`fapi/v1/klines` 适配现有 CandlestickService 契约(anchor/direction/limit/contiguity),形成 bar 过滤改为 `openTime + interval <= anchor`。日线边界 = UTC 0:00(北京 8点),与用户视图一致。
- **R4 选币池 + 黄金必检**:币安 USDT-M 永续(653 个),`minQuoteVolume24h` + `topN` 逻辑保留。**XAUUSDT 默认参数下应能扫出 8月4日横盘**(4H 已实测 QUALIFIED)。
- **R5 Free Replay 不动**:instrument 名录 / K 线保持 OKX;币安数据源独立供选币。用户明确「后面再对接 free replay」。
- **R6 AlertMonitor**:tickers 来源随数据源切换(币安),选币「设警报」的币安名才能被监控。

## Acceptance Criteria

- [ ] AC1:`MARKET_DATA_SOURCE` 未设时选币用币安;设 `okx` 回退 OKX。FreeReplay/TradeReview 两模式下均正常。
- [ ] AC2:币安 tickers 拉取含黄金 XAUUSDT,排除稳定币对(USDCUSDT 等),按 quoteVolume 排序。
- [ ] AC3:币安 K 线日线边界 UTC 0:00(无 OKX -8h 偏移),形成 bar 过滤正确;K 线缓存复用 CandlestickStore 无冲突。
- [ ] AC4:`computeQuietMetrics` 判定不回归(量缩/压缩/收窄三门);coin-scan-service 测试全绿。
- [ ] AC5:手动 4H 扫描 XAUUSDT 收敛出现(08-02~08-03 应 QUALIFIED),8月4日横盘在列。
- [ ] AC6:AlertMonitor 用币安 tickers,选币「设警报」的币安名可被监控。
- [ ] AC7:`npm test` 全绿 + `npx tsc --noEmit` 干净。

## Open Questions(不阻塞启动)

- 稳定币排除清单最终化:`USDCUSDT` 必排;USD1/TBY 等合成稳定币 qv 低不干扰,但清单应可扩展。
- 币安 API 限频:选币 topN 逐标的拉 K 线,fapi 限频 2400 req/min,topN=50 够用;勿无上限扩大 topN。

## Out of Scope

- 「切换交易所」完整功能(本任务只留接口口子)。
- Free Replay 数据源迁移(用户明确后面再做)。
- 横盘/箱体末期检测算法本身(4H 已实测可扫出;1D 关卡待验收后再定)。
- 量缩门放宽(1D 差量缩 1 根 + 压缩略超,验收后评估)。

## Notes

- 复杂任务:prd + design + implement。
- 触碰:`src/server/okx-tickers.ts`、`candlestick-service.ts`、`okx-instrument-service.ts`(不动)、`coin-scan-service.ts`、`alert-monitor.ts`、`app-plugin.ts`、`src/ui/CoinScanPanel.tsx`(shortInstrument)、`tests/`、`.trellis/spec/server/market-data.md`。
- 决策已定:环境变量切换(默认币安)、接口+两实现、选币全链路币安、警报切币安、FreeReplay 不动、稳定币排除、日线边界 UTC 0:00。
