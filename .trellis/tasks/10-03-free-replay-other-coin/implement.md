# 回溯复盘支持查看其他币 — 实施计划

## 前置

- [ ] 读 `src/ui/OtherCoinChart.tsx` 全文（292 行）
- [ ] 读 `src/ui/App.tsx:219-240`（state 定义）、`791-849`（两个模式的 workspace 分支）
- [ ] 读 `src/ui/free-replay-chart.ts`（裁剪/预取纯函数）
- [ ] 读 `src/ui/chart-autoload.ts`、`src/ui/chart-time.ts:58`（`entryVisibleRange`）
- [ ] 读 `tests/app-free-replay.test.tsx` 与 `tests/free-replay-panel.test.tsx`（测试写法与 mock 方式）

## Step 1. `OtherCoinChart` 加回溯模式

- [ ] props 增加 `cursorTime?: number`；派生 `const isReplay = cursorTime != null`
- [ ] `entryTimeRef` 保存最新 `entryTime`，避免它进 effect 依赖
- [ ] 初始加载 effect：依赖改为 `[instrument, timeframe]`，用 `anchorKey` 守卫重复初始化；请求参数读 `entryTimeRef.current`
- [ ] 新增预取 effect：依赖 `[loaded, cursorTime, instrument, timeframe]`；`shouldPrefetchFutureCandles(loaded, cursorTime, 20)` 命中则 `mode=later`；成功后**同时**更新 ref 与 state（照 `App.tsx:1350`），失败时清 anchor 让下次可重试
- [ ] 渲染 effect：`isReplay` 时 `setData(visibleCandlesForFreeReplay(loaded, cursorTime))`，否则 `setData(loaded)`
- [ ] `subscribeVisibleLogicalRangeChange` handler：`isReplay` 时跳过 `shouldLoadLater` 分支；依赖去掉 `entryTime`
- [ ] `recomputeEntryX` 在 `isReplay` 下用光标时间算 marker
- [ ] 检查 `status` 文案在预取时不要覆盖成「加载更晚 K 线」造成闪烁（预取是后台行为，不该显示为用户可感知的加载中）

## Step 2. `App.tsx` 接入回溯复盘

- [ ] `freeReplay` 分支的 header（`App.tsx:793-801`）在周期按钮后加「其他币」按钮
- [ ] `freeReplay` 分支加 `.chart-float-stack` 容器，内含 `OtherCoinChart`
  - `entryTime={new Date(freeReplay.cursorTime * 1000).toISOString()}`
  - `cursorTime={freeReplay.cursorTime}`
  - 仅 `otherCoinOpen` 为真时渲染
- [ ] `reviewMode` 变化时 `setOtherCoinOpen(false)`（避免切模式残留）
- [ ] 确认 `freeReplay` 为 null（未开始复盘）时不显示该按钮

## Step 3. 样式

- [ ] 回溯复盘工作区的浮层定位类（避开右侧 340px 模拟交易面板），不覆盖 `.chart-float-stack` 在 trade 模式的行为
- [ ] 检查浮层 `max-height` 在回溯工作区高度下不溢出

## Step 4. 测试

- [ ] 新建 `tests/other-coin-chart.test.tsx`，参考 `tests/app-free-replay.test.tsx` 的 fetch mock
- [ ] 断言：
  - 传 `cursorTime` 时渲染的 K 线不含 `timestamp > cursorTime*1000` 的
  - 光标推进后新 K 线出现
  - 切换币种后请求以当前光标时间为锚点
  - 预取成功后已加载集合增长（不渲染）
  - 不传 `cursorTime` 时（trade 模式）行为与改动前一致：渲染全部已加载 K 线

## Step 5. 收尾

- [ ] `npx tsc --noEmit`
- [ ] `npx vitest run`
- [ ] 更新 `CONTEXT.md`：「其他币」面板在回溯复盘下共用光标进度、只显示到光标
- [ ] 手工验证：dev server 起回溯复盘，开面板，右滚看不到未来，主图推进时面板同步

## 回滚点

- Step 1 与 Step 2 之间可独立验证：Step 1 只加 prop 不改默认行为，回归 trade 模式即可
- Step 3 纯样式，出问题单独回退
- Step 4 测试失败先判断是实现错还是断言错，不改断言迁就实现
