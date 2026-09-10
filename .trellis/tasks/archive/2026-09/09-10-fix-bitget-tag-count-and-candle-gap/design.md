# Design

## 1. 边界与影响面

| 层 | 文件 | 改动 |
| --- | --- | --- |
| 前端 | `src/ui/App.tsx` | `handleReviewSaved` 消费新的保存响应；`toggleStarred` 带 `module`；给 `ReviewEditor` 传 `module` |
| 前端 | `src/ui/ReviewEditor.tsx` | 新增 `module` prop；`saveReview` 发送 `module`、解析 `{ review, tags, tagCounts }` |
| 服务端 | `src/server/app-plugin.ts` | `POST /api/reviews` 接受 `module`，复用 `scopedReviewsForModule` + `tagPayload` 回传作用域计数 |
| 服务端 | `src/server/binance-candles.ts` | `earlier` 过滤对齐 OKX（`timestamp < anchor`）；新增缓存完整性判定 |
| 服务端 | `src/server/market-heat-service.ts` | 完成 bar 守卫由「判 null」改为「过滤」 |
| 不动 | `src/server/candlestick-service.ts`（OKX） | 已是 `timestamp < anchor`，本任务以此为基准 |
| 不动 | `coin-scan-service.ts` | 已自行过滤未完成 bar（`:93`） |
| 不动 | `src/server/app-plugin.ts` 的 `getCandlesForMode` | 图表取数无需改动 |
| 不动 | `src/server/market-data.ts` | 不新增契约字段 |

## 2. 缺陷 1：标签笔数

### 契约变更
`POST /api/reviews` 请求体新增可选 `module: 'trade' | 'bitget'`，响应由裸 `TradeReview` 改为：

```ts
{ review: TradeReview; tags: string[]; tagCounts: Record<string, number> }
```

- `tags` / `tagCounts` 用现有 `scopedReviewsForModule(parsed.module)` + `tagPayload(...)` 生成（`app-plugin.ts:72-84,426-431`），与 `/api/tags/rename`、`/api/tags/delete` 同一套作用域逻辑。
- `module` 缺省时 `scopedReviewsForModule(undefined)` 返回全量（legacy 全局）；UI 总是显式传值。
- 服务端按模块作用域**整体重算**，天然覆盖「新增标签」「笔数增减」「标签归零后消失」三种情况，前端无需复制计数逻辑。

### 前端
- `ReviewEditor` 新增 `module` prop，`saveReview` 把 `module` 一起 POST；解析 `{ review, tags, tagCounts }`，用 `review.tags` 重置草稿，并把整个 payload 交给 `onSaved`。
- `App.handleReviewSaved(payload)`：`tags = payload.tags`、`tagCounts = payload.tagCounts`、把匹配 trade 的 `review` 替换为 `payload.review`（保持既有就地 patch，不触发整队列重取）。
- `App.toggleStarred`：POST 时带 `module`，用返回 payload 走同一个 `handleReviewSaved`。

### 为什么不用另外两种方案
- 前端按 `data.trades` 重算：`data.trades` 是**过滤后**队列，而服务端计数覆盖模块内**全部** Trade，过滤器生效时必然算错。
- 保存后 bump `tradeRefreshToken` 重取：正确但每次保存整队列重取；xlsx 模块队列可达上千条，代价过高。

### 兼容 / 回滚
响应体是超集替换，无持久化影响；回滚只需还原该 commit。

## 3. 缺陷 2：入场 K 线缺失（方案 A：对齐 OKX 语义）

### 根因
两个 `CandleSource` 对 `earlier` 的定义不一致：

| | earlier | later | anchor 所在 bar C |
| --- | --- | --- | --- |
| OKX `candlestick-service.ts:37` | `timestamp < anchor` | `timestamp > anchor` | 非边界入场落在 earlier；恰边界入场落在 later |
| Binance `binance-candles.ts:68` | `timestamp + step <= anchor`（只要已完成 bar） | `boundaryAnchor(anchor) + step`（`:59`） | earlier 排除、later 跳过 → **留下正好一根的洞** |

实测（WLDUSDT 缓存 + 入场 `2026-06-16T07:21:51.419Z`）：

```
非边界入场 07:21, C=07:15
  Binance  earlier 最新=07:00  later 起点=07:30  → C 缺失（跳空）
  OKX 语义 earlier 最新=07:15  later 起点=07:30  → C 存在
恰好边界入场 07:15:00.000
  Binance  earlier 最新=07:00  later 起点=07:15  → C 存在
```

第二组解释了为什么只有「入场不在 bar 边界」的 Trade 才跳空，也解释了 15m/1H/4H/1D 每个周期都缺同一根。

### 改动 1：`src/server/binance-candles.ts` 的 earlier 过滤

