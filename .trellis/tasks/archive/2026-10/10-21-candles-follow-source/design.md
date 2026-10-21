# Design · K 线按各自行情源走

> 依据：`prd.md`（2026-10-21）。本文只讲技术设计，执行清单在 `implement.md`。

## 0. 一个必须先说的发现（比原计划更重要）

查 Bitget 历史仓位时发现：**Bitget 单子的开仓价是 Bitget 尺度**，而"个人交割单复盘"的 K 线现在走**币安**。

```
Bitget 仓位 PEPEUSDT：开仓价 0.0000050964 / 平仓价 0.0000050211
Bitget K线 PEPEUSDT：现价 0.0000045647            ← 同尺度 ✔
OKX K线  PEPE-USDT-SWAP：现价 0.000004561          ← 同尺度 ✔
币安 K线 1000PEPEUSDT：现价 0.0045498              ← 差 1000 倍 ✘
```

`reviewModeBindings.bitget.candleSource = 'binance'`（`src/ui/App.tsx:109`），而 `historyPositionToTrade` 把 `PEPEUSDT` 映射成 **OKX 名** `PEPE-USDT-SWAP`。

⚠️ **但我一开始的判断是错的，实测推翻了它**：`fetchReviewCandles` 的候选链**不会**用 `1000PEPEUSDT`。它先试 `base + USDT`（即 `PEPEUSDT`），币安没有 → **标记为不可用并落到 OKX 兜底**。实测：

```
PEPE-USDT-SWAP → [binance PEPEUSDT 不可用(无此合约), okx PEPE-USDT-SWAP]
QNT-USDT-SWAP  → [binance QNTUSDT 可用, okx ...]
```

**所以「个人交割单复盘」现在对 PEPE/SHIB/FLOKI 是走 OKX 的（同尺度，对得上）**，**不是** 1000 倍的错。`instrument-symbol.ts` 里那条硬规则（禁止 `SHIB → 1000SHIBUSDT` 的跨 scale 映射）正是为此存在的，而且**它是对的**。

实测四例的 OKX ↔ Bitget 价（都同尺度）：

| | OKX | Bitget |
| --- | --- | --- |
| PEPE | 0.000004561 | 0.0000045591 |
| SHIB | 0.000005172 | 0.000005174 |
| FLOKI | 0.00002486 | 0.00002483 |
| LUNC | **无此合约** | 0.00004682 |

⇒ **LUNC 是唯一的真问题**：OKX 没有 `LUNC-USDT-SWAP`，候选链会落到币安的 `1000LUNCUSDT`（差 1000 倍）。但**改成 Bitget 源正好修掉它**（Bitget 有 `LUNCUSDT`）。

⇒ **结论：这不是一个"已存在的错"，而是一个"本可以用对、现在只是绕了一圈"的现状。** 改成 Bitget 源的价值是：
1. **LUNC 这类币不再落回币安的 1000 前缀**（唯一的真错）；
2. **去掉一次无谓的候选链试错**（每个请求多一次失败的 exchangeInfo 判断）；
3. **开仓价与 K 线严格同源** —— 仓位价来自 Bitget，K 线也来自 Bitget，**永远同尺度**，不靠兜底。

**这仍然印证了用户的判断**：同源必然同名同尺度。Bitget 单子 → Bitget K 线，全程 `PEPEUSDT`，没有任何换算。

## 1. 边界总览

```text
src/domain/candlestick.ts        CandleSourceId 加 'bitget'
src/domain/bitget-position.ts    不再把 Bitget 符号映射成 OKX 名（保留 Bitget 名）
src/server/app-plugin.ts         /api/candles 加 source=bitget；/api/free-replay/instruments 加 bitget
src/server/review-candle-source.ts  Bitget 源不做候选链（它自己就是原生符号）
src/ui/App.tsx                   reviewModeBindings.bitget.candleSource = 'bitget'
src/ui/free-replay-chart.ts      FREE_REPLAY_CANDLE_SOURCE = 'bitget'；GRID = 'shanghai'
src/ui/OtherCoinChart.tsx        画线抽屉的源跟随扫描面板
src/ui/CoinScanPanel.tsx         把当前 source 传给抽屉
```

