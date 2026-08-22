# Trade Review 显示同一 Instrument 所有开单位置

## Goal

在 Trade Review 模块中提供一个按钮，让用户能查看当前 Instrument 下所有 Trade 的开仓和平仓位置（Entry/Exit points）。

## Background / Confirmed Facts

- `CONTEXT.md` 使用 **Instrument** 而不是 coin/pair；本需求中的“同一个币种”按 **同一 Instrument** 处理。
- 当前 Trade Review 的 `TradeChart` 只显示当前选中 Trade 的 Entry/Exit markers（`src/ui/trade-markers.ts`、`src/ui/App.tsx`）。
- 数据源是已完成的 Trade 列表，不包含实时持仓/未平仓订单，因此“开单位置”应理解为历史 Trade 的 Entry 标记或列表。

## Requirements

- 在 Trade Review 图表中提供一个按钮，可切换显示当前 Instrument 下所有 Trade 的 Entry 和 Exit markers。
- 按钮放在 Trade Review 图表的左上角工具栏，使用图标按钮 + tooltip/aria-label（例如「显示全部开平仓」）。
- 全部开平仓视图不受侧边栏筛选影响，始终使用当前 Instrument 的全部历史 Trade。
- 在“全部开平仓”视图中，当前选中的 Trade 使用不同颜色/样式突出显示。
- 进入“全部开平仓”模式后，现有 Eye 按钮隐藏/禁用；退出后恢复原有行为。
- 点击侧边栏 Trade 后，图表仍以该 Trade 的 Entry 为视图中心；开启/关闭全部开平仓不改变这个现有逻辑。

## Acceptance Criteria

- [ ] 点击按钮后，K 线图上出现当前 Instrument 下所有 Trade 的 Entry 和 Exit 标记。
- [ ] 再次点击可关闭该显示，恢复原有 marker 行为。
- [ ] 当前选中的 Trade 在全部开平仓视图中可被视觉区分。
- [ ] 图表工具栏出现可切换的「全部开平仓」按钮，具备可访问的 aria-label。
- [ ] 全部开平仓显示的数据不随侧边栏筛选变化，始终为当前 Instrument 全部 Trade。
- [ ] 进入全部开平仓模式后，现有 Eye 按钮隐藏/禁用。
- [ ] 点击 Trade 后仍以该 Trade 的 Entry 为视图中心；开启/关闭全部开平仓不会触发额外视图跳转。

## Open Questions

- [x] “开单位置”的展示形式：**图表 marker**（K 线图上显示 Entry 点）。
- [x] 展示范围：**严格同一 Instrument**（例如 `BTC-USDT-SWAP` 只显示该合约的 Trade Entry）。
- [x] 开启“全部开仓”后，**同时显示同一 Instrument 下所有 Trade 的 Entry 和 Exit 标记**。
- [x] 全部开平仓数据**不受侧边栏筛选影响**。
