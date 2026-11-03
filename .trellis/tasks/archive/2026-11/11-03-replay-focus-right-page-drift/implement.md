# 执行计划：回溯复盘焦点态右缘翻页视口漂移修复

## 前置阅读

- `.trellis/spec/frontend/component-guidelines.md`（焦点单锚定契约，10/29–10-30 全节）
- `src/ui/App.tsx` 的 `FreeReplayChart`（1285–1965）：双数据集、焦点 effect、自动加载 handler、渲染 effect
- `src/ui/free-replay-chart.ts`（纯函数层）、`tests/app-free-replay.test.tsx` 800–860（handler 捕获模式）

## 步骤

### 1. 纯函数闸（free-replay-chart.ts）

- [x] 新增 `shouldLoadLaterFocusCandles(activeCandles: Candlestick[], cursorTime: number): boolean`（注释按 design.md）
- [x] `tests/free-replay-chart.test.ts` 加四形态用例（<、==、>、空）

验证：`npx vitest run tests/free-replay-chart.test.ts`

### 2. 接线（App.tsx）

- [x] `FreeReplayChart` 内加 `cursorTimeRef`，每渲染同步 `cursorTimeRef.current = replay.cursorTime`（与 `rangeKeyRef` 镜像同款，放在其旁）
- [x] 自动加载 handler 的 R4 分支条件加 `shouldLoadLaterFocusCandles(activeCandlesRef.current, cursorTimeRef.current)`
- [x] `createChart` 的 `timeScale` 选项加 `shiftVisibleRangeOnNewBar: false`（注释说明：焦点态右缘翻页/洞自愈等右端追加走 LWC 补偿保视口；揭示跟随由舒适区 effect 每步重锚，行为等价）

验证：`npx vitest run tests/app-free-replay.test.tsx`

### 3. 组件级回归（tests/app-free-replay.test.tsx）

- [x] chartMocks 的 `createChart` 改为捕获 options（`createChart: vi.fn((_, options) => …)` 存入新 mock `createChartOptions`），现有用例不回归
- [x] 用例 A「焦点态 createChart 关闭 shift」：FreeReplay 挂载后断言 `createChartOptions.timeScale.shiftVisibleRangeOnNewBar === false`
- [x] 用例 B「焦点窗口越过 cursor 时右缘不翻页」：完整流（会话 → 市价开仓 → 揭示 → 市价平仓 → 点单行进焦点，initial 按开仓点返回窗口使右缘 ≥ cursor）→ `barsInLogicalRange` 桩 `barsAfter: 5` → 连续 3 次不同 logical range 调 handler → 断言零 `mode=later` 请求
- [x] 用例 C「右缘落后于 cursor 时翻页可用（非风暴）」：同流程但游标多步前进越过焦点窗右缘 → handler 一次 → 断言恰一次 `mode=later`、再次同 range 不重发

### 4. 全量验证

- [x] `npm test` 全绿（`level-alert-parity.test.ts` 为预存失败：归档任务的 research/pool 数据不在仓库，与本次无关，HEAD 上同样炸）
- [x] `npx tsc --noEmit` 通过
- [x] 红绿验证：A/B/纯函数用例在修复前红、修复后绿；C 两态都绿（防过度修复）

## 审查门

- 实现后走 trellis-check：spec 合规（component-guidelines 焦点契约不破）、双数据集不变式（R2：翻页仍 `publishToApp: false`）、测试真实覆盖乱飘两根因

## 回滚点

- 每步独立提交友好；最坏回退 = 移除一行选项 + 移除一个条件 + 撤两个测试用例
