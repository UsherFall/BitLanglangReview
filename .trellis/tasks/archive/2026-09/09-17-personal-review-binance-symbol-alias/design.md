# 设计：个人复盘币安符号解析 + OKX 回退

## 1. 边界

| 层 | 文件 | 改动 |
| --- | --- | --- |
| domain 符号 | `src/domain/instrument-symbol.ts` | 新增别名表 + `resolveCandleChain()`（纯函数，有序候选链） |
| server 元数据 | `src/server/binance-instrument-metadata.ts` | 内部缓存加 `status`；新增 `symbolStatuses()`；`load()` 契约不变 |
| server 编排 | `src/server/review-candle-source.ts`（新） | 按候选链取数 + `getCandlesForMode` 迁入 |
| route | `src/server/app-plugin.ts` | `source=binance` 分支改调编排器；无行情 → 502 + 具体 message |
| spec | `spec/server/market-data.md`、`spec/server/api-plugin.md` | 改写「No fallback」段 |
| 测试 | 新增 `tests/review-candle-source.test.ts`、`tests/instrument-symbol.test.ts`；补 metadata 用例 | |

**不动**：`CandlestickStore` schema、`BinanceCandleSource` / `CandlestickService` 内部逻辑、图表组件与 `fetchCandles` 契约、`drawings`、扫描与热度（它们直接持有 `BinanceCandleSource` 实例，不走本解析器 —— 扫描池按定义就是币安池，回退会让它失真）。

数据依据（用户 47 个可映射持仓，实测 2026-09-17）：

```
仅币安有(11): XAN BANK UAI EVAA SYN BR EPIC TUT BTW CYS 1000RATS
仅 OKX 有(2): SHIB RAY          ← 正好是本次两个问题符号
两源都无(1):  VANRY
```

结论：币安必须保持主源，OKX 只做不可用时的回退。

## 2. 为什么不能靠 klines 判定可用性

`RAYUSDT`（`status: SETTLING`）的 `fapi/v1/klines` 返回 **HTTP 200 + 冻结数据**（`0.248`/`volume=0`），与「行情安静」无法区分；`SHIBUSDT` 则返回 400 `-1121`。所以：

- 「符号不存在」可由 400 判定（或提前由 exchangeInfo 判定）；
- 「合约已下线清算」**只能**由 `exchangeInfo.status` 判定，必须从元数据层拿到。

## 3. 候选链（domain 纯函数）

```ts
// 仅收录「同一标的、同名同量纲、币安在交易」的替代符号
const BINANCE_SYMBOL_ALIASES: Record<string, string> = {
  RAY: 'RAYSOLUSDT',   // 币安 2022-11 把 RAYUSDT 下线清算，同名标的改挂 RAYSOLUSDT
};

resolveCandleChain('RAY-USDT-SWAP', statusOf)
  → [{ kind:'binance', symbol:'RAYSOLUSDT', reason:'alias' },
     { kind:'binance', symbol:'RAYUSDT',   reason:'mapped' },
     { kind:'okx',     instrument:'RAY-USDT-SWAP' }]
```

规则：

- `base` 从 `^([A-Z0-9]+)-USDT-SWAP$` 取；不匹配 → 只返回 `[]`（route 维持现有 `{candles: []}` 行为）。
- 币安候选去重后按 [别名, 机械] 排序。
- 每个币安候选带 `usable`：`statusOf(symbol) === undefined`（元数据降级 / 符号不存在）→ 不可用；`status === 'TRADING'` → 可用；其他（`SETTLING` 等）→ 不可用。**status 未知时不预判**（见 §7 降级）。
- OKX 回退恒为链尾，instrument 就是原始 OKX 风格符号。

### SHIB 为什么不进别名表

币安的 SHIB 替代符号是 `1000SHIBUSDT`，面值 1000 倍（0.0049 vs 交割单 0.000006027）。收进别名表就必须再引入一套价格缩放（并且会污染 drawings 的价位语义），而 OKX 有同名同量纲的 `SHIB-USDT-SWAP`（≈0.00000496）。**能用回退解决的，不引入缩放。**

同理，别名表只收「量纲不变」的符号；未来若出现只有币安有、且面值不同的标的，应当另立设计而不是往这张表里塞。

## 4. 元数据层暴露 status

`BinanceInstrumentMetadataSource` 内部缓存从 `Map<string, MarketClass>` 改为 `Map<string, { marketClass: MarketClass | null; status: string }>`：

- `load()` 签名与返回值**不变**（仍 `Map<string, MarketClass>`，过滤掉 `marketClass === null`）→ `BinanceTickerSource`、`metadataAvailable()` 判定（`size > 0`）、`tests/binance-instrument-metadata.test.ts` 的 7 个用例零改动。
- 新增 `symbolStatuses(): Promise<Map<string, string>>`：全符号 `symbol → status`；失败/非法载荷 → 空 map（与 `load()` 同一份缓存、同一次请求、同样降级）。
- 6h TTL + in-flight 去重逻辑不变。

## 5. 取数编排（server）

新 `src/server/review-candle-source.ts`：

```ts
export class ReviewCandleUnavailableError extends Error {}

export async function fetchReviewCandles(input: {
  binance: CandleSource; okx: CandleSource;
  instrument: string;            // OKX 风格
  timeframe: ReviewTimeframe;
  entryTime: string; mode: string; anchor: number;
  statusOf?: (symbol: string) => Promise<string | null>;
}): Promise<Candlestick[]>
```

