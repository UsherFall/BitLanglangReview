# Bitget K线 later 路径写入未收盘 bar（个人交割单复盘）

## Goal

个人交割单复盘（`reviewMode=bitget`，K线源 `bitget`）加载图表时，`later` 方向的取数把交易所仍在形成的 bar（未收盘）写进了共享 `CandlestickStore`（持久 SQLite），违反全产品已文档化的 closed-bar 不变量。修复后：复盘图表与 OKX / Binance 源行为一致——只展示/缓存已收盘 bar，且已污染的缓存行被清理。

## Background / 确认事实（代码与数据证据）

- 用户报告：个人交割单复盘直接把最新 K 线拉下来，最新那根未收盘时，后面可能错位。**报告属实，已定位根因并实锤数据污染。**
- 三源对比（closed-bar 不变量，spec `server/market-data.md`）：
  - OKX `candlestick-service.ts:47`：`row[8] !== '0'`（confirm 标志），**方向无关**，写入前过滤。
  - Binance `binance-candles.ts:74`：`closeTime < Date.now()`，**方向无关**，写入前过滤。
  - Bitget `bitget-candles.ts`：`isClosedBar` 只加在 `earlier` 路径（`getCandlesticks` earlier 分支、`requestEarlierPage`）。**`later` 全部路径缺过滤**：
    - `requestLaterPage`（`fetchLaterPaged` 与 `requestHistoryLaterPage` 共用出口）过滤仅 `candle.timestamp > request.anchor`；
    - `getCandlesticks` 单请求 `later` 分支同样只按 `timestamp > anchor`。
- 触发面（为什么个人交割单复盘必然撞上）：`getCandlesForMode('initial')` 的 later 半窗 = entry-1 之后 150 根（`review-candle-source.ts:178`）。1D 下 150 根 ≈ 150 天 → **任何近 ~5 个月内的仓位复盘都会把当前正在走的日线拉回来**。5m 等小周期只有近 12.5 小时内的交易会触发。
- 污染机制与“错位”链条：
  1. 未收盘 bar 带着半程 OHLC 写入 `review.sqlite`（`bitget:` 前缀命名空间，主键 upsert）。
  2. 冻结：此后以该 bar 时间戳为锚的 `later` 翻页因 `timestamp > anchor` 不含它自身，永不回写终值；`later` 的缓存命中门（`isCacheFresh` 对 later 恒真、`coversAnchorBar` 对 later 恒真）+ `earlier` 历史锚点"恒新鲜"，使其无需网络即可被反复 serving。
  3. 次日复盘同一笔交易 → `later` 缓存命中（150 根已含该行）→ 昨天的半根 bar 当作已收盘 bar 展示；向前翻页加载新 bar 后，该错误 bar 卡在序列中间 → 图表与真实历史对不上（用户所说的“错位”），标注/阅读基于错误 OHLC。
- **实锤（本机 `data/review.sqlite`，2026-10-22 查询）**：1D 有 **7 个合约**的最新缓存行落在当前未收盘日线内（`newest > now - 24h`），另有 361 个 near-now（≤3 根 bar 内）行无法排除为更早冻结的半根 bar；5m/15m/1H/4H 当前无 in-flight 行（触发窗口窄，符合预期）。
- 其他源/模式不受影响：交割单复盘走 OKX（有 confirm 过滤）；回溯复盘走 `fetchBinanceOnlyCandles`（有 closeTime 过滤）；选品扫描只用 `earlier`。
- 测试缺口：`tests/bitget-candles.test.ts:111`、`:346` 的"丢弃未收盘 bar"用例**只覆盖 earlier**；later 无对应用例。
- 模块自身文档 `bitget-candles.ts:22-24` 声称"a bar is admitted only once it has CLOSED"——later 路径违反了它自己写下的契约，属 10/21 `fetchLaterPaged` 引入时的遗漏。

## Requirements

1. **Bitget `later` 补 closed-bar 过滤**（写入前）：
   - `requestLaterPage`：过滤改为 `timestamp > anchor && isClosedBar(timestamp, timeframe)`（同时覆盖 `/candles`、`/history-candles` 两个端点、单请求与翻页两条路）。
   - `getCandlesticks` 单请求 `later` 分支同步补上（当前虽无 bitget 调用方走这条路，但不变量必须方向无关）。
2. **一次性清理已污染缓存**：启动时清除 `bitget:` 命名空间全部行，用 marker 守卫保证只执行一次（重复启动不再删）。不清 OKX/Binance 命名空间（其不变量自 09/20 起在位，历史污染已在 09/20 处理过，`review.bak-20260920` 为证）。
3. **测试**：
   - later 单请求与 paged 两条路各补"丢弃未收盘 bar、不落库"用例（镜像现有 earlier 用例）。
   - 翻页走查在"只剩未收盘 bar"时正确终止（added=0 → history 兜底 0 → break），不返回也不保存半根 bar。
   - 一次性清理：删 `bitget:` 行、只删一次、不动其他命名空间。
