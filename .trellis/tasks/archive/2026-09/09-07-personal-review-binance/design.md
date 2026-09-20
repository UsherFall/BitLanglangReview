# Design: 个人复盘默认源 → Binance,撤回 Bitget 行情

## 架构

```
                     ┌────────────────────────────────────────────┐
 /api/candles        │ source 参数 → 选择 CandleSource             │
 ?source=okx|binance │   okx     → CandlestickService(OKX,默认)   │
                     │   binance → BinanceCandleSource            │
                     │             instrument: OKX名→币安 native 名 │
                     └────────────────────────────────────────────┘
```

- **来源标识**(domain/candlestick.ts):`CandleSourceId = 'okx' | 'binance'`(移除 `'bitget'`)。
- **新增纯函数** `okxInstrumentToBinanceSymbol(instId)`:`ZEC-USDT-SWAP → ZECUSDT`;非 `[A-Z0-9]{2,}-USDT-SWAP` 返回 null。与 Bitget 映射的规则一致(两所 native 符号同为 `base+USDT`),放在领域层可测。原 `okxInstrumentToBitgetSymbol` 删除(仅被撤回的 bitget 源路由使用)。
- **/api/candles 路由**(app-plugin.ts):
  - `source=binance` → 使用已有 `binanceCandleSource` 实例(coin scan 默认即 Binance,共享实例/缓存/限速预算;`BinanceCandleSource` 以 native 名落库,缓存天然隔离)。
  - `source` 缺省或 `okx` → `candleService`(现状),其它来源一律按缺省 okx(向后兼容)。
  - 映射失败(null)或请求为空 → `{ candles: [] }`,不回退(AC/R6)。
- **前端绑定**(App.tsx):`reviewModeBindings.bitget = { endpoint: '/api/bitget/trades', candleSource: 'binance' }`。TradeChart 传参逻辑不变(`candleSource` prop + URL `source=`)。

## 需要删除/替换(避免死代码)

| 位置 | 处理 |
|---|---|
| `src/server/bitget-candles.ts` | 删除文件 |
| `src/server/http.ts::defaultBitgetMarketFetchJson` | 删除(保留 signed `defaultBitgetFetchJson` 供持仓同步) |
| `src/domain/bitget-position.ts::okxInstrumentToBitgetSymbol` | 删除(保留 `bitgetSymbolToOkxInstrument`,持仓导入仍用) |
| `src/server/app-plugin.ts` 的 `BitgetCandleSource` import/实例与 `source=bitget` 分支 | 改为 binance 分支 |
| `tests/bitget-candles.test.ts` | 删除 |
| `tests/bitget-import.test.ts` 的 `okxInstrumentToBitgetSymbol` describe | 移除(仅正/逆向映射用例删除) |
| `tests/app-bitget-mode.test.tsx` | `source=bitget` 断言改为 `source=binance` |

> 前两个 commit 中记录的知识(90 天 interval 上限、滚动留存)收敛进 spec 文本,不随代码删除。

## Binance 与现有 review 的语义差异(记录,不改行为)

- Binance 日线对齐 **UTC 0:00**(BinanceCandleSource 无 -8h),与 OKX/UTC+8 日线差 8h 边界;trade 的 entry/exit 时间戳仍按"包含该时刻的 bar"落在正确日期,仅跨 UTC 日界的图形上价格归属日可能差一天。个人复盘接受此差异(用户选定 Binance)。免费复盘/交割单不受影响。
- Binance fetch 走 `defaultBinanceFetchJson`(共享 ~9 req/s pacer 与 429/418 gate),review 请求量小,不影响 scan。

## 兼容与回滚

- `/api/candles` 缺省 `okx`,freeReplay/OtherCoin/heat 链路零改动。
- 回滚点:本任务与"改名+模块化"解耦;若 Binance 不合预期,改回 `candleSource:'okx'` 一行即可。

## 测试

- 新增 `okxInstrumentToBinanceSymbol` 单测(放 `tests/bitget-import.test.ts` 保留正映射 describe? 否——新建或并入 instrument 映射 describe;具体:在 `tests/bitget-import.test.ts` 中将原逆向 describe 替换为 Binance 映射 describe,或新建 `tests/market-instrument.test.ts`。实现时选改动最小者)。
- UI:app-bitget-mode 断言 `source=binance`。
- 回归:全量 vitest + tsc;确认 scan/market-heat(Binance)/freeReplay(OKX)不受影响。
