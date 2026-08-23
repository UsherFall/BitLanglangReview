# 选币数据源替换为币安 — Implement

## 前置

工作区:`.trellis/tasks/08-04-coin-scan-box-end/` 是另一任务 planning,与本任务无关,不碰。

## 实施清单(按序)

1. **接口**:新建 `src/server/market-data.ts` — `Ticker`、`TickerSource`、`CandleRequest`、`CandleSource` 类型。
2. **币安 tickers**:新建 `src/server/binance-tickers.ts` —
   - `fapi/v1/ticker/24hr` 全量拉取;排除稳定币对(清单 `USDCUSDT` 等);按 `quoteVolume` 排序。
   - `BinanceTickerSource implements TickerSource`,产出 `Ticker { instrument, quoteVolume24h, lastPrice, change24h }`。
   - 黄金 XAUUSDT/XAGUSDT/PAXGUSDT/XAUTUSDT 自然在池。
3. **币安 K 线**:新建 `src/server/binance-candles.ts` —
   - `BinanceCandleSource implements CandleSource`:`fapi/v1/klines`;`timestamp = openTime`(UTC 0:00 边界,**无 OKX -8h 偏移**);形成 bar 过滤 `openTime + intervalMs <= anchor`;复用 contiguity 逻辑。
   - 缓存复用 `CandlestickStore`。
4. **OKX 适配接口**:`okx-tickers.ts` 改导出 `OkxTickerSource implements TickerSource`;`candlestick-service.ts` 适配或抽 `OkxCandleSource implements CandleSource`(FreeReplay 继续用)。
5. **service**:`coin-scan-service.ts` 依赖 `TickerSource`/`CandleSource` 接口,不再 import `fetchOkxTickers`。
6. **alert**:`alert-monitor.ts` `TickerFetcher` → `TickerSource`,注入币安实现。
7. **wiring**:`app-plugin.ts` — `marketDataSource` option + `MARKET_DATA_SOURCE` env(默认 `binance`);选币用币安源,FreeReplay 用 OKX 源(共享 store)。
8. **UI**:`shortInstrument` 兼容无 `-USDT-SWAP` 后缀名(币安 `XAUUSDT` 直接返回原名)。
9. **spec**:`.trellis/spec/server/market-data.md` 契约更新(币安数据源、命名、边界、稳定币排除)。
10. **gate**:`npm test` 全绿 + `npx tsc --noEmit` 干净;手动 `npm run dev` 扫 1H/4H 看 XAUUSDT 是否出现。

## 验证命令

- `npm test` — 每步后聚焦 `tests/coin-scan-service.test.ts`、`tests/alert-monitor.test.ts`;最后全量。
- `npx tsc --noEmit` — 类型干净。
- `npm run dev` — 手动:4H 扫描 XAUUSDT 收敛(08-02~08-03 应 QUALIFIED);对照 8月4日横盘;`MARKET_DATA_SOURCE=okx` 验证回退。

## 风险文件 / 回滚点

- **`src/server/app-plugin.ts`** — wiring;默认币安行为变化,`MARKET_DATA_SOURCE=okx` 回退。
- **`src/server/coin-scan-service.ts`** — 接口改造;漏改则编译错。
- **`src/server/alert-monitor.ts`** — 数据源切换;注入币安后旧 OKX 警报失效(命名隔离)。
- **`src/server/binance-candles.ts`** — K 线边界/形成 bar 逻辑;日线边界不对则黄金判定错位。
- **限频**:topN=50 逐标的拉 K 线,fapi 2400 req/min 够;勿无上限扩大 topN。

## task.py start 前复查

- [ ] 工作区只含本任务改动(08-04 任务目录忽略)。
- [ ] prd.md / design.md / implement.md 就位。
- [ ] implement.jsonl / check.jsonl 有真实 spec 条目。
- [ ] 用户已 review 规划。
