# Research：根因核实记录（2025-10-28）

本文件记录诊断阶段核实过的事实，实现时可直接引用，不需要重新验证。

## 1. `timeToCoordinate` 对未加载时间返回 null

`node_modules/lightweight-charts/dist/lightweight-charts.standalone.development.js` 的 `timeToCoordinate(time)`：

```js
const timePointIndex = this.timeToIndex(time, false);
if (timePointIndex === null) return null;   // 时间不在数据索引中 → null
return this._timeScale._indexToCoordinate(timePointIndex);
```

`chart-drawing.tsx` 的 `pointToScreen` 拿到 null 后整体返回 null，`DrawingShape` 里 `points.some((point) => !point)` → 整条线不渲染。**水平线不走这条路径**（只用 `priceToCoordinate`，是纯价格映射），所以消失的是射线/遗留线段。

`priceToCoordinate` 对任意价格都能算出坐标（只要序列有数据），不受时间轴影响。

## 2. 切周期后小周期只加载光标附近 ±150 根

`switchFreeReplayTimeframe`（App.tsx ~491）把 `dataAnchorTime` 重置为 `current.progressTime`；`FreeReplayChart` 初始加载 `mode: 'initial'` = 锚点前后各 n 根（n=150）。5m ≈ ±12.5h，4H ≈ ±25 天。4H 上画的射线锚点通常早于 5m 已加载窗口的起点 → `timeframeTimeForPoint` 的 `containingCandleTimestamp` 返回 null → 回退 `floorTimestamp` 网格对齐 → 仍不在 5m 数据索引里 → null → 整线隐藏。

用户往左拖（`shouldLoadEarlierByLogicalRange`，barsBefore<50 触发补载）后锚点进入索引，线重新出现 —— 与用户描述「时有时无」吻合。

## 3. 步进时 `setData` 不移动视口；cursorFollow effect 是唯一的「拽画面」

lightweight-charts `_internal_updateTimeScale`：仅当 `newBaseIndex > currentBaseIndex`（右端追加了新数据）且 `needShiftVisibleRangeOnNewBar` 不成立时做右偏移补偿；`shiftVisibleRangeOnNewBar` 路径也只在最后K线可见且右端追加了数据时触发。

回溯复盘每步都调 `series.setData(chartDataWithWhitespace(visibleCandles, ...))`，而 `chartDataWithWhitespace`（App.tsx ~2040）对首末K线各恒定补 **padCount=200** 根空白 —— 首末索引不变，baseIndex 不变 → 无任何自动视口移动。

结论：视口被拽完全由 App.tsx 的 cursor follow effect（~1368「Cursor follow effect: scroll viewport to keep cursor 10 steps from right edge」）在每次 `replay.cursorTime` 变化时无条件 `setVisibleRange` 造成。

## 4. 现有跨周期可见性的保障层（不要动）

- GET `/api/drawings?instrument&board` 不带 timeframe（app-plugin.ts ~268 注释 10/22）；`DrawingStore.listDrawings` board 内 canonical instrument 匹配。
- `useChartDrawings` 的加载 effect 依赖 `[instrument, board, enabled]`，切周期不重拉，画线集合跨周期共享。
- 10/22 回归测试在 `tests/app-drawings.test.tsx`「loads the instrument's whole drawing set…」，其 mock `timeToCoordinate` 恒返回坐标（不返回 null），所以该 suite 从未覆盖越界路径 —— 这是本次要补的用例。
- 规格：`.trellis/spec/frontend/quality-guidelines.md` L20「Drawings remain instrument-level within their board … appear across trades/timeframes」。

## 5. 测试 mock 关键参数（tests/app-drawings.test.tsx）

- `timeToCoordinate: (time) => time - 1716256800`（1px = 1s，越界改造后对 `time < 1716256800` 返回 null 即可覆盖越界路径）
- `coordinateToTime: (x) => 1716256800 + x`；`priceToCoordinate: () => 120`；`barSpacing: 6`（`timeScale().options()`）
- 已加载K线时间：1716256800（10:00）、1716257100（10:05），5m 步长 300s
