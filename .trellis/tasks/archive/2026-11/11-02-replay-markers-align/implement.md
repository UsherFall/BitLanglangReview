# 执行计划

## 步骤

1. **纯函数：点集计算**
   - [ ] `src/ui/free-replay-paper-trading.ts`：新增 `paperTradeChartPoints(trades, cursorTime, timeframe, candles): MarkerPoint[]`（锚定 `containingCandleTimestamp(eventTime - 1)`，null 丢弃；开点按 positionId 去重；long/short → 多/空；时间过滤 <= cursorTime）。
   - [ ] 删除旧 `paperTradeMarkers`（全仓无其他引用后）。
   - [ ] 单测：同周期/细周期成交/粗周期成交三种锚定 + 未加载丢弃 + 开点去重 + 未来过滤。

2. **图表层：primitive + tooltip 接线**
   - [ ] `FreeReplayChart`（src/ui/App.tsx）：去掉 `createSeriesMarkers`，挂 `TradeMarkerPrimitive` + `createTradeMarkerTooltip`；props 改为 `paperPoints: MarkerPoint[]` + `focusPoints: MarkerPoint[]`；`markersVisible` 决定用哪组；渲染 effect 里 `setPoints` + `setPoints` 后用可见蜡烛数组。
   - [ ] crosshair → `findPointAt` → paper 版 tooltipDataFor（价格/数量/时间/杠杆/盈亏）。
   - [ ] 验证：光标揭示约束不破（步进后标记随蜡烛出现）。

3. **App 层：焦点过滤 + 面板 key**
   - [ ] `paperMarkerPoints` / `focusPaperMarkerPoints` 计算并下传；删除旧 `paperMarkers` SeriesMarker 计算与 `.filter(time <= cursorTime)`（逻辑移入纯函数）。
   - [ ] `<FreeReplayPaperTradingPanel key={instrument:startTime}>`。
   - [ ] 眼睛按钮 title/aria 不变，行为换过滤。

4. **测试改造**
   - [ ] app-free-replay.test.tsx：markers toggle 用例改造为 primitive 点集断言；新增焦点过滤、跨周期锚定、A→B 会话切换面板跟随三个用例（tmp-switch-sessions 验证过的思路转正）。
   - [ ] 全量 `npm test`。

5. **质量门 + 收尾**
   - [ ] `npx tsc --noEmit`（或项目等效检查）。
   - [ ] 手动核对清单（浏览器）：BTC 2023-03-18 会话 1H 图标记蜡烛 close == 成交价；眼睛按钮三态；tooltip 悬浮；会话切换面板跟随。
   - [ ] spec 更新（component-guidelines：回溯复盘标记层契约——锚定规则、焦点过滤、panel key）。
   - [ ] 提交。

## 验证命令

```bash
npm test
npx tsc --noEmit
```

## 回滚点

- 每步一个独立可 revert 的改动；步骤 1/4 的纯函数测试先行，图表层（2/3）失败可单独回退而不动数据层。

## 风险

- jsdom 下 primitive 布局为空（`timeToCoordinate` null）→ 断言走 `currentPoints()`/传入点集而非 canvas 绘制结果。
- 旧眼睛按钮用例（setMarkers/text 断言）必须同步改，否则全量测试假红。
