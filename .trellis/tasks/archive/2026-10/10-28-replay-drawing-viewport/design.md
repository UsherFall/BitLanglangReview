# Design：复盘图表画线与步进体验修复

## R1 射线跨周期不可见 —— 根因与修法

### 根因链（已核实源码）

1. 切换周期时 `switchFreeReplayTimeframe` 把 `dataAnchorTime` 重置为当前 `progressTime`，初始加载窗口 = 锚点 ±150 根K线。5m ≈ ±12.5 小时，而 4H ≈ ±25 天 —— 大周期上画的射线锚点普遍落在 5m 已加载窗口之外。
2. `DrawingShape`（`src/ui/chart-drawing.tsx`）先经 `timeframeTimeForPoint` 把点时间重映射到目标周期网格，再 `chart.timeScale().timeToCoordinate(t)` 换算像素 x。
3. lightweight-charts 的 `timeToCoordinate` 内部走 `timeToIndex(time, false)`，**时间不在已加载数据索引中时返回 null**（`lightweight-charts.standalone.development.js` 的 `timeToCoordinate` 实现）。
4. `pointToScreen` 返回 null → `if (points.some((point) => !point)) return null;` → **整条线不渲染**。水平线只用 `priceToCoordinate`（线性/对数映射，不依赖数据范围）所以不受影响。

### 修法：渲染期坐标外推/内插（不额外拉数据）

在 `chart-drawing.tsx` 中把 x 换算抽成可单测的导出函数：

```ts
coordinateForTime(time, { chart, timeframe, candles }): number | null
```

- `chart.timeScale().timeToCoordinate(time)` 有值 → 直接用（现状路径，零行为变化）
- 无值且 `candles` 为空 → null（维持隐藏，等数据加载后重渲染）
- 无值且点在首末已加载K线之间（数据缺口）→ 相邻两根K线坐标线性内插：
  `x = xPrev + (t - tPrev)/(tNext - tPrev) * (xNext - xPrev)` —— 对任意缺口结构精确
- 无值且点在范围外 → 以最近的边界K线为基准按网格外推：
  `x = xEdge ± (|edgeTime - t| / step) * barSpacing`，其中 `step = timeframeMs(timeframe)/1000`，`barSpacing = chart.timeScale().options().barSpacing`

`pointToScreen` 增加 `timeframe`、`candles` 参数（`DrawingShape` 两者都有），draft 路径与已保存路径共用。

### 精度与取舍

- 网格外推假设K线网格连续（缺失K线按占位槽计）。5m/15m/1H/4H 上交易所数据基本连续；即使有缺失，误差也只是几根 bar 的水平偏移，而线的可见性优先。
- `timeframeTimeForPoint` 越界回退用默认 `shanghai` 网格 floor；对日内周期（5m/1H/4H）两网格逐槽一致，无误差。1D/1W/1M 之间互切时越界锚点可能有 8h（约 1/3 根日K）水平偏移 —— 可接受，不在本次范围内。
- 用户往左拖动触发历史补加载后，锚点进入数据索引，坐标自然回归精确（`timeToCoordinate` 路径接管），外推只是无数据时的兜底。

### 不采用数据侧方案的原因

「按画线锚点补拉历史K线」会把切周期的等待时间变成几十页分页请求（4H±25天 ≈ 7200 根 5m），且交互收益相同（锚点仍在视野外，把手一样够不着）。渲染期外推零网络成本、即时可见。

## R2 画完自动退出

`handleOverlayClick`（`chart-drawing.tsx`）两处保存点后补 `setDrawingTool(null)`：

- `horizontal`：一次点击 `saveDrawing` 后
- `ray`/`segment`：第二击 `saveDrawing` 后（草稿清理已有）

其余不动：`saveDrawing` 内 `setSelectedDrawingId(saved.id)` 保持（线保存后仍选中可拖）；`selectDrawingTool` 的点选切换/丢弃草稿逻辑保持；`handleDrawingPointerDown` 里 `setDrawingTool(null)`（拖线退出工具）保持。

## R3 步进不拉画面

### 根因

App.tsx `FreeReplayChart` 的 cursor follow effect（"scroll viewport to keep cursor 10 steps from right edge"）在**每次** `replay.cursorTime` 变化时无条件 `setVisibleRange({ from: cursor - span + 10*step, to: cursor + 10*step })`。

已核实（lightweight-charts `_internal_updateTimeScale`）：步进时 `series.setData(...)` 因空白补白恒定（`chartDataWithWhitespace` 固定 padCount=200，首末索引不变）不会移动视口——`setData` 不是罪魁，cursor follow effect 是唯一拽画面的代码。

### 修法：舒适区判定

同一个 effect 改为条件触发（`pad = 10 * step`，`span = visible.to - visible.from`）：

```ts
const visible = currentFreeReplayVisibleRange(chart);
if (!visible) return;
if (cursor + pad <= visible.to && cursor - pad >= visible.from) return; // 视野内 —— 不动
suppressAutoLoadRef.current = true;
if (cursor + pad > visible.to) {
  // 前进越界：维持现有不变量（光标距右缘 10 根）
  chart.timeScale().setVisibleRange({ from: cursor - span + pad, to: cursor + pad });
} else {
  // 后退越界：对称，光标距左缘 10 根
  chart.timeScale().setVisibleRange({ from: cursor - pad, to: cursor - pad + span });
}
// setTimeout 恢复 suppressAutoLoadRef（沿用现有模式，避免触发左滑自动补载）
```

边界稳定性：重锚定后 `cursor ± pad` 恰好等于边缘值，`<=`/`>=` 判定不再触发 —— 单次步进最多平移 1 根，不会抖动。切换周期时的 `cursorFollowRangeKeyRef` 首跳跳过、初始锚定 effect（`initializedRangeKeyRef`）均不动。

## 测试策略

- `tests/app-drawings.test.tsx`（App 级，现成 mock）：
  - 越界射线可见性：mock 的 `timeToCoordinate` 改为对未加载时间返回 null；预置一条锚点早于已加载K线的射线，断言线渲染且 x1 = 首K线x − 槽数 × barSpacing（mock 里 1px=1s、barSpacing=6，可精确断言）
  - R2：水平线一次点击保存后工具按钮 `selected` 消失；射线第二击后同样消失
- `chart-drawing.tsx` 导出 `coordinateForTime` 后可另加纯函数单测（mock chart/series 即可，不必拉 App）
- `tests/app-free-replay.test.tsx`（或其所在 suite）：步进时光标在视野中部 → `setVisibleRange` 不被调用；光标越过右缘 → 仅一次最小平移调用。注意现有 suite 对 `setVisibleRange` 的既有断言可能需要随新行为调整。

## 风险

- App 级 mock 改 `timeToCoordinate` 返回 null 可能使既有用例（依赖 `time - 1716256800` 恒返回坐标）走到外推路径 —— 既有用例的锚点都在已加载范围内（10:00/10:05），`timeToCoordinate` 仍返回坐标，不受影响。
- R3 改动若与 `historyBackfill` effect 交叠（视野离光标远时左滑补载），`suppressAutoLoadRef` 模式已覆盖；补载引起的数据索引前置变化不影响视口（右缘锚定）。
