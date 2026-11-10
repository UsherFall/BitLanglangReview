# 实施计划：回溯复盘结束 / 恢复复盘

> 本文记录已批准的实施顺序；实际执行与验证结果见文末 `Execution Result`。

## Ordered Checklist

### 1. Shared contract + persistence

- [ ] 在 `src/domain/free-replay-session.ts` 增加 `FreeReplayReviewStatus` 和 `reviewStatus` wire 字段；saved Session 读数始终有明确状态，旧 payload 可缺省。
- [ ] 在 `tests/free-replay-session-store.test.ts` 增加：active/ended 存取与 upsert、缺省 active、真实旧 schema 加列后数据保留。
- [ ] 修改 `src/server/free-replay-session-store.ts`：新表列、旧库加列、Row 映射、insert/upsert 和读取归一化；保持 opaque Paper 泛型及删除事务不变。
- [ ] 在 `tests/free-replay-routes.test.ts` 增加 PUT 缺省/ended/非法状态用例，再修改 `src/server/free-replay-routes.ts` 做边界校验。
- [ ] 验证：`npx vitest run tests/free-replay-session-store.test.ts tests/free-replay-routes.test.ts tests/free-replay-session-delete-transaction.test.ts tests/paper-rounds.test.ts`

**Rollback point 1：** 若迁移或契约有问题，只回滚 Domain/Store/Route；此时尚未改 UI，不影响现有回放。

### 2. Lifecycle freeze / resume

- [ ] 在 `tests/free-replay-session-lifecycle.test.tsx` 先增加直接 `renderHook` 用例：
  - [ ] end 后 `freeReplay` 与 Paper 对象内容不变，resume 只切状态。
  - [ ] ended 时 exposed `setPaperTrading` 对值更新和 functional update 均 no-op，resume 后恢复。
  - [ ] ended 时 reveal/rewind 不改进度，不清 Focus，不调用 future retry，不处理成交。
  - [ ] ended 时 switchTimeframe 仍保留 `progressTime`，不触碰 Paper。
  - [ ] fresh start 为 active；restore 保存的 ended 保持 ended；缺字段 legacy restore 为 active；删除当前 ended 会话后状态复位。
  - [ ] end/resume 立即同步匹配 history row 的状态；trailing PUT 未返回时，当前同 key restore 及切换到其他会话再恢复都不能用过期 row 绕过 ended。
  - [ ] 自动保存、mode-exit flush 和 pagehide payload 携带最新 `reviewStatus`。
- [ ] 修改 `src/ui/use-free-replay-session-lifecycle.ts`：新增状态、end/resume、raw/private Paper setter 与公开冻结感知 wrapper、reveal/rewind 入口守卫、save/restore/start/delete 接线。
- [ ] 验证：`npx vitest run tests/free-replay-session-lifecycle.test.tsx`

**Rollback point 2：** 若状态迁移出现回归，可独立回滚 hook；已新增的 DB 列保持向后兼容，无需 down migration。

### 3. UI wiring and presentation

- [ ] 在 `tests/free-replay-panel.test.tsx` 增加 ended 时上一根/下一根禁用与提示、active 时既有 Paper rewind 锁仍正确的用例。
- [ ] 修改 `src/ui/FreeReplayPanel.tsx`，传入并呈现 Replay progress lock；不改动 instrument/source picker。
- [ ] 修改 `src/ui/App.tsx`：
  - [ ] 从 lifecycle 读取 `reviewStatus/endReview/resumeReview`。
  - [ ] 在现有 header 内放结束/恢复按钮和状态标记，不增加 workspace 顶层元素。
  - [ ] 键盘 listener 检查 ended 并补依赖；向侧边面板传 progress lock。
  - [ ] 向 Paper Panel 传 `readOnly`；ended 固定单子视图，禁用全部 Paper 可变入口，保留统计和 Focus。
  - [ ] active/resume 路径维持既有 start/open/close/rewind 规则。
- [ ] 在 `src/ui/styles.css` 复用现有按钮、面板和 badge 语言，检查窄屏 header 与 Paper Panel 布局。
- [ ] 验证：`npx vitest run tests/free-replay-panel.test.tsx tests/free-replay-session-lifecycle.test.tsx`

