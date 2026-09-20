# Implement: 个人复盘默认源 → Binance,撤回 Bitget 行情

## Ordered Checklist

### 1. 域名与标识
- [ ] `src/domain/candlestick.ts`:`CandleSourceId = 'okx' | 'binance'`(移除 `'bitget'`)。
- [ ] `src/domain/bitget-position.ts`:删除 `okxInstrumentToBitgetSymbol`;新增 `okxInstrumentToBinanceSymbol`(`X-USDT-SWAP → XUSDT`,否则 null)。注意保持 `bitgetSymbolToOkxInstrument` 不变。

### 2. 后端清理 + Binance 源路由
- [ ] `src/server/http.ts`:删除 `defaultBitgetMarketFetchJson`(保留 signed `defaultBitgetFetchJson`)。
- [ ] 删除 `src/server/bitget-candles.ts`。
- [ ] `src/server/app-plugin.ts`:
  - 移除 `BitgetCandleSource` import/实例及 `okxInstrumentToBitgetSymbol` import;
  - 引入 `okxInstrumentToBinanceSymbol`;
  - `/api/candles`:`source=binance` → 使用既有 `binanceCandleSource` 并做 OKX→币安名映射(null → `{candles:[]}`);其余走 `candleService`(缺省 okx)。

### 3. 前端
- [ ] `src/ui/App.tsx`:`reviewModeBindings.bitget.candleSource = 'binance'`。TradeChart/命名不变。

### 4. 测试
- [ ] 删除 `tests/bitget-candles.test.ts`。
- [ ] `tests/bitget-import.test.ts`:删除 `okxInstrumentToBitgetSymbol` describe,替换为 `okxInstrumentToBinanceSymbol` 往返/非法用例(或新建 instrument 映射测试文件,选改动最小)。
- [ ] `tests/app-bitget-mode.test.tsx`:`source=bitget` 断言 → `source=binance`。

### 5. Spec 同步
- [ ] `.trellis/spec/server/market-data.md`:将 "Bitget Candles (Personal Review)" 一节改写为 "Personal Review uses Binance (09/07)":记录滚动留存结论与三所深度对比、source=binance 语义、90 天 interval 上限与 Bitget 源撤回缘由。
- [ ] `.trellis/spec/server/api-plugin.md`:`/api/candles` source 说明改为 `okx|binance`。

### 6. 验证
- [ ] `npx tsc --noEmit` 通过(PowerShell 或 Bash 均可)。
- [ ] PowerShell `npx vitest run` 全量通过(Git Bash 下 vitest 有环境 bug)。
- [ ] 手动冒烟建议:ZEC 2026-06 单在 5m 出图(命中 fapi.binance.com)。

## Validation Commands

- `npx tsc --noEmit`
- PowerShell:`$env:NO_COLOR='1'; npx vitest run`

## Risky / Rollback

- app-plugin 路由:缺省 okx 保底;回滚 = 一行把 `reviewModeBindings.bitget.candleSource` 改回(但 Bitget 源代码若已删则需 revert commit)。
- 冲突点:前两个 commit 的文件被本任务删除/修改,实现时与最新 HEAD 对齐,避免误留 import。
