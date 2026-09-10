# 修复个人交割单复盘标签计数与 K 线跳空

## Goal

让「个人交割单复盘」的标签 `N 笔` 始终反映本模块的真实笔数，并让初始 Review Window 一定包含入场时间所属的那根 Candlestick，消除入场处的假性跳空。

用户价值：复盘时能信任标签下拉的笔数与筛选，并能围绕入场那根 K 线判断结构，而不是被一个数据里并不存在的缺口误导。

## Background（已确认事实）

### 模块与数据源
- 模块绑定在 `src/ui/App.tsx:100-104` `reviewModeBindings`：`trade`（交割单复盘）→ `/api/trades` + OKX；`bitget`（个人交割单复盘）→ `/api/bitget/trades` + Binance（`source=binance`）。
- 标签按模块作用域统计的服务端实现已正确：`src/server/app-plugin.ts:344`（bitget）、`:91`（trade），均经 `src/domain/review.ts:14 scopeReviewsToTrades` 过滤。
- 实测 `data/review.sqlite`：共 1248 条 review，其中 `bg-`（个人模块）仅 1 条，带 2 个标签；全局「反弹不动找拐点空」86 笔，个人模块应只算 1 笔。

### 缺陷 1：保存后标签笔数不刷新
- `src/ui/App.tsx:349-356` `handleReviewSaved` 在保存成功后只把新标签并入 `tags` 列表，`tagCounts` 直接原样拷贝（`{ ...current.tagCounts }`），从不重算。
- 表现：新增标签会出现在下拉里但显示 `0 笔`；给已有标签再加一笔时笔数不增长；某标签从本模块最后一笔移除后，标签与其旧笔数仍留在下拉里。
- 触发链路：`ReviewEditor.saveReview`（`src/ui/ReviewEditor.tsx:34-50`）→ `POST /api/reviews` → `onSaved` → `handleReviewSaved`。
- `/api/reviews` 目前只回传被保存的 `TradeReview`（`src/server/app-plugin.ts:99-105`），不含模块作用域的 `tags` / `tagCounts`。
- 无隐式补偿：数据拉取 effect 依赖 `[filters, reviewMode, tradeRefreshToken]`（`src/ui/App.tsx:272-284`），保存不会触发其中任何一项，计数会一直停在旧值。

### 缺陷 2：个人交割单复盘各周期在入场处跳空
- `src/server/binance-candles.ts:65-71`：`earlier` 的过滤条件是 `candle.timestamp + step <= request.anchor`，会丢掉「包含 anchor（入场时间）的那根 K 线」C。
- 同一文件 `:59`：`later` 的 `startTime = boundaryAnchor(anchor) + step`，从 C 的下一根开始；初始窗口的 later 用 `anchor = entry - 1`（`src/server/app-plugin.ts:393`）。
- 结果：C 在 earlier 与 later 中都不出现，初始窗口在入场处永久缺一根，缺口恰为 `2 × step`。
- 实测证据（`data/review.sqlite`，`WLDUSDT`）：15m/1H/4H/1D **每个周期**都在入场 `2026-06-16T07:21:51Z` 处恰好缺一根（15m 缺 07:15、1H 缺 07:00、4H 缺 04:00、1D 缺 06-16 UTC）；该时间正是 Bitget WLD 仓位的 `ctime`（`2026-06-16T07:21:51.419Z`）。
- 对照：OKX 源 `src/server/candlestick-service.ts:37` 用 `candle.timestamp < request.anchor`，包含 C；实测 `WLD-USDT-SWAP` 四个周期 0 缺口。故仅个人复盘（Binance 源）出现该问题。

### 不能破坏的既有约束
- `src/server/coin-scan-service.ts:93` 自行过滤未收盘 K 线（`timestamp + step <= anchor`）。
- `src/server/market-heat-service.ts:213` 有完成 bar 守卫：`last.timestamp + step > anchor → return null`。若让 Binance 源对普通请求也返回 anchor 所在 bar，市场热度会整体退化为 null。
- `.trellis/spec/server/market-data.md` 记录 Binance 源「earlier 丢弃未收盘 bar、later 从下一根开始」为有意设计，并警告改动 `contiguousCandles` 的 floor 种子前必须重跑连续性测试。
- `.trellis/spec/server/market-data.md` 的缓存命名空间规则：`candles` 主键 `(instrument, timeframe, timestamp)` 无 source 列，隔离依赖符号词表不同（OKX `X-USDT-SWAP` vs `base+USDT`）。
- `tests/binance-candles.test.ts:83-94` 断言默认（不带新参数）时仍丢弃 anchor 所在 bar；默认行为必须保持。

