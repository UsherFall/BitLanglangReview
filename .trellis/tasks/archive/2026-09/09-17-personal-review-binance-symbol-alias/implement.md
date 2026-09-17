# 执行计划

验证命令（每个阶段跑一次）：

- `npx tsc --noEmit` —— 必须干净
- `npx vitest run` —— 基线 **54 文件 / 336 测试全绿**（2026-09-17 实测），完成后测试数只增不减

---

## 1. domain：候选链（纯函数）✅

- `src/domain/instrument-symbol.ts`
  - 保留 `okxInstrumentToBinanceSymbol` 原样（`tests/bitget-import.test.ts` 已锁契约，含 `1000PEPE-USDT-SWAP` 用例）。
  - 新增 `BINANCE_SYMBOL_ALIASES = { RAY: 'RAYSOLUSDT' }`（只收同名同量纲替代符号，附注释说明为何 SHIB 不在表内）。
  - 新增类型 `CandleChainStep = { kind: 'binance'; symbol: string; via: 'alias' | 'mapped' } | { kind: 'okx'; instrument: string }`。
  - 新增 `resolveCandleChain(instId, isBinanceUsable): CandleChainStep[]`：
    - 不匹配 `^[A-Z0-9]+-USDT-SWAP$` → `[]`；
    - 币安候选去重后 `[别名, 机械]`，用 `isBinanceUsable(symbol)` 过滤；
    - 真值表：`status === 'TRADING'` → 可用；`status === undefined`（符号不存在 or 元数据降级）→ **交给调用方决定**（见第 2 步的判定与第 3 步的降级），函数只接收布尔判定，不在 domain 里解析 status 字符串；
    - 链尾恒追加 `{ kind: 'okx', instrument: instId }`。

**验证**：`npx vitest run tests/instrument-symbol.test.ts`

## 2. metadata：暴露 status ✅

- `src/server/binance-instrument-metadata.ts`
  - 内部缓存类型 → `Map<string, { marketClass: MarketClass | null; status: string }>`，`fetchMap` 一次请求同时填两个字段（`status` 缺失时按 `'UNKNOWN'` 存）。
  - `load()` 的签名与返回**保持不变**（仍 `Map<string, MarketClass>`，过滤 `marketClass === null`）→ `BinanceTickerSource.metadataAvailable()` 的 `size > 0` 判定与既有 7 个用例不动。
  - 新增 `symbolStatuses(): Promise<Map<string, string>>`：失败/非法载荷 → 空 Map，与 `load()` 共享同一份缓存与 in-flight。

**验证**：`npx vitest run tests/binance-instrument-metadata.test.ts tests/binance-tickers.test.ts`

## 3. server：取数编排 ✅

- 新 `src/server/review-candle-source.ts`
  - `export class ReviewCandleUnavailableError extends Error {}`
  - 把 `getCandlesForMode` + `mergeCandles` 从 `app-plugin.ts` **原样迁入**并导出（`initial` = earlier 150 + later 150 合并；`earlier`/`later` = 单次 150）。语义一字不改。
  - `fetchReviewCandles(input)`：按第 1 步的链逐步取数。
    - 币安候选 `usable === false` → 记下 reason 跳过（不发请求），继续下一步；
    - 币安候选可用 → 取数并**直接返回其结果**（含空窗口，不换源）；
    - OKX 步 → 有数据则返回，仍为空则 `throw new ReviewCandleUnavailableError`（message 里带币安跳过原因）；
    - 币安取数抛错 → **原样上抛**，不换源（避免静默用 OKX 顶替 429/418 的图）。
  - `statusOf` 判定封装在 server 层：`symbolStatuses()` 为空（降级）→ 链上币安步全部可用（§7 降级）。

**验证**：`npx vitest run tests/review-candle-source.test.ts`

## 4. route：接线 ✅

- `src/server/app-plugin.ts`
  - `source=binance` 分支删掉手写的 `okxInstrumentToBinanceSymbol` + `queryInstrument` 逻辑，改调 `fetchReviewCandles`，注入 `binanceCandleSource` / `candleService` / `binanceInstrumentMetadata().symbolStatuses()`。
  - `ReviewCandleUnavailableError` → `502 { error: message }`；其余错误维持 502 原样。
  - 删掉已迁走的 `getCandlesForMode` / `mergeCandles` 与不再使用的 import。

**验证**：`npx tsc --noEmit && npx vitest run tests/app-bitget-mode.test.tsx tests/candle-fetch.test.ts tests/binance-candles.test.ts tests/candlestick-cache.test.ts`

