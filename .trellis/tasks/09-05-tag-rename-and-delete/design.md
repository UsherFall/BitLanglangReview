# 技术设计：标签重命名与删除（全局生效）

## 改动范围

| 文件 | 层 | 改动 |
| --- | --- | --- |
| `src/server/review-store.ts` | server | 新增 `renameTag` / `deleteTag`（事务），新增 `listTagCounts()` |
| `src/server/app-plugin.ts` | server | `/api/trades` 加 `tagCounts`；新增 `/api/tags/rename`、`/api/tags/delete` |
| `src/ui/App.tsx` | ui | `TradeResponse` 加 `tagCounts`；新增 `handleTagsChanged` 打补丁；`ReviewEditor` 加 `key` 版本号 |
| `src/ui/ReviewEditor.tsx` | ui | `TagsCombobox` 支持行内重命名 / 删除（含笔数、确认、错误态） |
| `tests/review-store.test.ts` | tests | 存储层两个操作 + 事务 |
| `tests/app-plugin-tags.test.ts`（新） 或并入现有 app 测试 | tests | 两个 API 的响应与 400/405 |
| `tests/review-editor.test.tsx` 或 `tests/app-review-tags.test.tsx`（新） | tests | 下拉内联操作 + 全局同步 + 草稿同步 |
| `CONTEXT.md` | 术语 | Review Tag 补充说明 + 一条 Example Dialogue |

不新增独立组件文件：操作内联在现有 `TagsCombobox` 里，避免为一个小功能新建标签管理面板（用户已确认不要弹窗）。

## 存储层

```ts
// src/server/review-store.ts
renameTag(from: string, to: string): number   // 受影响复盘笔数
deleteTag(tag: string): number
listTagCounts(): Record<string, number>
```

实现（两个操作共用同一个「全量改写」helper）：

```ts
private mapTags(fn: (tags: string[]) => string[]): number {
  const apply = this.db.transaction(() => {
    let affected = 0;
    for (const review of this.listReviews()) {
      const next = uniqueCleanTags(fn(review.tags));
      if (sameTags(next, review.tags)) continue;
      this.saveReview({ tradeId: review.tradeId, tags: next, note: review.note, starred: review.starred });
      affected += 1;
    }
    return affected;
  });
  return apply();
}
```

- 用 `db.transaction()`（better-sqlite3 同步 API），中途抛错自动回滚，不留半成品。
- 复用 `saveReview` 而不是手写 UPDATE：写回逻辑（`uniqueCleanTags`、`updated_at`）保持唯一一处。**副作用**：`updated_at` 会被刷成当前时间。可接受（这些记录的标签确实变了），但要在注释里写明这是有意的。
- 数据量：本地几百笔复盘，全量读改写远快于一次 IO，不做增量优化。
- `sameTags` 做顺序无关比较，避免无变化时仍计数。

## API 契约

```ts
// GET /api/trades 响应（tags 保持 string[] 不变，仅新增字段）
{ trades, instruments, tags: string[], tagCounts: Record<string, number> }

// POST /api/tags/rename  body: { from: string, to: string }
// POST /api/tags/delete  body: { tag: string }
{ affected: number, tags: string[], tagCounts: Record<string, number> }
```

- 缺参数 / `to` 去空格后为空 → 400 `{ error }`；非 POST → 405。与现有 `/api/reviews` 风格一致。
- 返回操作后的**最新全局** `tags` / `tagCounts`，前端直接整体替换，不需要再拉 `/api/trades`，也避免重新加载图表数据。
- `affected` 用于 UI 提示与测试断言。

`tagCounts` 复用 `listReviews()`：现有 `/api/trades` 里 `reviewStore.listReviews()` 被调了两次（队列 + tags 聚合），借这次改动合并成一次调用存局部变量。

## 前端状态流转

`App.tsx` 新增：

```ts
function handleTagsChanged(result: { tags: string[]; tagCounts: Record<string, number> }) {
  setData((current) => ({
    ...current,
    tags: result.tags,
    tagCounts: result.tagCounts,
    trades: current.trades.map((trade) => (trade.review ? { ...trade, review: { ...trade.review, tags: trade.review.tags } } : trade)),
  }));
  setTagVersion((v) => v + 1);   // 强制 ReviewEditor 重建草稿
}
```

两个细节：

1. **`trade.review.tags` 不动**：改名/删除只影响「标签名空间」，具体每笔复盘上带哪些标签由服务端已改完的 `tags_json` 决定——但前端内存里的 `data` 是旧快照。所以补丁必须**按名字替换**：把每条 `review.tags` 里的 `from` 换成 `to`（删除则过滤掉）。为此 `handleTagsChanged` 需要知道 `from`/`to`，签名改为 `handleTagsChanged(from: string, to: string | null, result)`（`to === null` 表示删除）。
2. **草稿同步**：`ReviewEditor` 的 `useEffect` 只依赖 `[trade.id]`（`ReviewEditor.tsx:12-16`），外部标签变了草稿不会重建 → 一保存旧名字又写回去。解法：`App` 渲染 `<ReviewEditor key={`${selectedTrade.id}:${tagVersion}`} …>`，改名/删除后 bump 版本号强制整块重建。

`filters.tag` 同步：改名时若 `filters.tag === from` 则设为 `to`；删除时若相等则清空（`undefined`，回到全部）。不清空会导致队列突然空掉。

## 下拉交互（`TagsCombobox`）

**行为变化（需要确认）**：现在下拉只列出「未选中」的标签（`selectableTags`）。为了让**任何**标签都能改名/删除，改为列出全部标签：已选中的行显示「已添加」标记，点击 = 从草稿移除（toggle 语义），右侧仍然有铅笔/垃圾桶。

不做这个改动的话，已选中的标签（比如正在看的这笔就带「箱体突破后找拐点」）在下拉里根本不出现，也就无法改名——这恰恰是最常见的场景。

行内状态机（每行局部 state）：

```
idle ──点铅笔──> renaming(input + ✓/✗) ──保存──> 调 API ──成功──> onTagsChanged
  │                                          └──失败──> error(提示 + 重试)
  └──点垃圾桶──> confirming(影响 N 笔 + 确认/取消) ──确认──> 调 API ──…──
```

- 每行右侧显示 `N 笔`（来自 `tagCounts`），重命名时若目标名已存在，行内提示「将合并到已有标签」。
- 图标用 `aria-label` 标注（如 `重命名标签 X` / `删除标签 X`），保持现有无障碍写法。
- 请求中该行禁用；失败在行内显示错误文字，不弹 toast、不静默。
- 已选中的 chip 行为**不变**：点击仍是「从当前这笔移除」，不是全局删除（避免误删全局数据）。

## 错误处理

- 存储层抛错 → API 500 `{ error }`；前端行内提示。
- 网络失败 → 前端行内提示 + 保留编辑态，可重试。
- 不改全局错误边界，不引入 toast 机制。

## 不做的事

- 不引入 `tags` 表 / 关联表 / 数据迁移（本次不需要标签元数据）。
- 不做标签颜色、排序、分组、备注。
- 不做批量操作、不做撤销（重命名后可再改回来；删除不可撤销 —— 删除前有笔数确认）。
- 不改 `/api/reviews` 的契约。
- 不在筛选下拉（`<select>`）上提供改名/删除入口。

## 兼容性 / 回滚

- `tags` 保持 `string[]`，`tagCounts` 是新增可选字段，旧前端可编译。
- 回滚：删掉两个 API 与 `TagsCombobox` 里的图标入口即可，存储层两个方法是纯新增，无 schema 变更（**不涉及数据库迁移**）。