数据流（三个场景，各走各的源）：

```text
【选品】面板选源 → /api/scan?source=X  → 服务用 marketSources[X].candleSource（已是现状）
                                              ↓
       画线抽屉 source=X → /api/candles?source=X&instrument=<X 的符号>
                                              ↓
       线与 K 线同源同尺度 → 比例因子 = 1（兜底，不是日常路径）

【个人交割单复盘】Bitget 仓位 PEPEUSDT → instrument 保留 PEPEUSDT
                                    → /api/candles?source=bitget&instrument=PEPEUSDT
                                    → 开仓价与 K 线同一尺度 ✔（修掉 1000 倍的错）

【回溯复盘】会话 instrument → /api/candles?source=bitget → Bitget 名 → Bitget 源

【交割单复盘】OKX 名 → /api/candles（默认 OKX）→ 完全不动
```

## 2. `CandleSourceId` 加 `'bitget'`

`src/domain/candlestick.ts`：

```ts
export type CandleSourceId = 'okx' | 'binance' | 'bitget';
```

`CandleGrid` 的对应关系（`src/ui/chart-time.ts`）：

| source | grid | 依据 |
| --- | --- | --- |
| `okx` | `shanghai` | OKX 日线 00:00 北京时间开 |
| `binance` | `utc` | 币安日线 00:00Z 开 |
| `bitget` | `shanghai` | **实测**：Bitget 日线在 `16:00Z` 开 = 00:00 北京时间 |

⚠️ **切日差异的后果**：币安的 `1D` 与 Bitget 的 `1D` 不是同一根 K 线（起点差 8 小时）。**不做对齐**（用户已定：每个环节跟自己的源走）。但必须记录：**跨源的"日线形态"比较没有意义**，同一场景内自洽即可。

## 3. `/api/candles` 加 `source=bitget`

路由现在有三条路（`src/server/app-plugin.ts:225`）：

```ts
const candles = source === 'binance'      ? await fetchReviewCandles({...})
            : source === 'binance-only'  ? await fetchBinanceOnlyCandles({...})
            :                              await getCandlesForMode({ candleSource: candleService, ... });
```

加一条：

```ts
: source === 'bitget' ? await getCandlesForMode({
    candleSource: bitgetCandleSource,
    instrument, timeframe, entryTime, mode, anchor,
    allowPaging: true,          // ← 见 §3.1
  })
```

**为什么是 `getCandlesForMode` 而不是候选链**：Bitget 的符号**就是原生符号**（`BTCUSDT`），不需要翻译。候选链（`resolveCandleChain`）是给"OKX 名的交易"用的，Bitget 源不需要。

### 3.1 翻页：`allowPaging: true`

`BitgetCandleSource` 的翻页是 **opt-in**（`allowPaging`），理由写在 `src/server/market-data.ts:49`：选品扫描的 1D 要 100 根，而 Bitget 的 `/candles` 单次上限 90 → 开翻页会改变 `coarseStructure` 的 `posRange`，即改变候选集。

**但图表不一样**：
- 图表的 `limit` 是 150（`getCandlesForMode` 里硬编码），1D 在 Bitget 单次只能拿 90 → **必须翻页**，否则往回翻历史会缺一大截。
- 翻页的代价：1D 需要 2 页（90 + 60），5m 需要 2 页。`fetchEarlierPaged` 已经实现并测过（6 个测试）。
- 实测 1D 通过 `/history-candles` 能回到 **2020-09-10**。

