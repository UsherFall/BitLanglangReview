# Trade Review K线控制与复盘收益额

## Goal

让复盘者在 Trade Review 中用键盘左右键逐根移动当前图表视图，并在复盘进度区域看到当前 Review Queue 中已复盘交易的累计收益额。目标是提升顺序看盘效率，并把复盘完成度和已复盘部分的收益表现放在同一处反馈。

## Background

当前应用是本地交易复盘工具，核心界面在 `src/ui/App.tsx`。

已确认事实：

- Free Replay 已有左右键快捷键：`ArrowRight` 调用 `revealNextFreeReplayCandle`，`ArrowLeft` 调用 `rewindFreeReplayCandle`，只在 `reviewMode === 'freeReplay'` 时生效。
- Trade Review 当前没有左右键快捷键；TradeChart 已使用 `getVisibleRange` / `setVisibleRange` 设置和恢复图表可视范围。
- Trade Review 当前 K 线加载、entry/exit markers、drawings、on-demand loading 都围绕完整已加载 candles 工作，不应改成隐藏/揭示模式。
- 当前边缘加载监听在 visible logical range 变化后运行，会根据 `shouldLoadEarlier` / `shouldLoadLater` 触发已有 `loadMore` 流程。
- 复盘进度当前由 `src/ui/review-progress.ts` 计算，只包含 `total`、`reviewed`、`current`。
- `CONTEXT.md` 定义：Review Progress 中“已复盘”只由 Review Tags 判断，Review Notes 不计入已复盘。
- `ReviewedTrade` 已有 `profit` 字段；收益率不纳入本次指标，因为仓位大小和分母口径会让累计收益率不够准确。

## Requirements

### R1. Trade Review 支持左右键移动图表视图

在 Trade Review 模式下，用户可以通过键盘左右键控制当前 Trade 图表视图逐根前进/后退。

具体要求：

- 左右键不切换 Review Queue 中的上一笔/下一笔 Trade。
- 左右键不隐藏或揭示 K 线；现有 K 线加载、渲染、entry/exit markers、drawings、on-demand loading 逻辑保持不变。
- 每次按键移动一个当前 Review Timeframe 的 K 线宽度。
- `ArrowRight` 将可视范围整体向后移动一根 K 线；`ArrowLeft` 将可视范围整体向前移动一根 K 线。
- 快捷键只在 Trade Review 模式生效，且输入框、下拉框、textarea 聚焦时不拦截。
- 左右键移动到当前已加载范围边缘附近时，应复用现有 on-demand candlestick loading 逻辑；不为键盘新增一套独立加载流程。
- Free Replay 现有左右键 reveal/rewind 行为不回归。

### R2. Review Progress 显示已复盘收益额

在现有 Review Progress 面板中新增“已复盘收益”指标。

具体要求：

- 指标基于当前 Review Queue，而不是全量 workbook。
- 已复盘范围仍按 Review Tags 判断，和现有 Review Progress 语义一致。
- 已复盘收益额 = 当前 Review Queue 中所有已复盘 Trades 的 `profit` 求和。
- 不显示累计收益率。
- 文案使用“已复盘收益”。
- 值显示为带符号 USDT 金额，例如 `+123.45 USDT`、`-123.45 USDT`、`0.00 USDT`。
- 展示位置放在现有 Review Progress 面板中，和“当前 / 已复盘”并列。
- 正收益、负收益、零收益应有清晰视觉区分；正负收益沿用现有 `.good` / `.bad` 或 `.profit` / `.loss` 颜色语义。
- 保存 Review Tags 后，已复盘数量和已复盘收益额应一起即时更新。

## Acceptance Criteria

- [ ] Trade Review 模式下，按 `ArrowRight` 可以让当前图表视图向后一根当前 Review Timeframe K 线移动。
- [ ] Trade Review 模式下，按 `ArrowLeft` 可以让当前图表视图向前一根当前 Review Timeframe K 线移动。
- [ ] 在 input、select、textarea 聚焦时，左右键不触发 Trade Review 图表移动。
- [ ] Free Replay 现有左右键 reveal/rewind 行为不回归。
- [ ] Trade Review 的 K 线加载、entry/exit markers、drawings、on-demand loading 继续按现有逻辑工作。
- [ ] 左右键移动到已加载 K 线边缘附近时，会通过现有边缘加载流程获取更多 K 线。
- [ ] Review Progress 面板在“当前 / 已复盘”旁显示“已复盘收益”。
- [ ] 已复盘收益按当前 Review Queue 中有 Review Tags 的 Trades 的 `profit` 求和，并显示为带符号 USDT 金额。
- [ ] 保存 Review Tags 后，复盘数量和已复盘收益一起更新。
- [ ] 添加或更新 Vitest 覆盖 Trade Review 快捷键移动和收益额指标计算。

## Out Of Scope

- 不引入账户、云同步或多用户协作。
- 不修改 Source Workbook。
- 不把 Free Replay session 持久化。
- 不改变“Review Notes 不计入已复盘”的规则。
- 不实现收益率或资金曲线图。
- 不把左右键改成切换 Trade Queue 的上一笔/下一笔 Trade。

## Technical Notes

- 预计主要修改 `src/ui/App.tsx`、`src/ui/review-progress.ts`、`src/ui/styles.css` 和相关测试。
- TradeChart 键盘移动应以当前 `timeframeMs(timeframe) / 1000` 作为移动步长，并基于当前 `timeScale().getVisibleRange()` 调用 `setVisibleRange()`。
- 键盘移动产生的 visible range 变化应自然触发现有 visible logical range 订阅，从而复用 on-demand loading。

## Open Questions

无。
