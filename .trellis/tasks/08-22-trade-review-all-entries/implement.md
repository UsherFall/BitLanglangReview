# Implement: Trade Review 全部开平仓 markers

## Checklist

1. 在 `src/ui/trade-markers.ts`：
   - 给 `tradeMarkers` 增加可选 `highlighted` 参数（默认 `true`，保持现有颜色）。
   - 新增 `allTradeMarkers(trades, activeTradeId, timeframe, candles)`，对每个 Trade 调用 `tradeMarkers`；active Trade 高亮，其它 Trade 使用灰色弱化。
2. 在 `src/ui/App.tsx`：
   - 从 `lucide-react` 导入 `MapPin`。
   - `TradeChart` 增加 `showAllMarkers`、`allTrades`、对应 refs 和加载状态。
   - 增加 effect：`showAllMarkers` 为 true 时请求 `/api/trades?instrument=...`。
   - 工具栏增加「显示/隐藏全部开平仓」按钮；全部开平仓模式下隐藏现有 Eye 按钮。
   - 增加 marker 生成函数/effect：`showAllMarkers` 时使用 `allTradeMarkers(...)`，否则使用 `tradeMarkers(...)`。
   - 修改 `renderCandles` 调用点与函数签名，把计算好的 `nextMarkers` 传入。
3. 测试：
   - 扩展 `tests/trade-markers.test.ts`：覆盖 `allTradeMarkers` 返回 2 个 Trade 的 4 个 marker、active 高亮、非 active 弱化。
   - 在 `tests/app-chart-price.test.tsx` 或新增 app 测试：断言图表工具栏出现「显示全部开平仓」按钮，点击后 aria-label/title 切换。
4. 验证：
   - `npm test`
   - `npx tsc --noEmit`（若无独立类型检查脚本则执行）

## Risks / Rollback

- `renderCandles` 是 TradeChart 内部函数；改动集中，可整文件回滚。
- 如果 marker 过多导致文本重叠，后续可增加 `size`/`id` 或按需显示文本，不在本次范围。