⚠️ **一个已知的坑**（`src/server/bitget-candles.ts:161` 的注释）：`/candles` 与 `/history-candles` 对 `endTime` 的语义**不一致** —— 前者返回"包含 endTime 的那根"，后者只返回"endTime 之前已收盘的"。翻页游标必须用 `oldest` 本身（不是 `oldest - 1`），否则会留下一天空洞、导致死循环重取同一页。**这段逻辑已经在 `fetchEarlierPaged` 里处理好了，图表直接用即可**，但测试要覆盖。

### 3.2 `later` 方向

Bitget 的 `later` 走单次请求：`startTime = anchor + 1`，`endTime = anchor + min(step × limit, 90 天)`（`src/server/bitget-candles.ts:111`）。

- 1D × 150 根 = 150 天 > 90 天上限 → 会被夹到 90 天 → **只能拿到 90 根**，需要翻页才能补齐。
- 但 `later` 的翻页**没有实现**（`fetchEarlierPaged` 只处理 `direction === 'earlier'`）。
- **回溯复盘往右翻**会用到 `later`（`loadMore('later')`）→ 需要**对称实现** `later` 翻页，或接受 90 根的上限。

**决策**：先实现 `later` 的翻页（对称于 `earlier`），因为回溯复盘的核心动作就是往右翻。

### 3.3 缓存命名空间

`BitgetCandleSource` 内部用 `bitget:` 前缀（`BITGET_KEY_PREFIX`）→ 与币安/OKX 的行不冲突，**无需额外处理**。

## 4. 「个人交割单复盘」改用 Bitget 源

### 4.1 instrument 不再映射成 OKX 名

`src/domain/bitget-position.ts`：

```ts
export function bitgetSymbolToOkxInstrument(symbol: string): string | null {
  if (!/^[A-Z0-9]{2,}USDT$/.test(symbol)) return null;
  const base = symbol.slice(0, -4);
  if (!base) return null;
  return `${base}-USDT-SWAP`;
}
```

这个映射是为了"让复盘图表有 K 线"（当时只有 OKX 源）。现在有 Bitget 源了，**应当保留 Bitget 原名**。

⚠️ **影响面**：这个 `instrument` 会流进：
- `trade_reviews`（复盘记录，按 instrument 关联）—— 改名会**失联**已有的复盘标注；
- `chart_drawings`（画线，按 instrument 关联）—— 改名会失联；
- `bitget_positions` 缓存的 `raw_json`（symbol 是原始的，不受影响）。

**决策**：**保留 `bitgetSymbolToOkxInstrument` 不动**，另加一个函数返回 Bitget 原名，并让**图表请求**用 Bitget 名。这样：
- 存储层（复盘记录、画线）继续用 OKX 名 → **已有的复盘标注和画线不丢**；
- 图表请求时把 OKX 名翻回 Bitget 名（`PEPE-USDT-SWAP` → `PEPEUSDT`）→ K 线与开仓价同尺度。

这个"翻译"是**纯改名**（同尺度），不是面值换算 —— 因为 Bitget 与 OKX 都是 0.0000045 量级。**实测确认**：OKX `PEPE-USDT-SWAP` = 0.000004561，Bitget `PEPEUSDT` = 0.0000045647。

⇒ 需要一个 `okxInstrumentToBitgetSymbol(instId)`：`BTC-USDT-SWAP` → `BTCUSDT`。

⚠️ **但纯改名不总能成立**：Bitget 有、OKX 没有的币（如 `LUNCUSDT`）→ 翻译会得到 Bitget 侧确实存在的符号，**这正是修掉 LUNC 落回币安 1000 前缀的办法**。而 Bitget 没有、OKX 有的币 → 翻译得到一个不存在的符号 → 图表无 K 线（**这是唯一的降级**，要在 UI 上说出来）。

### 4.2 `reviewModeBindings.bitget.candleSource`

```ts
bitget: { endpoint: '/api/bitget/trades', candleSource: 'bitget' },
```

`reviewCandleSource('bitget')` → `'bitget'` → 图表请求 `source=bitget`。