```ts
.filter((candle) => {
  if (request.direction === 'earlier') {
    return candle.timestamp < request.anchor;   // was: candle.timestamp + step <= request.anchor
  }
  return candle.timestamp > request.anchor;
});
```

- `endTime = anchor - 1` **不变**：非边界时 Binance 会返回 C（`C.open <= anchor-1`）且被新过滤保留；恰边界时 C 由 later 提供（later 起点 = `boundaryAnchor(anchor)+step` = C），与 OKX 的边界行为一致。
- `contiguousCandles` 的 floor 种子**不改**：非边界下最新 bar = 种子（差值 0），恰边界下差值为 `step`，均在 `maxGap = 1.5 × step` 内。
- 选币无需改：`coin-scan-service.ts:93` 自己 `filter(timestamp + step <= anchor)`。

### 改动 2：缓存完整性判定（AC6 的关键）

旧缓存（如 WLDUSDT）里已有 150 根、但停在 C-1；`listBefore` 返回满 150 根，`cached.length >= limit` 与 `isCacheFresh`（历史 anchor 恒 fresh）都会成立 → 直接短路，C 永远补不回来。因此在缓存命中条件上补一个判定：

```ts
function coversAnchorBar(request: CandleRequest, cached: Candlestick[]): boolean {
  if (request.direction !== 'earlier') return true;
  const newest = cached[cached.length - 1]?.timestamp;
  return newest !== undefined && newest >= boundaryAnchor(request.anchor - 1, request.timeframe);
}
```

`boundaryAnchor(anchor - 1)` 正是「anchor 之前最近的一根 bar」：非边界 = C，恰边界 = C-step。命中条件变为 `cached.length >= limit && isCacheFresh(...) && coversAnchorBar(...)`，于是缺 C 的旧缓存会触发一次补取并把 C 落盘。

对各调用方的行为：图表初始 earlier 会补取 C；`mode=earlier` 滚动加载的 anchor 是最老一根，`listBefore` 天然到 `anchor-step`，判定成立（无额外请求）；选币当前扫描走 `refresh: true` 不受影响；市场热度补取一次后命中。

### 改动 3：`src/server/market-heat-service.ts` 完成 bar 守卫

C 进入共享缓存后，热度若在相同 `(instrument, 15m, anchor)` 上取到 C 作为最新 bar，原守卫 `last.timestamp + step > anchor → return null` 会把该标的误判为无数据。改为**过滤**：

```ts
const completed = candles.filter((candle) => candle.timestamp + step <= anchor);
if (completed.length === 0) return null;
const last = completed[completed.length - 1];
// 后续 refIndex 循环、quote 求和全部基于 completed
```

行为保持：当前喂进来的 bar 本就全部完成（`completed === candles`），输出不变；仅把「遇到未完成 bar 就整体判无数据」放宽为「跳过它继续算」。

### 为什么选方案 A 而不是加 `includeAnchorBar` 开关
- 方案 A 直击根因（两源语义不一致），核心改动一行，且让 Binance 与 OKX 行为统一，图表与 `/api/candles` 无需改动。
- 加开关只是把不一致用参数掩盖，还要新增契约字段与缓存谓词，改动面反而更大。
- 代价（heat 守卫改为过滤、更新一处 spec）都是行为保持的改动。

### 风险与缓解
- **热度退化**：已由改动 3 消除；补一条「输入含 anchor 所在 bar 时仍能算出读数」的测试锁定。
- **旧缓存反复补取**：若某标的在 C 这根确实无数据（Binance 通常会给零成交量 bar），判定会持续不成立。可接受（罕见，且不影响正确性）。
- **1W/1M 边界**：`boundaryAnchor` 对 1W/1M 非自然边界属既有行为，只影响种子与 later 起点；`earlier` 的取数与判定均基于 `timestamp < anchor`，5m–1M 一致成立。

### 兼容 / 回滚
- 无 schema / 缓存主键变更；C 是普通 OHLCV 行。
- 回滚只需还原 commit；缓存中多出的 C 行对旧逻辑无害。

## 4. 验证策略

- `tests/binance-candles.test.ts`：新增「非边界 anchor 时返回 C」用例；新增「缓存满 `limit` 但缺 C 时触发补取」用例；既有恰边界用例保持通过。
- `tests/market-heat-service.test.ts`：新增「candle 列表含 anchor 所在 bar 时仍产出读数（不判 null）」用例。
- `tests/review-editor.test.tsx` / `tests/app-tag-management.test.tsx` / `tests/app-bitget-mode.test.tsx` / `tests/app-review-progress.test.tsx`：更新 `/api/reviews` mock 为新响应结构。
- `tests/app-tag-management.test.tsx`：新增「保存后下拉笔数即时更新 / 归零标签消失」用例。
- 人工端到端：`npm run dev` 后对 WLD 的 bitget Trade 调 `GET /api/candles?...&mode=initial&source=binance`，确认返回中包含入场所在 bar。
