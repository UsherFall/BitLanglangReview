# Implement — 回溯复盘模拟单复盘库

## 执行清单（按序）

1. **domain：类型下移 + paper-round 纯函数**
   - `src/domain/paper-trading.ts`：从 `src/ui/free-replay-paper-trading.ts` 移入 `PaperDirection/PaperOrderKind/PaperTradingSettings/PaperLeg/PaperPosition/PaperOrder/PaperTrade/PaperTradingSession` 类型；ui 文件改为 import + re-export（调用方零改动）。
   - `src/domain/paper-round.ts`：`PaperRound`、`paperRoundReviewId(instrument, startTime, positionId)`、`groupFillsIntoRounds(trades, openPositionId)`（排除未完结回合，按 closedAt 排序）、`filterPaperRounds(rows, { tag?, starred?, session? })`。
   - 测试：`tests/paper-round.test.ts`（分组/排除持仓中回合/ID 格式/过滤）。

2. **server：批注读写 + 库端点 + 级联**
   - `review-store.ts`：新增 `deleteReviewsByPrefix(prefix)`（`delete from trade_reviews where trade_id like ? || '%'`）。
   - `app-plugin.ts`：`scopedReviewsForModule` 增加 `'paper'` 分支（`trade_id` 以 `paper:` 开头）；新增 `GET /api/paper/rounds`（派生回合 + 合并批注 + 过滤 + tagPayload）；`DELETE /api/free-replay/sessions` 增加级联删除。
   - 测试：`tests/paper-rounds-api.test.tsx`（端到端：存批注→库列表→改名联动→删会话级联；前缀撞车用例）。

3. **ui：回放内批注**
   - App.tsx：当前会话 `paperReviews` state + 拉取/保存（POST `/api/reviews` module='paper'）。
   - `FreeReplayPaperTradingPanel` 单子行：星标切换 + 批注展开（复用 ReviewEditor 的 TagCombobox），同回合多行状态一致。
   - 测试：行渲染星标/标签、保存后状态同步。

4. **ui：复盘库（FreeReplayPanel「模拟单库」区）**
   - 可折叠区 + 筛选（标签/收藏/来源会话）+ 行渲染 + 行内批注编辑。
   - 行点击：恢复来源会话 + 焦点定位回合末笔 fill。
   - 测试：`tests/free-replay-panel.test.tsx` 扩展（列表/筛选/跳回回调）。

5. **全量验证 + spec 更新**
   - `npm run test`、`npm run typecheck`（如有 script）、lint。
   - CONTEXT.md 增补「模拟单复盘库 / Paper Round」术语；spec 对应层更新。

## 验证命令

- `npm run test`（vitest 全量）
- `npx tsc --noEmit`（类型）
- 手动冒烟：回放做单 → 行内收藏/标签 → 回首页进模拟单库 → 筛选/跳回 → 删会话确认级联。

## 风险点 / 回滚

- 类型下移涉及 ui 文件 import 调整：保持 re-export，编译错即漏改。
- `App.tsx` 改动集中在一个功能块；回滚 = `git revert` 单个提交，无 DDL、无数据迁移。
- 每步完成后跑该层测试再继续下一步。