⚠️ 但图表的 instrument 仍是 OKX 名（存储层）→ `source=bitget` 的路由必须**接受 OKX 名并翻译成 Bitget 名**。所以翻译应该发生在**路由层**（服务端），而不是 UI 层 —— 这样所有调用方都受益。

⇒ `/api/candles?source=bitget&instrument=PEPE-USDT-SWAP` → 服务端翻译成 `PEPEUSDT` 再请求 Bitget。

## 5. 回溯复盘改用 Bitget 源

### 5.1 常量

```ts
// src/ui/free-replay-chart.ts
export const FREE_REPLAY_CANDLE_SOURCE = 'bitget';
export const FREE_REPLAY_CANDLE_GRID: CandleGrid = 'shanghai';
```

### 5.2 会话兼容（关键）

`free_replay_sessions` 表的主键是 `(instrument, start_time)`，`instrument` 现在存的是 **OKX 名**（`MUBARAK-USDT-SWAP` / `QNTUSDT` 混着 —— 实测 3 个会话里有 2 个 OKX 名、1 个已经是 Bitget 名）。

`FreeReplaySessionPayload` **没有 `candleSource` 字段**。

**决策**：给会话加**可选**字段 `candleSource?: CandleSourceId`：
- 旧会话**没有**该字段 → 保持旧行为（OKX 名 + 币安源）→ **旧会话不丢**；
- 新会话写入 `candleSource: 'bitget'` + Bitget 名。

⇒ 迁移：表加一列 `candle_source text`（NULL = 旧行为），与 `drawing-store` 的迁移同模式。

⚠️ **注意 `QNTUSDT` 这个已有的会话**：它的 instrument 已经是 Bitget 名（可能是手工建的），但没有 `candle_source` → 按旧行为处理（币安源 + OKX 名的假设）→ 它的 instrument 是 `QNTUSDT`，币安源查 `QNTUSDT` 存在 → 能出图。**不需要特殊处理**。

### 5.3 instrument 列表

`/api/free-replay/instruments` 现在只支持 `okx` / `binance`。回溯复盘面板（`src/ui/FreeReplayPanel.tsx:63`）请求**不带 source** → 默认 `binance`。

→ 加 `source=bitget` → 用 Bitget 的合约列表（`/api/v2/mix/market/contracts`）。`BitgetInstrumentMetadataSource` 已经在拉这个端点（为了分类），但只保留 `marketClass`，**没有保留完整符号列表** → 要么加一个 `listSymbols()`，要么复用 `bitgetTickerSource.listTickers()` 的 symbol 列表（更快，已经是缓存的）。

⇒ **用 `bitgetTickerSource.listTickers()`** —— 已经有 30s TTL 缓存，不用额外请求。

### 5.4 切日对回放的影响（要逐个核对）

`CandleGrid` 从 `utc` 变 `shanghai`，影响这些函数（`src/ui/chart-time.ts`）：

| 函数 | 受影响？ |
| --- | --- |
| `markerTimeForEvent` | 是 —— 标记点的时间落到哪根 K 线 |
| `timeframeTimeForPoint` | 是 —— 画线点的 x 坐标 |
| `freeReplayCursorTimeForProgress` | 是 —— 进度 → 光标 |
| `freeReplayCandleCompletionTime` | 是 —— K 线收盘时刻 |
| `entryVisibleRange` | 是 —— 初始视窗 |

全部都接受 `grid` 参数 → **传对就行**，但要测。

## 6. 画线抽屉跟随扫描源

### 6.1 现状

`src/ui/App.tsx` 的画线抽屉写死 `candleSource="binance"`；`OtherCoinChart` 的 `initialInstrument` 是扫描行的 instrument（**已经是该源的符号**：`PEPEUSDT` for Bitget / `1000PEPEUSDT` for 币安）。

### 6.2 改动