**Rollback point 3：** UI 回滚不影响已保存游标/Paper；旧 UI 会忽略 ended 状态，按既有 active 行为工作。

### 4. App integration coverage

- [ ] 在 `tests/app-free-replay.test.tsx` 增加完整流：
  - [ ] 有持仓 + pending 委托/止损时结束，图表/统计/单子仍在，操作入口不可用，所有现场字段不变。
  - [ ] 上一根/下一根和左右方向键均不能推进；future retry 不增加，未发生新成交。
  - [ ] ended 时点单子 Focus、切周期仍可用，`progressTime`/Paper 不变。
  - [ ] 恢复后同一会话可继续开仓/步进，未额外 reveal 或 reset。
  - [ ] 未开始模拟的会话结束/恢复后仍需用户主动开始模拟。
  - [ ] 保存后恢复历史会话仍是 ended；旧会话缺字段可正常操作。
- [ ] 既有 App Replay characterization 不删断言、不放宽游标/标记/Focus/StrictMode 检查。
- [ ] 验证：`npx vitest run tests/app-free-replay.test.tsx tests/free-replay-panel.test.tsx tests/free-replay-session-lifecycle.test.tsx`

### 5. Full verification and review

- [ ] `npx tsc --noEmit`
- [ ] `npm test`
- [ ] `git diff --check`（CRLF 环境按现有 spec 使用 `cr-at-eol`，不做全文件换行归一化）
- [ ] 手工 dev-server 验收：
  - [ ] 持仓 + 限价委托 + 止损现场结束复盘，按钮/快捷键/交易控件全部冻结。
  - [ ] 刷新页面、离开模块再回来、从历史会话恢复均仍 ended；恢复复盘后现场一致。
  - [ ] 旧会话正常 active；未开始模拟的会话不会被恢复动作自动开始。
  - [ ] 单子 Focus、拖图、切周期和其他币查看正常，无未来 K 线泄露或视口回归。
- [ ] 检查 diff 只包含本任务、测试和必要 spec/journal；若形成新稳定契约，更新 `.trellis/spec/domain/shared-contracts.md`、`.trellis/spec/frontend/free-replay-session-lifecycle.md`、`.trellis/spec/frontend/state-management.md`、`.trellis/spec/server/persistence-and-imports.md` 及 `CONTEXT.md` 的 Free Replay Session 定义。

## Review Gates

1. Persistence 与 lifecycle 必须分别有直接测试，不能只靠 App 集成测试。
2. UI disabled/hidden 与 lifecycle guard 必须同时存在；任何一侧缺失都不算完成。
3. 恢复历史 ended 会话不得自动 resume；fresh start 不得继承前一会话 ended。
4. 不得修改 Paper Round id/blob、Dataset ownership、删除 tombstone 或现有 reveal/timeframe 数学。
5. 全量测试和 typecheck 通过后才能进入 finish-work / commit。

## Execution Result（11/10）

- Domain / SQLite migration / PUT validation / lifecycle / UI / App integration 均已实施，PRD AC1–AC9 已由直接测试和 App 集成测试覆盖。
- `tests/app-free-replay.test.tsx`：66/66 通过。
- 相关 Store / Route / lifecycle / Panel / cascade / Paper Round：36/36 通过。
- `npx tsc --noEmit`：通过；`git diff --check`：通过。
- 全量 `npm test`：84 个文件、735 项测试通过；`tests/level-alert-parity.test.ts` 因 HEAD 中本就不存在的 `.trellis/tasks/archive/2026-10/10-20-anomaly-level-tracker/research/pool/` fixture 无法加载，与本改动无关。
- `npx vitest run --exclude tests/level-alert-parity.test.ts`：84/84 文件、735/735 测试通过。
- 质量审查额外修复：ended 下同 key restore 现完全 no-op，避免旧历史 payload 暗中回滚游标/Paper；已加回归测试并同步规范。
- 当前环境没有浏览器交互工具，手工 dev-server 点击验收未执行；自动化已覆盖持仓 + 双委托 + 止损、键盘/按钮、切周期、Focus、结束/恢复与 ended 历史恢复。
- `trellis-implement` / `trellis-check` 子代理均因环境 `spawn pi ENOENT` 无法启动，实施与全量检查在主会话按相同上下文和规范完成。
