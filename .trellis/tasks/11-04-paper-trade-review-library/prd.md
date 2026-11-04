# 回溯复盘模拟单复盘库

## Goal

回溯复盘（Free Replay）中做出的模拟单支持批注（标签 / 笔记 / 收藏），并提供一个跨会话聚合的「模拟单复盘库」，让回放练习沉淀为可复盘、可检索的素材，与真实单复盘体系形成闭环。

## Background（代码勘察结论）

- 真实单（交割单复盘 / 个人交割单复盘）已有完整批注体系：`trade_reviews` 表（`src/server/review-store.ts`）存 `tags_json` + `note` + `starred`，UI 为 `src/ui/ReviewEditor.tsx`；队列行有星标切换，过滤器有「收藏状态」（`src/ui/App.tsx:763-816`）。
- 标签名全局共享：改名/删除重写所有模块的 review（`review-store.ts` `renameTag`/`deleteTag`）；各模块通过 `scopedReviewsForModule(module)`（`src/server/app-plugin.ts:128`）得到自己的下拉列表与 `N 笔` 计数 —— 即「共名、分计数」。
- 模拟单（`PaperTrade`）目前只作为 JSON 存在 `free_replay_sessions.paper_trading_json`（`src/server/free-replay-session-store.ts`），会话主键 `(instrument, start_time)`；无任何批注能力。
- 模拟单 ID 会话内自增（`fill-N` / `position-N`，`src/ui/free-replay-paper-trading.ts` `nextId`），跨会话不唯一；`positionId` 随会话 JSON 持久化，恢复后稳定。
- 模拟交易在 UI 层纯前端运行（`src/ui/free-replay-paper-trading.ts`），服务端只持久化整个会话 JSON；会话删除走 `DELETE /api/free-replay/sessions`（`app-plugin.ts` ~L325）。
- 开始模拟交易后不能回退（`canRewind={!paperTrading.active}`），成交不可被回退撤销。

## Key Decisions（用户拍板 11-04）

1. **跨会话模拟单复盘库**：聚合所有回放会话的模拟单的独立复盘空间，非会话内批注。
2. **标签体系与真实单一致**：标签名全局共享（改名/删除跨模块联动），模拟单模块计数空间独立（「共名、分计数」）。
3. **批注粒度 = 整个回合（position round）**，不是每笔部分平仓（fill）。
4. **收藏与交割单复盘一致**：独立 `starred` 星标 + 收藏状态过滤。
5. **批注入口两处**：回放中点「单子」列表行可批注（边练边记）；复盘库列表同样可批注（事后整理）。两处编辑同一份数据。
6. **复盘库放在回溯复盘首页**（无活跃回放时的会话选择面板），与「历史会话」并列，不设顶部新导航。
7. **删会话级联删批注**（默认采纳，可否决）：回合行情数据随会话 blob 消亡，保留批注即成无源孤儿。
8. **库行点击跳回那次回放**（默认采纳，可否决）：恢复来源会话并焦点定位该回合；机制（`onRestore` + `focusPaperOrder`）现成，是砍范围时的第一候选。

## Requirements

- R1: 回合可批注：标签（多个）、笔记（一条）、收藏（星标），数据持久化于 SQLite。
- R2: 复盘库聚合所有会话的**已完结回合**（当前仍持仓的回合不进库），列表展示方向/开平仓价/盈亏/笔数，按平仓时间降序。
- R3: 回合有全局稳定 ID（`paper:{instrument}:{startTime}:{positionId}`），会话恢复后批注不丢失、不错位。
- R4: 标签改名/删除对模拟单批注全局生效；模拟单模块的标签下拉与 `N 笔` 计数只覆盖模拟单。
- R5: 回放中「单子」列表同一回合的多行共享批注状态；行内可切换星标、编辑标签/笔记。
- R6: 复盘库每行标出来源会话（币种 + 回放起点），支持按标签 / 收藏状态 / 来源会话筛选。
- R7: 库行点击恢复来源会话并焦点定位该回合末笔成交。
- R8: 删除回放会话时级联删除其回合批注（前缀精确到 `paper:{instrument}:{startTime}:`）。

## Acceptance Criteria

- [ ] 复盘库能看到多个回放会话的已完结回合，按平仓时间降序展示方向/开平仓价/盈亏/笔数/来源会话。
- [ ] 仍持仓的回合不出现在复盘库；全部平仓后出现。
- [ ] 回放中对任意回合行打标签/写笔记/切收藏，刷新或恢复会话后保留；同一回合多行状态一致。
- [ ] 库中对回合批注，与回放中看到的是同一份数据。
- [ ] 标签改名后，真实单与模拟单同名标签同步更新；模拟单标签计数不混入真实单，反之亦然。
- [ ] 可按标签、收藏状态、来源会话筛选复盘库。
- [ ] 点击库中回合行，恢复该来源会话并定位到该回合。
- [ ] 删除某回放会话后，其回合与批注从复盘库消失；其他会话（含同币种不同起点）批注不受影响。

## Out of Scope

- 模拟单之间、或模拟单与真实单之间的关联/合并视图。
- 真实单复盘现有行为的改动（标签共名机制保持不变）。
- 会话删除前的二次确认交互（维持现状）。

## Technical Notes

- 批注复用 `trade_reviews` 表（`paper:` 前缀 ID），不建新表、无 DDL；回合行情数据从会话 blob 实时派生，不落库。
- `PaperTrade` 等类型从 ui 下移到 `src/domain/paper-trading.ts`（仅类型，ui re-export 保持兼容）；回合分组/过滤为 `src/domain/paper-round.ts` 纯函数。
- 详见 `design.md`（数据流/取舍/风险）与 `implement.md`（执行清单/验证命令）。
