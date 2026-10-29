# 实施计划：回溯复盘单子面板 Tab 化 + 点单锚定开仓点

按序执行；每步后跑相关测试。

## 1. 面板 Tab 化（R1）

- [x] `App.tsx` `FreeReplayPaperTradingPanel`：加 `panelTab` 本地 state；头部/统计常显；下方 `role=tablist` 两个 Tab（操作 / 单子 (N)）；现有开始模拟、参数、开仓、持仓操作（加仓/平仓/止损）搬入「操作」Tab body；新「单子」Tab body 放持仓行、挂单行、已完成交易列表（空态「暂无单子」）
- [x] `styles.css`：`.paper-trading-panel` 改 flex 列 + `overflow:hidden`；新增 `.paper-tabs` / `.paper-tab-body`（`flex:1; min-height:0; overflow-y:auto`）；`.paper-trade-row` 等行改 button 样式
- [x] 验证：`npx vitest run tests/app-free-replay.test.tsx` 既有用例全绿（面板 aria-label 不变，操作控件只是搬了位置）

## 2. 焦点单状态与清除时机（R2/R3 的 App 侧）

- [x] `App` 加 `orderFocus` state（`{ id, timeMs, token } | null`）
- [x] 面板新 props：`focusedOrderId` / `onFocusOrder(trade)` / `onReturnToCursor()`；已完成交易行点击 → `onFocusOrder`；持仓行点击 → `onReturnToCursor`
- [x] 清除接线：`revealNextFreeReplayCandle`、`rewindFreeReplayCandle`、`onMarketOpen`、`onLimitOpen`、`onCloseRatio`、`onLimitClose`、`handleFreeReplayStart`、`restoreFreeReplaySession`、`handleDeleteSession`（当前会话）、离开 freeReplay 模式的 effect
- [x] `switchFreeReplayTimeframe` 确认不清除

## 3. FreeReplayChart 定位通道（R2/R3 的图表侧）

- [x] 新 prop `focusRequest`；新 refs `appliedFocusKeyRef`、`earlierExhaustedRef`
- [x] `loadEarlierFreeReplayCandles`：返回空时置 `earlierExhaustedRef.current = true`；数据加载 effect 重置 refs 处重置它
- [x] 初始化 effect：有 `focusRequest` 时跳过光标锚定的 setVisible*（`initializedRangeKeyRef` 照置）
- [x] 新定位 effect（声明在初始化/光标跟随 effects 之后）：去重键 `rangeKey:token`；未覆盖则追页；覆盖则 `entryVisibleRange(new Date(timeMs).toISOString(), timeframe, replayCandleGrid(replay))` + `suppressAutoLoadRef` 包裹 setVisibleRange；额外加了周期匹配闸（loadedCandles[0].timeframe !== timeframe 时等待，防止切周期过渡 commit 里追页混入旧周期数据）
- [x] 行内时间格式 helper `formatPaperTime(ms)`（Asia/Shanghai `MM-DD HH:mm`）

## 4. 测试

- [x] 按 design.md 测试计划 1–7 补用例（tests/app-free-replay.test.tsx，6 个新用例：Tab 切换、点击定位+不拽回+重复点重新定位、切周期重锚+初始化不锚光标、步进解除、持仓行回光标、追页加载后定位）
- [x] `npm test` 全绿（615/615）；`npx tsc --noEmit` 零报错（顺带修复了 makeSeededSession overrides 类型导致的既有 886 行 TS 报错）

## 5. 收尾

- [ ] trellis-check 子代理全量核查
- [ ] spec 更新（frontend/component-guidelines.md 的回溯复盘小节：焦点单锚定契约 + 面板 Tab 结构）
- [ ] 提交

## 回滚点

- 步骤 1（纯 UI 重组）与 2+3（锚定功能）相互独立，可分别 revert；锚定功能出问题时不影响面板 Tab 化。
