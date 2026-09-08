# Design：个人交割单复盘增强

三层约定不变（见 `.trellis/spec/{domain,server,frontend}/index.md`）。改动沿既有模块边界推进，trade 与 bitget 共享工作台继续复用，不新建共享服务。

## 1. R1 名义价值显示

### 数据（领域/导入层）
- `src/server/bitget-import.ts` `historyPositionToTrade`：`turnover` 由 `null` 改为 `entryPrice * size`（开仓名义价值，与 xlsx `交易额 (USD)` 同口径）。`margin/leverage/returnRate/maxPositionValue` 保持 null。
- 约束：不写 fake 值；`formatUsdtAmount(null)` 仍给 "—"。

### 渲染（UI）
- 现 `App.tsx:707`：
  `{formatLeverage(trade.leverage)} · 保证金 {formatUsdtAmount(trade.margin)} · 平仓 {…}`
- 抽小 helper（App.tsx 内，靠近现有 format 系函数）：
  ```
  function positionMoneyLabel(trade) {
    return trade.margin !== null
      ? `${formatLeverage(trade.leverage)} · 保证金 ${formatUsdtAmount(trade.margin)}`  // xlsx 现状不变
      : `名义价值 ${formatUsdtAmount(trade.turnover)}`;                                  // bitget 行
  }
  ```
  行内替换为 `{positionMoneyLabel(trade)} · 平仓 …`。
- xlsx 行输出与现状逐字一致（`margin` 恒数字），bitget 行变成 `名义价值 64.46`，不再出现「杠杆 — · 保证金 —」。

### 测试
- `tests/bitget-import.test.ts`：turnover == entryPrice×size。
- `tests/app-bitget-mode.test.tsx`：行文案含「名义价值」，不含「保证金 —」。
- 回归 `tests/app-tag-management` / review-editor（行内容相关断言若有）。

## 2. R2 标签计数按模块隔离（名字仍全局）

### 服务端 scoping（app-plugin.ts）
- 两个队列路由现都执行 `reviews = reviewStore.listReviews()` → `tagPayload(reviewStore, reviews)`（全库）。
- 改为按**模块宇宙**过滤后再计数：
  - `/api/trades`：宇宙 = 内存全部 xlsx trades 的 id 集合；
  - `/api/bitget/trades`：宇宙 = 从 `bitget_positions` 映射成功的全部 Trade 的 id 集合。
  - `scopedReviews = reviews.filter(r => universeIds.has(r.tradeId))`；`tags/tagCounts` 取自 scopedReviews（模块宇宙，与当前筛选条件无关，语义稳定）。
- `buildReviewQueue` 的 attach 逻辑不动；`trades/instruments` 不变。路由仍返回 `{trades, instruments, tags, tagCounts[, configured]}`，字段语义从"全库"变成"本模块"。

### 改名/删除仍全局（review-store.ts 不改）
- `/api/tags/rename|delete` 保持全局改写 + 返回全局 tag/tagCounts（供其它可能消费者；前端不再依赖此返回做本模块覆盖）。

### UI mutateTag 改为"成功后整体 refetch"
- `App.tsx` `mutateTag`（约 :363-381）：成功路径不再用 `result.tags/tagCounts` 覆盖本地；保留过滤器迁移逻辑（`from→to` 或删时清空），随后调用 `requestTradeRefresh()`，让既有 fetch effect（:269-281，依赖 `[filters, reviewMode, tradeRefreshToken]`）重新拉当前模块 scoped 状态。选中 trade 仍在队列则保持选中（effect 内已有逻辑）。
- `handleReviewSaved`（:351-361）保持现状（tags union + trades patch）；计数精确值仍由每次接口拉取保证。

### 测试
- 把 scoping 提为纯函数（如 `scopedTagPayload(allReviews, universeIds)`，domain/review 或 app-plugin 导出），附纯函数单测。
- UI：`tests/app-tag-management.test.tsx` 断言计数文案在模块内口径（若该测试现依赖全局口径需同步调整）；`tests/app-bitget-mode.test.tsx` 同步。

## 3. R3 持久化路径锚定（防御）

### 根因
`path.resolve('data', …)` / `path.resolve('data/review.sqlite')` 相对 `process.cwd()`。dev 从别的目录启动会在别处 mkdir 新的空 `data/`，密钥与单子"消失"。

### 方案（新增 `src/server/data-root.ts`）
```ts
// 以本文件位置向上定位项目根（src/server -> .. ..），与 cwd 无关。
export function resolveDataPath(...segments: string[]): string {
  const here = path.dirname(fileURLToPath(import.meta.url));   // <root>/src/server
  const root = path.resolve(here, '..', '..');
  return path.join(root, 'data', ...segments);
}
```
- `app-plugin.ts`：`path.resolve('data')` → `resolveDataPath()`；store 的 `path.resolve('data/review.sqlite')` → `resolveDataPath('review.sqlite')`。
- `bitget-keys.ts`：`DEFAULT_KEYS_PATH` 改用 `resolveDataPath('bitget-keys.json')`（保持可注入参数签名以便测试）。
- 兼容：项目根目录启动时路径与现状完全一致，现有 `data/` 数据无缝沿用。
- 风险：仅调整服务端进程内默认路径；不改 API 契约。

### 测试
- 新增 `tests/data-root.test.ts`：临时改 cwd（`process.chdir` 到临时目录，finally 恢复）断言仍返回 `<项目根>/data/...`。

## 4. 兼容与回滚
- API payload 只改 `tags/tagCounts` 的统计口径（由消费方 refetch 取数）；`/api/trades` 返回结构不变。
- 每一 R 独立小提交；R3 若引发行径变化可 `git revert` 该提交。
- 全量验证：`npm test` + `npx tsc --noEmit`。

## 5. 数据流示意（R2 后）
```
GET /api/trades 或 /api/bitget/trades
  └─ 全部 reviews (全表)
      └─ filter by 模块宇宙 id 集合 → scopedReviews
          └─ tags / tagCounts（模块口径）   ← UI 下拉、计数唯一来源
改名/删除: POST /api/tags/rename|delete（全局改写 reviews）
  └─ 前端 requestTradeRefresh() → 重新走上面的 GET（模块口径刷新）
```
