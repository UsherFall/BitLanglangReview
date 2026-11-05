# Free Replay Session 级联删除事务化

## Goal

让 Free Replay Session 与其 Paper Round Reviews 在同一 SQLite 事务中删除，消除第二步失败时会话已删、批注残留的原子性风险，同时保持 API 响应和前缀匹配行为。

## Background

- 父任务地图 #5；#4 Session 生命周期已提交归档，本任务只修改服务端持久化边界。
- 当前路由顺序调用两个 Store，二者使用不同 SQLite connections，没有跨连接事务。
- 现状和回滚实验见 `research/current-state.md`。

## Requirements

- **R1 — 单连接事务。** `FreeReplaySessionStore` 提供 cascade method，在同一个 `this.db.transaction` 中删除 session row 与指定 Paper Review prefix rows。
- **R2 — 复用前缀契约。** 提取并复用 ReviewStore 的 LIKE escaping SQL，禁止复制出第二份可能漂移的匹配逻辑；保留 `%`、`_`、`!` 和 trailing-colon 行为。
- **R3 — API 兼容。** DELETE route 仍返回 `{ ok: true, deletedReviews }`，成功计数来自已提交事务；现有 standalone `deleteSession` 和 `ReviewStore.deleteReviewsByPrefix` 保持可用。
- **R4 — 真实回滚验证。** 用 file-backed SQLite + BEFORE DELETE trigger 强制 review deletion 失败，证明 session deletion 回滚且批注不丢；成功路径证明两边同时删除且邻近数据保留。
- **R5 — 质量与规范。** focused tests、全量可运行测试、类型检查、diff check 通过；persistence spec 写清 transaction ownership、错误矩阵和测试要求。

## Acceptance Criteria

- [x] 路由只调用一个 cascade method 完成 Session + Paper Reviews 删除，不再顺序调用两个独立 Store 的删除。
- [x] cascade 使用同一个 SQLite connection/transaction，任一语句失败时两边都保持原状。
- [x] 成功时 `{ ok: true, deletedReviews }` 形状和计数不变，非目标 Session、Trade/Bitget Review 与 prefix-collision 数据不受影响。
- [x] 新回滚测试在真实 SQLite 上失败注入有效；ReviewStore 既有前缀测试全部保持通过。
  - 证据：BEFORE DELETE trigger 强制第二步失败后，Session 与所有 Reviews 均保留；成功路径计数 2 且邻近/普通行保留。
- [x] focused tests、全量可运行测试、`npx tsc --noEmit`、`git diff --check` 通过；既有 parity fixture 失败单独记录。
  - 证据：focused 4 文件 / 23 tests + App Replay 63 tests；串行全量可运行 78 文件 / 715 tests；类型与 CRLF-aware diff 检查通过。原始 `npm test` 仅同一缺 pool fixture suite 无法加载。
- [x] persistence spec、任务验收与父地图更新，独立提交并归档。

## Out of Scope

- 合并所有 Store connections、引入 ORM、数据库 schema 迁移或跨库事务。
- 修改前端删除 tombstone、Session 自动保存或 Paper Round 派生规则。
- 提取通用路由 Module（#6）或共享 Candlestick 契约（#7）。
