# 移除回溯复盘图表头部的行情源切换下拉

## Goal

回溯复盘有两处选数据源入口：侧边栏 FreeReplayPanel 的「行情源」分段选择器（新建会话用）与图表头部时间框旁、其他币按钮上的「切换行情源」下拉（11/02 加的进行中会话切源）。用户只要保留前者，删除后者及其专属逻辑 switchReplaySource。

## Requirements

- 删除 `src/ui/App.tsx` 回溯复盘 detail-header 中、时间框按钮与「其他币」按钮之间的 `<select className="replay-source-select">`（aria-label「切换行情源」）。
- 连带删除只被该下拉使用的 `switchReplaySource`（`App.tsx:548` 附近）。
- 清理因此失效的导入：`REPLAY_SOURCE_LABELS`、`ReplayCandleSource`（`App.tsx` 从 `./free-replay-chart` 的导入中移除）。
- 若 `.replay-source-select` 样式仅服务该控件，一并删除对应 CSS。
- **不动**的部分：
  - `FreeReplayPanel` 新建会话的「行情源」分段选择器及其取列表/建会话逻辑。
  - 会话恢复时 `LEGACY_REPLAY_CANDLE_SOURCE` 兜底（`App.tsx` `restoreFreeReplaySession`）。
  - 会话存盘/恢复携带 `candleSource` 的字段与语义。

## Acceptance Criteria

- [x] 回溯复盘进行中会话的图表头部不再出现行情源下拉；时间框按钮与「其他币」按钮正常。
- [x] 新建会话仍可在侧边栏选源；会话按所选源取数、存盘、恢复行为不变。
- [x] `npx tsc --noEmit`（或项目既有 typecheck）通过；`npx vitest run`（或项目既有测试）通过；无未使用导入/变量告警。

## Notes

- Lightweight 任务，PRD-only。
- 背景：11/02 引入进行中会话显式切源是为了补救「会话落盘丢源被静默切回 Binance」的问题；本次只移除入口，不改变 `candleSource` 的存取契约。

## Outcome (11/03)

- 删除：`App.tsx` 头部 `<select className="replay-source-select">` + `switchReplaySource`，`styles.css` 对应两条规则；导入清理 `REPLAY_SOURCE_LABELS`/`ReplayCandleSource`。
- 测试：删 `switches the active session candle source from the header…` 用例；在首个 Free Replay 用例补 `queryByLabelText('切换行情源')` 为空的回归断言。
- spec：`frontend/component-guidelines.md` 的「active session header select」条目改写为「源在创建时选定，随会话终身」。
- 验证：`npx tsc --noEmit` 通过；`npx vitest run` 72 文件 / 640 测试全过。
