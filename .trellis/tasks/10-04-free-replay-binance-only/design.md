# 回溯复盘改用币安行情源 — 技术设计

## 1. 现状

### 1.1 数据流

```
前端 /api/candles?instrument=BTC-USDT-SWAP&... （不带 source）
  → app-plugin.ts:175  getCandlesForMode({ candleSource: candleService })   ← OKX

前端 /api/candles?...&source=binance
  → app-plugin.ts:164  fetchReviewCandles({ binance, okx, ... })            ← 候选链
```

回溯复盘全程用 OKX 风格命名 + OKX 数据源，两者是自洽的。

### 1.2 时间轴网格（两处，必须同步改）

| 位置 | 作用 | 现状 |
|---|---|---|
| `chart-time.ts:131-148` `floorTimestamp` | 前端把时间点落到 K 线边界、算可见范围 | `1D`/`1M` = 上海零点（`-8h`）；`1W` = UTC 周日 0 点 |
| `candlestick-service.ts:99-107` `boundaryAnchor` | 服务端算 OKX 请求锚点 | `1D` 有 `-8h` 偏移；其余为纯 UTC |

实测两个源的网格（`Z` = UTC）：

| 周期 | OKX 边界 | 币安边界 | 现状是否匹配币安 |
|---|---|---|---|
| `1m`–`4H` | UTC | UTC | ✅ 匹配 |
| `1D` | `16:00Z` = 北京 00:00 | `00:00Z` = 北京 08:00 | ❌ 差 8 小时 |
| `1W` | `16:00Z` = 北京周一 00:00 | 周一 `00:00Z` = 北京周一 08:00 | ❌ 差 8 小时且错一天 |
| `1M` | 月初 `16:00Z` = 北京初一 00:00 | 月初 `00:00Z` = 北京初一 08:00 | ❌ 差 8 小时 |

**网格基准（用户确认）**：本项目的日线体系以**北京 08:00（= UTC 0 点）**为分界，与用户实盘习惯一致，也与币安完全一致。OKX 的北京 00:00 边界比这个基准早 8 小时，等于每根 K 线都掺入前一夜 8 小时的行情 —— 这是 OKX 侧的问题，不是我们要对齐的目标。

实测币安三个周期都落在北京 08:00：日线 `10-04T00:00Z`、周线 `09-21T00:00Z`（周一）、月线 `10-01T00:00Z`。

**`1W` 要单独改算法**：现状 `timestamp - timestamp % 7d`（名义 7 天、按 UTC 周日 0 点）。实测对 `2026-10-02T16:00Z` 给出 `2026-10-01T00:00Z`（周四），偏 **80 小时**。目标应是**周一 00:00 UTC** 且按真实日历周计算（跨月周不能按固定 7 天推）。不能只删 `-8h`。

**`1M` 只需删 `-8h`**：现状 `Date.UTC(y, m-1, 1) - 8h` 删掉偏移后即为月初 UTC 0 点，与币安一致。


### 1.3 符号映射

`resolveCandleChain`（`instrument-symbol.ts:68`）已实现 `BTC-USDT-SWAP → BTCUSDT`。只绑币安后仍需这层映射，但**列表侧也要产出币安符号**，否则列表与请求不一致。

## 2. 方案

### 2.1 数据源切换：新增 `source=binance` 的显式化

回溯复盘的调用方（`App.tsx` 的 `FreeReplayChart`、`OtherCoinChart`、`FreeReplayPanel`）都改为传 `source=binance`。

`app-plugin.ts` 的 `source === 'binance'` 分支目前走 `fetchReviewCandles`（候选链，会在币安不可用时退 OKX）。需要一个**只绑币安**的入口。

**决定**：在 `review-candle-source.ts` 加 `fetchBinanceOnlyCandles`，与 `fetchReviewCandles` 并列：

```ts
export async function fetchBinanceOnlyCandles(request: ReviewCandleRequest): Promise<Candlestick[]> {
  // 币安原生符号由调用方给出（列表已是币安符号）
  return getCandlesForMode({ candleSource: request.binance, instrument: request.instrument, ... });
}
```

- 不做符号转换 —— 列表已经是币安符号
- 不做 OKX 回退 —— 币安失败（429/418）时错误直接上抛，由 `candle-fetch.ts` 的 `ServerCandleError` 透出给用户（`review-candle-source.ts:43-48` 已确立此规则）

路由上用**新的 `source` 值**区分，避免和「个人交割单复盘」的候选链混淆：`source=binance-only`。

### 2.2 合约列表：新增 `BinanceInstrumentService`

`okx-instrument-service.ts` 保留（交割单复盘仍在用？—— 见 2.5），新增读币安 `exchangeInfo`：

```ts
export class BinanceInstrumentService {
  async listSwapInstruments(): Promise<string[]>   // quoteAsset=USDT && status=TRADING，不限 contractType
}
```

`free-replay-instruments.ts` 的 `freeReplayInstrumentPayload` 改为注入币安服务。

筛选口径按 R6：`quoteAsset=USDT` + `status=TRADING`，**不限 `contractType`**（否则漏掉 `QNTXUSDT` 的 `TRADIFI_PERPETUAL` 和 `1000SHIBUSDT`）。