4. **Spec 更新**：`server/market-data.md` Bitget 节补记：closed-bar 判断方向无关（later 同样丢弃未收盘 bar，对齐 OKX/Binance）；以及 1D 复盘必拉当前日线的触发面说明。

## Acceptance Criteria

- 复盘一笔近期（1D 下近 5 个月内）的 Bitget 仓位：initial 与 loadMore('later') 返回的最后一根 bar 一定是已收盘 bar；图表最右侧是最后一根已收盘 K 线 + 右侧空白 padding（与交割单复盘/OKX 行为一致）。
- 未收盘 bar 永不出现在 `/api/candles?source=bitget` 响应中，也永不落库（`review.sqlite` 无 `bitget:` 行的 timestamp 落在当前未收盘 bar 区间）。
- 清理执行后：`bitget:` 命名空间为空，首次复盘按需回拉全量（正常翻页路径），第二次启动不再触发删除；OKX/Binance 命名空间行数不变。
- `npm test`（含新增用例）全绿。
- 已知接受的残留（与 Binance/OKX 一致，spec 10/22 已记录）：交易动作落在当前未收盘 bar 内时，其标注在该 bar 收盘前无处可挂（snapToLoadedCandle 返回 null 被丢弃）。

## Out of Scope

- 不改 UI 侧加载/渲染逻辑（`chartDataWithWhitespace` 的右侧 padding 已天然处理"最右侧无更多已收盘 bar"）。
- 不做"实时更新当前 bar"——复盘图表本就只显示已收盘 bar，三源一致。
- 不清理 OKX/Binance 命名空间（无新污染路径，历史污染已处理）。
- 不改 `isCacheFresh` / `coversAnchorBar` 门逻辑（写入侧不变量补齐后，读侧"历史恒新鲜"快捷路径即恢复成立——这正是 OKX 模块注释里写明的前提）。

## Key Decisions

- 过滤位置在**写入 store 之前**（对齐 Binance/OKX 的"drops BEFORE it can reach the cache"），而非读侧丢弃——否则污染行仍会冻结在库里。
- 清理采用 **marker 守卫的一次性全量删除 `bitget:` 命名空间**，而非按时间窗删除：半根 1M bar 的 timestamp 可回溯至多 31 天，时间窗要么漏掉要么误伤面过大；全量删的代价只是下次复盘多几次翻页请求（缓存本就只有 ~1 天数据）。
- 不在 `fetchLaterPaged` 走查里对"未收盘 bar 计数"做特殊处理：`requestLaterPage` 返回的是过滤后条数，只剩未收盘 bar 时自然走 added=0 → history 兜底 → break 的既有终止路径。

## Risks / Notes

- 行为变化：近期交易的复盘图不再显示当前正在走的 bar（用户已观察到并报告为问题；Binance/OKX 在同产品中即此行为，spec 已记录接受）。
- 清理后首次复盘回拉成本：每个 instrument+timeframe 冷缓存多 2~3 次请求（90 bar/页 ×2 + 兜底），Bitget 限频 20 req/s + pacer 在位，可忽略。

## 实施结果（10/22）

- 全部落地：`requestLaterPage`（所有 later 网络取数的共同出口）与单请求 later 分支均补 `isClosedBar`；`CandlestickStore` 新增 `deleteByInstrumentPrefix`/`getMeta`/`setMeta`（`candle_meta` 表）；`app-plugin.ts` 接线 `purgeBitgetCandleCacheOnce`（marker 守卫，每库一次）。
- 清理已在真库执行（dev server 热重启触发 `configureServer`）：`bitget:` 行全清，marker `bitget-forming-bar-purge-10-22=done` 已设，多次重启未重复删；非 bitget 命名空间 659,485 行完好。
- 新增 4 个用例：单请求 later 丢未收盘 bar 不落库；分页 later 走到当前时刻同上且终止于既有路径（3 次请求）；清理只删 `bitget:` 不动同词表的无前缀 Binance 行与 OKX 行；marker 使第二次不删新行。
- `tsc --noEmit` 通过；全量 `vitest run` 71 文件 / 593 测试全绿。
- 顺手修正：`market-data.ts` 的 `allowPaging` 文档注释（原文写"仅 earlier"，与 10/21 起双方向分页的实现矛盾）；`requestLaterPage` 里本就死变量的 `step` 移除。