## 5. 测试补齐 ✅

- 新 `tests/instrument-symbol.test.ts`：普通符号链、别名命中（RAY）、别名可用而机械符号不可用、非 `*-USDT-SWAP` → `[]`、去重（`isBinanceUsable` 全 false 时链只剩 OKX）。
- 新 `tests/review-candle-source.test.ts`（stub `CandleSource` + stub `statusOf`）：
  1. 正常符号 → 只调币安一次，不碰 OKX；
  2. `SETTLING` → 跳过该币安候选，命中 OKX 回退；
  3. 币安 400 抛错 → 落到 OKX；
  4. 两源皆空 → `ReviewCandleUnavailableError`，message 含两个源的原因；
  5. 元数据降级（`symbolStatuses` 空）→ 照发币安请求；
  6. `mode=earlier` / `mode=later` 仍单次取数，`mode=initial` 仍合并两次。
- `tests/binance-instrument-metadata.test.ts` 补 3 个用例：`symbolStatuses()` 返回 status、失败降级为空、与 `load()` 共享缓存（只发一次请求）。

**验证**：`npx vitest run`

## 6. spec 与文档 ✅

- `.trellis/spec/server/market-data.md`
  - 改写「Personal Review Candle Source: Binance (09/07)」段：去掉「No fallback / the chart shows the empty state」，改成候选链 + OKX 回退 + 无行情 502。
  - 记录 SHIB 不进别名表的理由（1000× 量纲）与 SHIB/RAY/VANRY 三个实测结论。
  - 记录 §7 的**已知残留**：元数据降级时 `SETTLING` 合约仍可能画出冻结直线。
- `.trellis/spec/server/api-plugin.md`：`GET /api/candles` 一行的行为描述同步（source=binance 走候选链；无行情 502 + message）。
- `CONTEXT.md`：`Market Data Source` 词条补一句「个人复盘按候选链取数，币安不可用时回退 OKX」。

**验证**：`npx vitest run`（spec 不改代码，只做终检）

## 7. 总检与提交 ✅

- `npx tsc --noEmit` 干净；`npx vitest run` → **56 文件 / 358 测试全绿**（基线 54 / 336）。新增 2 个测试文件 21 例 + metadata 补 4 例；`tests/bitget-import.test.ts` 随 `okxInstrumentToBinanceSymbol` 删除减 3 例。
- **真机核对已完成**（用一次性探针 `.scratch/review-candle-chain-live.probe.test.ts` 驱动真实 `BinanceCandleSource` + `CandlestickService` + 临时 SQLite，跑完即删，未触碰 `data/review.sqlite`）：

| 标的 | 命中 | 结果 |
| --- | --- | --- |
| `RAY-USDT-SWAP` | Binance `RAYSOLUSDT`（别名） | 150 根 15m，`flat=0`，0.8593 → 1.187（Bitget 该笔开仓 1.2121） |
| `SHIB-USDT-SWAP` | OKX `SHIB-USDT-SWAP`（回退） | 150 根，`flat=0`，收 0.000005428（交割单 0.000006027，同量纲） |
| `VANRY-USDT-SWAP` | 两源皆无 | `无可用行情数据(...): 币安 VANRYUSDT(合约状态 SETTLING)；OKX VANRY-USDT-SWAP 无 K 线` |
| `ZEC-USDT-SWAP` | Binance `ZECUSDT`（回归） | 150 根，`flat=0` |

`binanceInstrumentMetadata().symbolStatuses()` 实测返回 897 个符号的状态。

---

## 待确认 / 风险

- **残留**：元数据降级（exchangeInfo 拉取失败）时无法识别 `SETTLING`，`RAYUSDT` 会退回画冻结直线。已在 spec 记为已知残留；若要彻底消除需引入「零成交窗口」启发式判定，本任务不做（会误伤真正安静的行情）。
- **别名表维护**：`RAY → RAYSOLUSDT` 是静态事实（币安 2022-11 改名），不是猜测；新增条目必须逐个实测核对，不得按命名规律批量推导。
- **不清理旧缓存行**：库里 `RAYUSDT` / `VANRYUSDT` 的冻结行保留（不再被选中），避免对用户数据做破坏性迁移。

## 回滚点

改动集中在 4 个源文件（domain 1 / server 3）+ 2 个 spec + CONTEXT.md，`tests/` 只新增不删除。
第 1 步（domain 纯函数）与第 3 步（编排器）可独立回滚：`/api/candles` 的接线一旦回退到 `okxInstrumentToBinanceSymbol` + `BinanceCandleSource`，行为即完全回到修复前。