读取失败时抛错 → `app-plugin.ts:140` 已有 502 分支，UI 侧 `FreeReplayPanel` 的 `status` 会显示。

### 2.3 时间轴网格改为 UTC 零点

**`chart-time.ts` `floorTimestamp`**：

```ts
if (timeframe === '1M') return Date.UTC(year, month - 1, 1);              // 去掉 -8h
if (timeframe === '1W') return weekStartUtc(timestamp);                  // 新 helper，周一 00:00 UTC
if (timeframe === '1D') return Date.UTC(year, month - 1, day);            // 去掉 -8h
```

`weekStartUtc`：`const d = new Date(timestamp); const dow = (d.getUTCDay() + 6) % 7; return timestamp - dow*86400000 - (d.getUTCHours()*3600000 + d.getUTCMinutes()*60000 + d.getUTCSeconds()*1000 + d.getUTCMilliseconds());`

注意现有 1W 用 `timestamp - timestamp % 7d`，那个 `7d` 是**名义步长**，与真实周（跨月时天数不同）不符；改成按日历算周一起。

**`candlestick-service.ts` `boundaryAnchor`**：删掉 `1D` 的 `-8h` 偏移，使它与 `floorTimestamp` 一致。`1W`/`1M` 同理按日历。

⚠️ **一致性风险**：这两个函数分处前后端，若只改一个，会出现「服务端按新网格取窗口、前端按旧网格定位」→ 标记落不到 K 线上。必须同一次改动里一起改，并由测试锁定。

### 2.4 币安源的 1W/1M 已知隐患

`binance-candles.ts` 的 `boundaryAnchor`（该文件内的私有副本）注释已指出：「that floors by the nominal `1W`/`1M` step, but Binance weeks open on Monday and months on the 1st」。该文件已用 `coversAnchorBar` 从**缓存实际间距**取步长来规避，本次不改。

但 `getCandlesForMode` 的 `later` 分支用 `mode: 'later'` + `anchor`，实际锚点算在 `binance-candles.ts` 内部。改网格时需回归这条路径。

### 2.5 交割单复盘不受影响

- `/api/candles` 不传 `source` 仍落 OKX → 交割单复盘、其他币面板（trade 模式）行为不变
- `OkxInstrumentService` 保留，不删

**但注意**：`OtherCoinChart` 在回溯复盘下会传 `source=binance-only`，在交割单复盘下不传。同一组件按 prop 决定，故 `source` 必须由父组件传入而非组件内写死。

## 3. 改动清单

| 文件 | 改动 |
|---|---|
| `src/server/review-candle-source.ts` | 新增 `fetchBinanceOnlyCandles`（无 OKX 回退、无符号转换） |
| `src/server/app-plugin.ts` | `/api/candles` 增加 `source=binance-only` 分支；`/api/free-replay/instruments` 改用币安服务 |
| `src/server/binance-instrument-service.ts`（新建） | 读 `exchangeInfo`，按 R6 口径返回币安符号 |
| `src/ui/chart-time.ts` | `floorTimestamp` 去 `-8h`；`1W` 改按日历算周一 UTC |
| `src/server/candlestick-service.ts` | `boundaryAnchor` 去 `1D` 的 `-8h`，与前端对齐 |
| `src/ui/App.tsx` | `FreeReplayChart` 与回溯模式 `OtherCoinChart` 的 `/api/candles` 请求加 `source=binance-only` |
| `src/ui/FreeReplayPanel.tsx` | 无需改（列表接口路径不变，只是数据源变了） |
| `CONTEXT.md` | 更新 `Market Data Source` / `Free Replay Instrument List` 词条 |
| 测试 | `chart-time.test.ts`、`candlestick-cache.test.ts`、`app-free-replay.test.tsx` 按新网格更新；新增币安源与列表的用例 |

## 4. 风险

| 风险 | 规避 |
|---|---|
| 前后端网格不同步 → 标记错位 | 两处同一次改；测试同时锁定 `floorTimestamp` 与 `boundaryAnchor` 对同一时间给出相同边界 |
| 币安限频（418 ban）打到回溯复盘 | 不静默回退（`fetchBinanceOnlyCandles` 错误上抛）；`ServerCandleError` 透出提示 |
| 旧会话 instrument 存的是 OKX 风格名 | 恢复时按 `resolveCandleChain` 同一规则换算；已查证三币均可用 |
| OKX 旧缓存成为死数据 | 与币安符号在缓存主键上不冲突，留存不清理 |
| `1W` 按名义 7d 算在跨月周错位 | 改按日历计算周一起 |
| 列表符号与请求符号不一致 | 列表直接产出币安符号，请求原样透传，不做二次映射 |

## 5. 验证

- `npx tsc --noEmit`
- `npx vitest run`
- 网格断言：同一时间戳下 `floorTimestamp` 与 `boundaryAnchor` 对 `1D`/`1W`/`1M` 给出相同边界；`1W` 落在周一 00:00 UTC
- 手工：回溯复盘选 QNT，K 线价格应约 263.5（币安），不再是 46.5；1D 每根日期与币安一致
