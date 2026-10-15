# Design — 标注窗口扩到 1 年（含 Bitget 往前翻页能力）

## 1. 边界与定位

- **翻页能力落在 `src/server/bitget-candles.ts`**（线上模块），因为它是一份取数能力，`structure-fullness` 之后要复用；**不是**只在工具里造一份。
- **线上行为在本任务内必须零变化**：见 §2 的 opt-in 设计。
- 工具侧只做两件事：用新能力抓 1 年、把数据变瘦以便落盘与渲染。

## 2. `CandleRequest` 的扩展：为什么必须 opt-in

现状（`bitget-candles.ts:69-114`）：一次请求 → 过滤 → 存 → 返回 `listCached`。缓存命中判据是 `cached.length >= request.limit`。

**关键事实**：线上扫描对 1D 请求的是 `scanWindowFor()` = **100 根**，而 Bitget 1D 端点**每次最多回 90 根** —— 也就是说线上**今天就在"要 100 拿 90"**。

若把翻页做成 `limit` 的自动行为，线上会立刻拿到第 100 根 → `coarseStructure` 的 `posRange` 分母变 → **候选集变**。所以：

```ts
// market-data.ts
type CandleRequest = {
  …
  /**
   * Opt-in: keep requesting older pages until `limit` bars are available (or the
   * exchange runs out). Absent/false keeps the single-request behaviour every
   * existing caller relies on. Production does NOT set this today — the 1D
   * request already asks 100 but the endpoint caps at 90, so turning paging on
   * would silently add a bar and move `posRange`.
   */
  allowPaging?: boolean;
};
```

工具（`sample.ts`）传 `allowPaging: true` + `limit: 365`；线上不传 → 字节级不变。

## 3. 翻页算法

```
fetchPaged(request):
  1) 最新一页：走 /candles（= 今天线上那条路径），endTime = anchor - 1
     —— 刻意不用 history-candles：这一页必须与线上抓到的 90 根**逐字节相同**
  2) 循环往前：
       have  = listCached(request)                 // 从 anchor 往前的连续段
       if have.length >= limit: break
       oldest = have[0].timestamp
       page  = 请求 /history-candles, endTime = oldest - 1, limit = min(90, limit)
       if page 为空: break                          // 次新币 / 历史到底
       save(page)                                   // 主键 upsert，重叠无害
       guard++
  return listCached(request)
```

- **页码端点分工**：最新页 `/candles`（与线上一致、已验证），更早的页 `/history-candles`（`/candles` 只回溯 ≈3 年，history ≈7 年）。
- **每页上限 90 根**（Bitget 1D 的硬顶，实测 `limit=200` 也只回 90），所以 1 年 ≈ **5 页**。
- **游标用 `oldest - 1`**：与代码既有的 `anchor - 1` 同款，保证严格前进，不会因端点边界语义（`<` 还是 `<=`）而原地打转。
- **护栏**：`MAX_PAGES = ceil(limit / 90) + 2`，防端点异常导致死循环。

## 4. 缓存与刷新策略（本任务的价值所在）

- **稳态 1 请求**：`allowPaging` 且 `refresh: true` 时，只重新拉**最新一页**；`have.length >= limit` 一成立就退出循环 → 整轮扫描每标的只发 1 个请求，与今天持平。
- **冷启动才贵**：缓存空时才会走满 5 页。
- **历史页永不失效**：旧 bar 不会变，`CandlestickStore` 的 `(instrument, timeframe, timestamp)` 主键 + upsert 让它天然幂等。
- **命中判据沿用现有三道门**：`cached.length >= limit`、`isCacheFresh`、`coversAnchorBar`。第 1 页之后就交给 `listCached` 的连续段（`contiguousCandles` 遇缺口即止），**不做新的空洞检测**。

## 5. 工具侧改动

### 5.1 快照瘦身

现在 90 根 × 353 只就 7.4MB（≈238 B/bar，大头是每根重复的 `instrument`/`timeframe`/`volume` 与 JSON 键名）。1 年会长到 ≈27MB。改为紧凑数组：

```ts
type SlimBar = [timestamp: number, open: number, high: number, low: number, close: number];
```

`sample.ts` 落盘用 SlimBar，调用判定器时再 rehydrate 成 `Candlestick`（`volume: 0`，判定器不用它）。预计 1 年 ≈ 4.6MB。

### 5.2 页面数据

`build-page.ts` 内联的数据同样用数组（现在每根是一个对象，≈83 B/bar → 数组后 ≈35 B/bar）。1 年 × 231 只 ≈ 3MB，页面总量落在 AC5 的 8MB 以内。**内联 JS 里把数组映射成 `{time, open, high, low, close}` 给 lightweight-charts。**

### 5.3 不变的部分

- 池阶段仍抓 90 根、判定仍喂最新 90 根（R2.2）。
- 标注交互、localStorage 断点、导出 CSV 字段与行数**一律不动**。

## 6. 契约

```ts
// market-data.ts（新增一个可选字段，其余不变）
CandleRequest { instrument; timeframe; anchor; direction; limit; refresh?; allowPaging? }
```

```ts
// tools/labeling/shared.ts
type SlimBar = [number, number, number, number, number];   // t, o, h, l, c
Snapshot {
  anchor; source; timeframe; fetchedAt;
  candles: Record<string, SlimBar[]>;      // 判定用：最新 90 根（全池）
  history: Record<string, SlimBar[]>;      // 显示用：1 年（仅候选）
  volume: Record<string, { quoteVolume24h; volumeRank }>;
}
```

## 7. 风险

| 风险 | 处置 |
| --- | --- |
| `/history-candles` 在 `endTime≈now` 的行为未实测 | 只用于第 2 页及更早，最新页固定走 `/candles`；实现时补一条探针确认 |
| 连续 5 页请求把限频压满 | 沿用 20 req/s 全局 pacer；冷启动 353 只 ÷（5 页）≈ 1 分 30 秒；工具只对候选翻页 |
| 缓存里混入**更早**抓过的历史，`listCached` 一次拿超过 `limit` | `listBefore` 的 `limit` 已经截断到 `limit`，无影响 |
| 新旧快照格式不兼容 | 快照是 gitignored 的一次性产物；格式变更直接删 `out/` 重跑，不做迁移 |

## 8. 回滚

- `src/` 侧：`allowPaging` 是新增可选字段，删掉字段与翻页分支即回到今天；`market-data.ts` 删一行。
- 工具侧：删 `tools/labeling/out/` 重跑即可；`tools/` 的改动可整目录丢弃。
