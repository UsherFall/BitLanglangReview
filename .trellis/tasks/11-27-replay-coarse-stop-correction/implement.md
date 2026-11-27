# 实施计划与结果

## 1. 回归测试先行（Red）

- [x] 新增 `tests/free-replay-order-execution.test.ts`：真实片段选择、普通/无订单路径、多空止损、限价开仓、止盈优先级、grid 与 4H/1D/1W/1M 子周期、initial/later、缺数据/空数据/分页不前进/请求失败、逐根成交时间。
- [x] 更新 `tests/free-replay-session-lifecycle.test.tsx`：真实 15m→1H 误损、真实触损、pending 去重、失败重试、switch/restore/end/Paper/mode-exit/unmount 迟到响应、普通 reveal 零执行请求。
- [x] 更新 `tests/app-free-replay.test.tsx`：完整点击 15m 开仓设损→1H→下一根，验证 Paper 持仓、source/instrument 和图表无执行子K线；`free-replay-panel.test.tsx` 覆盖 pending/error。
- [x] Red 证据：旧实现运行真实场景时 `position=null`，断言 `not.toBeNull()` 失败；helper 首次运行因模块不存在失败。实现后均转绿。

## 2. 实现精确重放（Green）

- [x] `chart-time.ts` 新增 grid 感知 `isTimeframeBoundary`，`chart-time.test.ts` 覆盖双日界和 15m 边界。
- [x] 新增 `free-replay-order-execution.ts`：自动订单检测、过渡识别、最粗对齐子周期、initial/later、精确连续性验证、现有状态机逐根执行。
- [x] lifecycle：普通 reveal 同步；过渡 reveal 使用 operation token、latest-active ref、pending/error，成功一次提交，失败不改现场，场景/Paper/离开/卸载使旧响应失效。
- [x] FreeReplayPanel/App：pending 禁用与错误提示，按钮+键盘+lifecycle 防重复；执行数据不进入 Dataset。
- [x] 未修改 `processRevealedCandle` 正常成交算法，无 BTC/价格特判、无新 API/schema。
- [x] 既有 100% 限价平仓用例最初因 mock 缺过渡 5m 片段被完整性保护拒绝；补齐对应 5m 数据后通过，没有绕过保护。

## 3. 本地数据修复

- [x] 添加 `repair-position-31.py`：默认 dry-run、原始 blob hash/关键字段校验、SQLite online backup、`BEGIN IMMEDIATE`、单行条件 UPDATE、事务内和提交后验证。
- [x] 用户确认已关闭/离开目标回溯页面，避免旧浏览器 autosave 覆盖。
- [x] dry-run 确认只删除 fill-35/36、只恢复 position-31/leg-32；修正了脚本初始成交计数假设（实际原始 12 笔、修复后 10 笔），未写真实库。
- [x] 在 `.scratch/repair-position-31-rehearsal.sqlite` 副本完成 apply + verify 演练。
- [x] 真实库执行成功，备份：`data/review.bak-20261127T080407.728757Z-position-31.sqlite`。
- [x] 新连接及生产代码复核：quantity=0.27049727768827403、margin=1437.8688541436738、notional=14378.688541436739、10x、stop=52403、nextId=37、cursor/progress 不变；realized=2286.557380899826，available≈1848.688526756152。
- [x] `buildPaperRoundLibrary` 确认开放 position-31 不在 rounds；其他会话在事务中逐字段比较不变。
- [x] 当前库与备份 `pragma integrity_check` 均 ok；备份原始 Paper hash 仍为 `724f6e...13aa72`，当前修复后 hash=`d847435b33edbcf53c264fcba7a7157bcd478891e70d638031c685046573d197`。
- [ ] 用户重新打开页面做视觉确认（数据恢复和生产 normalize/library 验证已完成）。

## 4. 全量质量门禁

- [x] 聚焦：9 文件、193 用例通过；之后 App Replay 单文件再次 70/70 通过。
- [x] `npx tsc --noEmit`、`git diff --check`、`task.py validate` 通过。
- [x] 原始 `npm test` 已运行：85 文件/788 用例通过，唯一 suite 失败为既有 `level-alert-parity.test.ts` 缺 gitignored 归档 `research/pool`；journal 显示该环境缺失在多次既存任务中相同存在。
- [x] 排除上述缺失 fixture 的全量运行中，既有 gap-heal 用例出现一次并发时序失败（期待旧渲染但 mock 清空后为 []）；该用例单独运行及整个 App Replay 重跑均通过，未修改无关测试。
- [x] 主会话全量复核：时间单位/grid、future leak、autosave、ended、Focus、Paper Round、导入依赖、备份与回滚。implement/check 子代理均因环境 `spawn pi ENOENT` 无法启动，未伪称子代理审查。

## 5. Spec / 记录 / 回滚

- [x] 更新 `component-guidelines.md`：新推进区间、细周期重放、完整性、失败原子性和测试锚点。
- [x] 更新 `free-replay-session-lifecycle.md`、`state-management.md`、`quality-guidelines.md`：pending/error、operation token、执行读取与 Dataset 边界及验收。
- [x] 在任务文档记录根因、Red/Green、备份、真实修复值与测试限制；developer journal 在提交收尾时同步。
- [x] 回滚点：代码用 git；本地数据只用上述备份恢复，不重跑修复脚本覆盖新状态。