- `App` 持有扫描面板的 `source`（选品面板已经在 `App` 里持有 `scanResult`，`source` 也要提升到 `App`）。
- 抽屉的 `OtherCoinChart` 收到 `candleSource={scanSource}`（`'binance' | 'okx' | 'bitget'`）。
- `OtherCoinChart` 的 `venue` 与 `CandleGrid` 的映射要加 `bitget` → `shanghai`。
- `OtherCoinChart` 的 instrument 列表请求 `/api/free-replay/instruments?source=bitget` → 也要支持（§5.3 一起做）。

### 6.3 选品面板的 source 要提升到 App

现在 `CoinScanPanel` 内部持有 `source` state（`src/ui/CoinScanPanel.tsx`），`App` 拿不到。→ 加一个 `onSourceChange` 回调（和 `onScopeChange` 同样的模式）。

## 7. 兼容矩阵

| 场景 | instrument | K 线源 | 改动 |
| --- | --- | --- | --- |
| 交割单复盘 | `BTC-USDT-SWAP` | OKX | **不动** |
| 个人交割单复盘 | `PEPE-USDT-SWAP`（存储） | **Bitget**（服务端翻译成 `PEPEUSDT`） | 改源 |
| 回溯复盘（旧会话） | OKX 名 | 币安 | **不动**（无 `candle_source`） |
| 回溯复盘（新会话） | `BTCUSDT` | Bitget | 改 |
| 选品（币安源） | `1000PEPEUSDT` | 币安 | 抽屉改 |
| 选品（Bitget 源） | `PEPEUSDT` | Bitget | 抽屉改 |
| 选品（OKX 源） | `PEPE-USDT-SWAP` | OKX | 抽屉改 |

**不变式**：**每个场景里，图表的 K 线与该场景自己的价格数据同尺度。** 没有任何跨 scale 换算。

## 8. 测试计划

| 文件 | 覆盖 |
| --- | --- |
| `tests/bitget-candles.test.ts`（扩） | `later` 方向的翻页（新增实现）；`earlier` 翻页到 150 根；1D 翻 2 页 |
| `tests/free-replay-instruments.test.ts`（扩） | `source=bitget` 返回 Bitget 符号列表 |
| `tests/bitget-position.test.ts`（新/扩） | `okxInstrumentToBitgetSymbol` 的翻译（`PEPE-USDT-SWAP` → `PEPEUSDT`；拒绝非 USDT 永续） |
| `tests/free-replay-panel.test.tsx`（扩） | 回溯复盘的 instrument 列表走 Bitget；会话写入 `candleSource` |
| `tests/other-coin-chart.test.tsx`（扩） | `source=bitget` 时 grid = `shanghai`；instrument 列表请求带 `source=bitget` |
| `tests/coin-scan-panel.test.tsx`（扩） | 选品面板的 `source` 变化能通知 `App`（`onSourceChange`） |
| `tests/app-free-replay.test.tsx`（扩） | 旧会话（无 `candle_source`）仍走币安；新会话走 Bitget |

## 9. 风险与回滚

| 风险 | 应对 |
| --- | --- |
| 回溯复盘换源后光标/进度错乱（切日变了） | 逐个核对 `chart-time.ts` 的 grid 参数；新会话与旧会话分两条路；旧会话行为不变 |
| Bitget `later` 翻页没实现 → 往右翻只有 90 根 | 实现对称翻页；不实现也能跑（只是翻不满） |
| Bitget 限频 20 req/s → 图表翻页慢 | 图表是手动操作；缓存命中时零请求 |
| 改 `instrument` 命名会丢复盘标注 | **不改**存储层的 instrument；只在**请求层**翻译 |
| `source=bitget` 的路由接受 OKX 名，容易误解 | 路由注释写明：接受两种命名，内部统一成 Bitget 原生符号 |

## 10. 不做什么

- 面值换算（同源同名同尺度，用户已拍板）
- 跨源日线切日对齐
- 选品粗筛 / 距线口径
- 交割单复盘的任何改动
- Bitget 源的现货（只做 USDT-FUTURES 合约）
