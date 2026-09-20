# Design — 缓存只存已收盘 K 线

## 不变量

> **Candlestick Cache 中的每一行都必须是已收盘 bar 的终值。**
> 推论：任何"锚点在历史"的读取都可以安全复用缓存，`isCacheFresh` 的"历史不变"假设重新成立。

这条不变量由写入侧保证（读取侧不需要额外校验——半成品行的 timestamp 是正常的过去时间，读取侧无法识别）。

## 改动边界

| 文件 | 改动 |
| --- | --- |
| `src/server/binance-candles.ts` | 写入前过滤未收盘行；`coversAnchorBar` 适配"锚点所在 bar 合法缺失" |
| `src/server/candlestick-service.ts` | 写入前过滤未完结行（`confirm`）；本文件没有 `coversAnchorBar`，无需适配 |
| `tests/binance-candles.test.ts` | 新增 AC1/AC3/AC5/AC6 用例 |
| `tests/candlestick-cache.test.ts` | 新增 AC2 用例 |
| `.trellis/spec/server/market-data.md` | 3.3 阶段补最终态不变量 |

不改 `src/server/market-data.ts`（契约形状不变）、不改 `src/server/candlestick-store.ts`（store 只负责存，不判断市场语义）。

## 已收盘判定

在**原始行**上过滤，早于 `toCandlestick` 映射：

```ts
// Binance：closeTime 是这根 bar 的最后一毫秒，`closeTime < now` 即已收盘。
// 这是唯一对 1W/1M 也正确的判据——名义步长对 1M 是 30 天，日历月却是 28~31 天。
const rows = (await this.fetchJson(url)) as BinanceKline[];
const closed = (Array.isArray(rows) ? rows : []).filter((row) => Number(row[6]) < Date.now());

// OKX：confirm 是 K 线完结标记（'0' 未完结 / '1' 已完结）。
// 只有明确标记为未完结时才丢弃；字段缺失或取值未知时按已收盘处理，
// 保持修复前行为——误挡会让该源彻底无数据，漏挡只是保留原缺陷。
const rows = (response.data ?? []).filter((row) => row[8] !== '0');
```

实测依据（2026-09-20 直接打接口）：

```
OKX  /api/v5/market/history-candles?instId=BTC-USDT-SWAP&bar=15m
     row len=9，最后一根（正在走）= [...,"0"]，已收盘 = [...,"1"]
Binance /fapi/v1/klines?symbol=BTCUSDT&interval=15m
     正在走的行 closeTime=1789906499999 > now → closed=false
```

注意不要退回"用锚点推收盘"的老写法：09/10 曾经用 `candle.timestamp + intervalMs <= anchor` 做过滤，那会连**锚点所在 bar** 一起丢掉（成交价落在 bar 中间时，复盘窗口丢掉成交那根）。本次用的是 wall clock + 交易所标记，与锚点无关，因此 09/10 的语义得以保留。

## 数据流

```
earlier, anchor = now
  ├─ 修前：Binance 返回 [..., T-1, T(未收盘)] → 全部入库 → 历史读取永久命中 T 的半成品
  └─ 修后：过滤掉 T → 入库 [..., T-1] → 历史读取命中的都是终值
```

`getCandlesticks` 的返回路径不变，仍是 `return this.listCached(request)`：未收盘行不入库，缓存读取自然就把它排除了，不需要在返回处做合并/裁剪。因此 `earlier` 窗口 = "锚点之前最近的 `limit` 根**已收盘** bar"。

## `coversAnchorBar` 适配（Binance，关键）

未收盘 bar 不入库后，live 场景下"锚点所在 bar"缺失是**正常**的，而现有实现要求缓存末端必须够到锚点：

```
修前：newest = 正在走的 T → anchor(=now) - newest = now - T < step  → 通过
修后：newest = 上一个已收盘 bar T-step → anchor - newest = step + (now-T) > step → 永远不通过 → 每次请求都回源
```

只把比较基准从 `anchor` 改成 `min(anchor, now - step)`（`now - step` 是此刻**可能存在的**最新已收盘 bar 的上界）：

```
target = Math.min(request.anchor, Date.now() - step)
return target - newest <= spacing     // spacing 仍取自缓存自身，下限 step
```

各场景推演（step = 一根，T = 当前正在走的 bar 的 openTime）：

| 场景 | newest | target | target-newest | 结果 |
| --- | --- | --- | --- | --- |
| live，now ∈ [T, T+step)，缓存有 T-step | T-step | now-step ∈ [T-step,T) | ∈ [0, step) | 通过（不再回源）✓ |
| live，now ∈ [T+step, T+2step)，缓存已是 T | T | now-step ∈ [T, T+step) | ∈ [0, step) | 通过 ✓ |
| live，now ∈ [T+step, T+2step)，缓存缺 T | T-step | now-step | ∈ [step, 2step) | 不通过 → 回源补 T ✓ |
| 历史锚点，锚点所在 bar 在缓存里 | anchor 所在 bar | anchor | < step | 通过 ✓ |
| 历史锚点，锚点所在 bar 缺失（原 `coversAnchorBar` 要修的那个洞） | anchor-2step | anchor | 2step | 不通过 → 回源填洞 ✓ |

保留 `<= spacing`（不能收紧成 `<`）：锚点正好落在 bar 边界时，`earlier` 的最新 bar 就是 `anchor - step`，差值为整一个 `step`，收紧后会导致边界锚点每次请求都回源。

`isCacheFresh` 的两步容差不需要改：live 场景下 `anchor - newest = step + (now-T) < 2*step` 天然成立。

**1W/1M 的坑要绕开**：`spacing` 继续取自缓存 run 自身（`max(step, newest - previous)`），**不要**改用 `boundaryAnchor(anchor)` 推算期望的最新 bar——Binance 周线周一开盘、月线 1 号开盘，按名义网格 floor 出来的参照会落在当前 bar 内部，导致每次都判定为"少一根"。这就是现有实现只把 `boundaryAnchor` 当 `step` 下限的原因，本次沿用。

## 权衡

- **图表右端会少一根"正在走"的 K 线**（用户已确认）。代价：live 锚点下最新已收盘 bar 的最长可见延迟约一根（bar 收盘后由场景 3 触发回源补上），比"画一根错的 bar"更可取。
- **OKX 的未知 `confirm` 走宽松分支**（R4）：留了一个"payload 形态变化后缺陷静默回归"的口子，换的是不会误挡成"整个源无数据"。可接受。
- **存量脏数据只能精确清理，不能通用迁移**：最细周期的半成品没有更细的参照物可交叉校验。已知库内只有 5 根（全库交叉校验结果），精确删行 + 代码堵住写入即可闭环。

## 兼容性

- 不变：`Candlestick` 形状、`CandleRequest` 形状、`CandlestickStore` 表结构、缓存键命名空间规则、`contiguousCandles` 截断规则、`later` 的边界锚点算法、OKX 日线的 -8h 偏移。
- 变：`earlier` 在"锚点落在未收盘 bar 内"时少返回一根；两个源在 `refresh`/`earlier`/`later` 任一路径下都不再落未收盘 bar。
- coin-scan / market-heat：它们的 `timestamp + step <= anchor` 过滤变成冗余（保留不动），取到的窗口反而从 `limit-1` 根变成 `limit` 根已收盘 bar。

## 回滚

改动集中在一个过滤谓词 + 一处边界比较，回滚即 revert 这两个 hunk。数据删除是不可逆的，但删掉的是可重新拉取的行情缓存，`data/review.sqlite` 建议先备份（`cp data/review.sqlite data/review.sqlite.bak-20260920`）。
