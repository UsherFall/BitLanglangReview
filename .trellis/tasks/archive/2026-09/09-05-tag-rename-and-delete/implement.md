# 执行计划：标签重命名与删除（全局生效）

前置：读 `.trellis/spec/domain/index.md`、`.trellis/spec/server/index.md`、`.trellis/spec/server/persistence-and-imports.md`、`.trellis/spec/frontend/index.md` 的 Pre-Development Checklist 与 Quality Check。

## 步骤

### 1. server：存储层（`src/server/review-store.ts`）

- [ ] 新增私有 `mapTags(fn)`：包在 `this.db.transaction()` 里，遍历 `listReviews()`，对每条算 `uniqueCleanTags(fn(tags))`，与旧值顺序无关比较，变化则复用 `saveReview` 写回并计数。
- [ ] `renameTag(from, to)`：`from`/`to` 先 `trim()`；`to` 为空 → 抛错（API 层转 400）；`fn = tags => tags.map(t => t === from ? to : t)`（去重由 `uniqueCleanTags` 负责 → 天然实现「合并到已有标签」）。
- [ ] `deleteTag(tag)`：`fn = tags => tags.filter(t => t !== tag)`。
- [ ] `listTagCounts()`：`listReviews().flatMap(r => r.tags)` 计数 → `Record<string, number>`。
- [ ] 注释写明：写回会刷新 `updated_at`，这是有意的。

### 2. server：API（`src/server/app-plugin.ts`）

- [ ] `/api/trades`：`listReviews()` 只调一次存局部变量，`tags` 与新增 `tagCounts` 都从它算。
- [ ] 新增 `/api/tags/rename`（POST）：校验 `from`/`to` 非空 → 400；否则返回 `{ affected: renameTag(...), tags, tagCounts }`。
- [ ] 新增 `/api/tags/delete`（POST）：校验 `tag` 非空 → 400；否则返回 `{ affected: deleteTag(...), tags, tagCounts }`。
- [ ] 两者非 POST → 405，与 `/api/reviews` 一致；复用现有 `readBody` / `send`。

### 3. ui：App 状态（`src/ui/App.tsx`）

- [ ] `TradeResponse`（`App.tsx:53` 附近）加 `tagCounts: Record<string, number>`。
- [ ] 新增 `tagVersion` state 与 `handleTagsChanged(from, to: string | null, result)`：
  - `data.tags` / `data.tagCounts` 整体替换；
  - `data.trades` 里每条 `review.tags` 按名字替换（`to === null` 则过滤掉）；
  - `filters.tag === from` → 改名时置为 `to`，删除时置为 `undefined`；
  - bump `tagVersion`。
- [ ] `ReviewEditor` 渲染处加 `key={`${selectedTrade.id}:${tagVersion}`}`。
- [ ] 把 `handleTagsChanged` 作为 prop 传给 `ReviewEditor`。

### 4. ui：下拉交互（`src/ui/ReviewEditor.tsx`）

- [ ] `TagsCombobox` 接收 `tagCounts` 与 `onRenameTag` / `onDeleteTag`（返回 `{ affected, tags, tagCounts }`）。
- [ ] 选项列表改为列出**全部**标签（含已选中，标注「已添加」，点击 toggle 移除/添加）。
- [ ] 每行右侧：`N 笔` + 铅笔 + 垃圾桶（`aria-label` 标注）。
- [ ] 行内状态机：`idle` / `renaming`（input + ✓✗，Enter 保存、Esc 取消，空输入禁用保存）/ `confirming`（删除确认，显示影响笔数）/ `error`（行内提示 + 重试）；请求中禁用该行。
- [ ] 成功后调用 `onRenameTag(from, to)` / `onDeleteTag(tag)` 把服务端返回值交给 `App` 打补丁。
- [ ] chip 行为保持不变（点击 = 从当前这笔移除）。

### 5. 术语（`CONTEXT.md`）

- [ ] **Review Tag** 条目补：标签名全局共享，改名/删除影响所有带该标签的 Trade。
- [ ] 新增一条 Example Dialogue：在某一笔交易上把「箱体突破后找拐点」改名为「假突破」，其余 4 笔同步变化。

### 6. 测试

- [ ] `tests/review-store.test.ts`：
  - `renameTag`：跨多条复盘生效；只影响带该标签的记录；`affected` 正确；合并到已存在标签（同笔同时含新旧名 → 只剩新名）；`from` 不存在 → 0；`to` 为空 → 抛错且数据库不变；事务（中途抛错不留半成品）。
  - `deleteTag`：全局移除；其他标签不受影响；`affected` 正确；不存在 → 0。
  - `listTagCounts`：计数正确。
- [ ] API 测试（新 `tests/app-plugin-tags.test.ts` 或并入现有 app 测试）：两个端点成功响应（`affected` + `tags` + `tagCounts`）；缺参数/`to` 为空 → 400；GET → 405；`/api/trades` 返回 `tagCounts`。
- [ ] UI 测试（新 `tests/app-review-tags.test.tsx` 或扩展现有）：下拉每行显示笔数；行内改名 → 全局 `tags`、其他交易的 `review.tags`、筛选值同步；改名到已存在标签 → 合并；删除 → 全局移除 + 筛选清空；改名后草稿里的旧名变新名（保存不会写回旧名）；失败时行内报错且数据不变。

### 7. 验证

```bash
npx vitest run
npx tsc --noEmit
```

- [ ] 全绿后按 `.trellis/spec/*/index.md` 的 Quality Check 逐项自检。

## 回滚点

- 若行内状态机让 `TagsCombobox` 过于臃肿：把行拆成独立的 `TagOptionRow` 子组件（同文件内），不要新建文件、不要引入状态管理库。
- 若「下拉列出已选中标签」这个行为变化在验收时觉得别扭：退回「只列未选中」，并改为在已选中 chip 上提供长按/右键重命名——但这会让最常见的场景（改当前这笔正带着的标签）变难，优先保留现方案。