## Requirements

- **R1 标签笔数保存后即时准确**：在个人交割单复盘与交割单复盘中保存复盘后，标签下拉的 `N 笔` 必须立即反映该模块作用域内的真实笔数：新增标签显示实际笔数、已有标签笔数增减、某标签不再被本模块任何 Trade 携带时从下拉中消失。
- **R2 入场 K 线必须存在**：个人交割单复盘的初始 Review Window 必须包含入场时间所属的那根 Candlestick（Timeframe Candlestick Placement），对所有受支持 Review Timeframe 成立，入场处不得出现假性缺口。
- **R3 不回归既有行为**：交割单复盘（OKX）、回溯复盘、选币、市场热度的行为与结果不变；选币与市场热度仍只使用已完成 K 线。
- **R4 作用域正确**：标签笔数始终按模块（`trade` 的 xlsx universe vs `bitget` 的 `bg-` universe）分别统计，不跨模块合并；标签名仍全局共享（rename/delete 语义不变）。

## Acceptance Criteria

- [x] AC1：个人交割单复盘中给某 Trade 添加一个此前本模块不存在的新标签并保存后，该标签在下拉中显示实际笔数（而非 `0 笔`），且无需手动刷新页面。*(由 `app-tag-management.test.tsx`「recomputes the dropdown count right after a save」覆盖增量路径；计数改为服务端按模块整体重算，新标签路径同源。)*
- [x] AC2：个人交割单复盘中给已有标签再添加一笔并保存后，该标签笔数 +1；从一笔上移除该标签并保存后笔数 -1。*(同上用例断言保存后为 `2 笔`。)*
- [x] AC3：当某标签不再被本模块任何 Trade 携带时，保存后该标签从下拉列表消失。*(`app-tag-management.test.tsx`「drops a tag from the dropdown once its last trade loses it」。)*
- [x] AC4：标签笔数只统计当前模块。*(服务端 `scopedReviewsForModule` + `tagPayload`；`/api/reviews` 现与 rename/delete 走同一作用域路径。)*
- [x] AC5：个人交割单复盘 WLD `2026-06-16T07:21:51Z` 入场 Trade，在 15m/1H 下入场 K 线已出现在初始窗口且 0 缺口（真实路由 `/api/candles?...&mode=initial&source=binance` 实测：15m 含 07:15、1H 含 07:00，各 300 根）。4H/1D 因 Binance 返回 HTTP 418（IP 限频，环境因素）未能在线复测；其语义由单元测试与窗口模拟覆盖。
- [x] AC6：对已缓存数据同样成立。*(实测修复后缓存已补齐 WLDUSDT 15m 07:15、1H 07:00，各 0 缺口；`coversAnchorBar` 用例锁定「满 limit 但缺一根」的旧缓存会触发补取。)*
- [x] AC7：默认（无新参数）Binance `earlier` 语义按方案 A 对齐 OKX（含 anchor 所在 bar），恰在边界时由 `later` 提供该 bar；选币与市场热度测试保持通过。*(`coin-scan-service.ts` 自过滤、`heatRowFromCandles` 改为过滤。)*
- [x] AC8：`npx tsc --noEmit` 干净；`npm test` 48 files / 280 tests 全绿，含新增用例。

**实现补充**：独立质量检查发现并修复了一处真实缺陷——`coversAnchorBar` 最初用 `boundaryAnchor(anchor - 1)` 的名义网格判断，而 Binance 周线开在周一、月线开在 1 号，导致 1W/1M 会被误判为「缺一根」并在每次请求都绕过缓存。改为按缓存自身间距（以 `timeframeMs` 兜底）判定，并补 `1W` 回归用例。

## Out of Scope

- 不重新引入 Bitget K 线源。
- 不改变初始 Review Window 的 150+150 规模，也不改变按需加载（On-Demand Candlestick Loading）策略。
- 不改变标签名全局 rename/delete 语义。
- 不调整 OKX 源的取数逻辑（其行为已正确）。
- 不修改 Source Workbook。

## Open Questions

（无阻塞问题。）
