# Free Replay Session 生命周期深化

## Goal

把 Free Replay Session 的创建、恢复、历史列表、自动保存、删除和切换协调从 `App.tsx` 收进一个独立 React Module，以收窄的 Interface 提升 Locality 和直接可测试性，同时保持现有 Session、Cursor、Paper Trading 与 Paper Round 行为。

## Background

- 父任务 `11-05-architecture-deepening` 的子任务 1–3 已完成；本交付项是地图 #4，必须在 #5 事务性删除、#6 路由提取和 #7 共享契约迁移之前独立完成。
- 当前 App 同时持有 Replay/Paper/timeframe 状态、session refs、GET/PUT/DELETE、500ms debounce、pagehide flush、删除墓碑和 cursor actions；高风险竞态只能通过整页 App 测试间接验证。
- 现有 `FreeReplayDataset` 已拥有 Candlestick 窗口，本任务不得形成第二份蜡烛数据所有者。
- 详细现状与兼容契约见 `research/current-state.md`。

## Requirements

- **R1 — 独立生命周期 Module。** 新建 `useFreeReplaySessionLifecycle`，统一拥有 active Replay、Paper Trading、共享 timeframe、session history、pending save、debounce 和 deletion tombstones；不暴露这些内部 refs 或通用 `setFreeReplay`。
- **R2 — 收窄的 App 接口。** App 通过 intent commands 创建/恢复/删除/揭示/回退/切周期，并保留 candle arrays、Focus、future retry 和 Paper Library。跨边界副作用通过少量明确 callbacks 完成，不引入全局 store。
- **R3 — 协议兼容。** 保持 `/api/free-replay/sessions` 的 GET/PUT/DELETE、payload 字段、updatedAt 排序、500ms trailing save、mode-exit flush、pagehide keepalive 和恢复时 saved-cursor anchor。
- **R4 — 正确性防护。** 保留 deleted-key 对 stale PUT 的防复活、新鲜创建清墓碑、恢复前 flush  outgoing、Paper Trading active 时禁止 rewind，以及切周期/恢复时 Focus 与 candle view 重置。
- **R5 — 直接测试面。** 用 `renderHook` + fake timers + controllable fetch 覆盖保存、恢复、删除竞态、重建、揭示/回退/切周期；现有 App / Panel / Store characterization 不得削弱。
- **R6 — 独立质量与知识沉淀。** focused tests、全量可运行测试、类型检查和 diff check 通过；新 Module 的 signatures、contracts、错误行为和测试要求写回 frontend spec。

## Acceptance Criteria

- [x] App 不再直接持有 pending-save refs、deleted-session tombstones、session GET/PUT/DELETE 或 Replay lifecycle handlers；Chart Dataset 与 Paper Library 边界没有混入新 Module。
- [x] 新 Module 提供明确的 state + intent-command Interface，直接测试不挂载整页 App 即可验证自动保存、恢复、删除和切换。
- [x] 恢复会话保留 timeframe、cursor、Paper Trading 和 source，数据窗口锚定 saved cursor；开始相同 key 的会话走恢复路径。
- [x] 500ms 自动保存包含完整 payload，离开 Replay 与 pagehide 不丢 pending save；删除后 stale PUT 不复活历史行， fresh start 可合法重建同 key。
- [x] reveal / rewind / timeframe switch 的 Cursor、Paper Trading、Focus reset 和 future retry 行为与既有 App 测试一致。
- [x] focused tests、全量可运行 `npm test`、`npx tsc --noEmit`、`git diff --check` 通过；既有 `level-alert-parity` fixture 失败单独记录。
  - 证据：focused 4 文件 / 82 tests；全量可运行 77 文件 / 713 tests；类型与 diff 检查通过。原始 `npm test` 仅同一缺 pool fixture suite 无法加载。
- [x] 相关 frontend spec 与父任务地图更新，交付提交后归档本子任务。
  - 证据：新增 `free-replay-session-lifecycle.md`，并更新 frontend index、state-management 与 quality-guidelines。

## Out of Scope

- 修改 Session API、SQLite schema 或事务性级联删除（后者属于 #5）。
- 提取 Vite 路由 Module（#6）或迁移共享响应类型/timeframe duration/candle merge（#7）。
- 改变 Candlestick Dataset、图表视口、Paper Round 派生规则或任何产品 UX。
- 引入全局 frontend store、通用 reducer 框架或第二份 Replay/Paper mutable state。