流程：

```
chain = resolveCandleChain(instrument)          // 3 步以内
for (step of chain):
    binance 步：step.usable === false → 记下 reason，跳过（不发请求），继续
                step.usable === true  → 取数并【直接返回其结果】
                                        （含空窗口：那只是"这个区间没有更多数据"）
    okx 步    ：取数；有数据 → 返回
                空     → throw ReviewCandleUnavailableError(汇总的 reason)
```

三条硬规则（都在 tests/review-candle-source.test.ts 里锁死）：

1. **只有「状态判定为不可交易」才换源。** 已知不可交易的合约绝不发请求 —— 币安对 SETTLING 合约照样回 200 + 冻结价格，发了就是画直线。
2. **可交易候选的结果即为终局**，包括空窗口。否则右滚到当下之后每次都会因为「空结果也算失败」而弹错误；也不该为了一时没数据换交易所画另一个场子的价格。
3. **币安取数抛错原样上抛，不换源。** 否则 429/418 限频时图表会静默换成 OKX —— 两个场子价格不同，而且限频警告正是必须透出给用户的信息（`binanceRateGate` 的 warnings 只在扫描路径回传，图表路径靠 502 文案透出）。

因此 OKX 步**只可能**经「状态判定不可交易」到达；到达后仍为空，才说明两个场子都没有这个标的。

- `getCandlesForMode`（initial 两次取数 + `mergeCandles`）从 `app-plugin.ts` **原样迁入**并导出（OKX 单源分支复用），语义不变。
- 币安步成功即返回，不再尝试 OKX：正常符号仍只打一次币安请求（initial 为两次），不增加权重消耗。
- 元数据降级（`symbolStatuses()` 空）时链上币安步全部 `usable = true`，行为回到修复前。

## 6. Route 与 UI

`app-plugin.ts` 的 `/api/candles`：`source=binance` 分支删掉 `okxInstrumentToBinanceSymbol` 手写转换，改调 `fetchReviewCandles`（注入 `binanceCandleSource`、`candleService`、`binanceInstrumentMetadata().symbolStatuses()`）；`ReviewCandleUnavailableError` → `502 { error: message }`，其他错误维持原样 502。

**UI 零改动**：`ServerCandleError` 已把服务端 message 原样显示在 `.chart-status`（`App.tsx:1647`），这正是 429/418 已经在用的通道。message 形如：

```
VANRY-USDT-SWAP: 币安无可用合约(VANRYUSDT status=SETTLING)，OKX 无 VANRY-USDT-SWAP 行情
```

**拒绝的方案**：`200 { candles: [], notice }`。它要改 `fetchCandles` 的返回契约 + 7 个调用点 + `tests/candle-fetch.test.ts`，只为换一种提示样式；而「无行情」本身就是市场数据失败，走既有 502 + message 通道与 `spec/server/api-plugin.md`「Market-data failures should return 502」一致。放在 §8 里记录。

## 7. 降级与不变量

- **元数据不可用**（`symbolStatuses()` 空）：无法预判，链上币安步全部 `usable = true` 照发；此时链无法推进到 OKX，行为等同修复前 —— SHIB 仍 400、SETTLING 合约仍可能画出冻结直线。这是**已知残留**，写进 spec，不假装已解决（要消除就得引入「零成交窗口」启发式或「请求报错也换源」，前者会误伤安静行情，后者会掩盖限频）。
- **缓存键**：币安候选写 `base+USDT`，OKX 写 `X-USDT-SWAP`，两套词表天然隔离（`spec/server/market-data.md` 的 Cache-key namespace rule）。
- 别名候选与机械候选同属币安词表，因此库里 `RAYUSDT` 的 2111 根冻结行仍然存在，但不再被链选中（选中的是 `RAYSOLUSDT`）；不改 schema、不做数据清理。
- 扫描 / 热度 / FreeReplay / 交割单复盘（OKX）路径行为不变。
- `coversAnchorBar` / `contiguousCandles` / 缓存新鲜度等既有语义一律不动。

## 8. 被否掉的替代方案

| 方案 | 否决理由 |
| --- | --- |
| 只做别名表（SHIB→1000SHIBUSDT） | 需引入价格缩放，且要连带改 drawings 的价位语义；OKX 有同名同量纲符号，回退更简单 |
| 个人复盘整体换成 OKX 源 | 用户 47 个持仓里 11 个只有币安有，会从「两个币坏」变成「十一个币坏」 |
| 只报不可用 | RAY/SHIB 仍然没图，用户的两个抱怨只解决一半 |
| `200 + notice` 提示 | 契约改动面大于收益，见 §6 |

## 9. 验收映射

| PRD | 覆盖点 |
| --- | --- |
| R1 真实行情或明确提示 | 候选链 + `ReviewCandleUnavailableError` |
| R2 RAY 取到真实行情 | 别名 `RAY→RAYSOLUSDT`（实测 09-07 07:00Z RAYSOLUSDT 1.19–1.22 vs Bitget 开仓 1.2121） |
| R3 SHIB 同量纲 | OKX `SHIB-USDT-SWAP` 回退，不做 1000× 缩放 |
| R4 VANRY 明确提示 | 两源都无 → 502 + 具体 message |
| R5 不再靠字符串猜 | `exchangeInfo.status` 预判 + 候选链显式表 |
| AC 回归正常符号 | 币安步优先命中，请求数与修复前一致 |
