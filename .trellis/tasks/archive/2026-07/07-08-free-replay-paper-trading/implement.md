# Free Replay 模拟交易实施计划

## Checklist

1. 新增纯逻辑模块 `src/ui/free-replay-paper-trading.ts`。
   - 定义 session、settings、order、position、trade、stats 类型。
   - 实现市价开仓/平仓、限价挂单、取消挂单、reveal 触发、统计、marker 生成。

2. 为纯逻辑补测试。
   - 市价单按 cursor K 线 `close` 成交。
   - 限价单只在 `low <= limit <= high` 时触发并按限价成交。
   - 开始模拟之前的已 visible K 线不回溯触发订单。
   - 单仓位约束：已有持仓不能再开仓，不能反手。
   - 同类新限价单替换旧单，挂单可取消。
   - Long/Short PnL、单笔收益率、总收益率、胜率、盈亏比。
   - rewind 不调用交易状态回滚。

3. 集成 `App` Free Replay state。
   - 新增 `paperTrading` state。
   - Free Replay `onStart` 自动重置模拟交易 session。
   - reveal 时基于下一根 K 线调用 `processRevealedCandle`。
   - rewind 只移动 cursor，不改模拟交易 state。
   - timeframe switch 不重置模拟交易 state。

4. 新增右侧模拟交易面板组件。
   - 未开始/无持仓/有持仓三种主要状态。
   - 仓位比例和杠杆快捷选项 + 输入校验。
   - Long/Short 方向选择。
   - 市价开仓、限价开仓、取消待开仓单。
   - 市价平仓、限价平仓、取消待平仓单。
   - 当前持仓、浮动盈亏、统计、已完成交易列表、重置模拟。

5. Free Replay 图表 marker 集成。
   - 在 `FreeReplayChart` 创建 marker plugin。
   - 接收模拟交易 marker props。
   - 复用 Trade Review marker 样式。
   - 只显示已成交开平仓 marker，不显示挂单 marker。

6. 样式调整。
   - Free Replay workspace 增加 chart + right panel 布局。
   - 保持控件尺寸稳定，避免按钮和统计文本在窄宽度重排时互相覆盖。
   - 不影响 Trade Review 布局。

7. 集成测试。
   - 扩展 `tests/app-free-replay.test.tsx` 覆盖开始模拟、市价单、限价单触发、统计、自动重置。
   - 若图表 marker 难以在 DOM 断言，则用纯逻辑 marker 测试覆盖格式和方向。

## Validation Commands

- `npm.cmd test -- tests/free-replay-chart.test.ts tests/app-free-replay.test.tsx`
- `npm.cmd test`

## Files Likely To Change

- `src/ui/App.tsx`
- `src/ui/FreeReplayPanel.tsx` 或新增独立 `src/ui/FreeReplayPaperTradingPanel.tsx`
- `src/ui/free-replay-paper-trading.ts`
- `src/ui/styles.css` 或现有样式入口
- `tests/free-replay-paper-trading.test.ts`
- `tests/app-free-replay.test.tsx`

## Rollback Points

- 纯逻辑模块可独立回滚，不影响现有 Free Replay。
- React 集成应保持 Free Replay 原有 `onStart`、reveal、rewind 行为测试不变。
- Marker 集成应隔离在 Free Replay chart，不修改 Trade Review marker 行为。

## Ready Criteria Before Implementation

- `prd.md` 无开放问题。
- `design.md` 和 `implement.md` 已覆盖状态流、成交规则、统计公式和测试范围。
- 用户确认可以进入实现阶段。
