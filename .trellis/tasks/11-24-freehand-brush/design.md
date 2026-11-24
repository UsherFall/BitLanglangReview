# 新增自由画笔 — 技术设计

## 1. 架构与边界

画笔是现有 Chart Drawing 的一种新 kind，不引入新的图层、存储表或 API。

| 层 / 文件 | 改动 |
| --- | --- |
| `src/domain/drawing.ts` | `ChartDrawingKind` 增加 `'brush'`，记录多点原始时间/价格语义。 |
| `src/ui/chart-drawing.tsx` | 增加工具栏按钮、brush 草稿状态、pointer 手势、polyline 渲染及整体拖动复用。 |
| `src/server/drawing-store.ts` / `src/server/chart-routes.ts` | **生产代码不改**；现有点数组 JSON 与 kind 文本已兼容。 |
| `src/domain/level-alert.ts` / `src/server/coin-scan-service.ts` | **生产代码不改**；现有白名单只接受 horizontal/ray，自然排除 brush。 |
| 测试与 `.trellis/spec` | 增加画笔交互、持久化、跨周期和扫描排除覆盖；完成后同步契约文档。 |

所有可绘制消费者通过 `useChartDrawings` 自动获得画笔；只读图表维持 `enabled: false`，不会出现按钮。

## 2. 数据契约与数据流

### Kind 与点语义

```ts
type ChartDrawingKind = 'horizontal' | 'segment' | 'ray' | 'brush';
```

- `brush.points` 是一次连续手势产生的有序多点数组；新建有效轨迹至少两个点。
- 每个点继续使用 `{ time: seconds, price: number }`，与 lightweight-charts 边界单位一致。
- brush 的时间点保留 pointer 原始位置，**不归整到包含它的 Candlestick**。这是保持同一 Candlestick 内多个 x 坐标不塌陷的必要条件。
- `tradeId`、`instrument`、`board`、`timeframe`、`createdAt` 等公共元数据沿用现有保存路径。`refPrice/refTime` 可随公共 helper 写入，但 brush 不进入扫描换算。

### 创建与恢复

```text
选择画笔
  → pointerdown 捕获原始点
  → pointermove 追加有序原始点并显示草稿
  → pointerup 完成草稿、退出画笔
  → POST /api/drawings { kind: 'brush', points, instrument, board, timeframe, ... }
  → DrawingStore 将 points 完整写入 points_json
  → 响应对象替换/追加到 hook state 并选中
  → 重新加载时按 Instrument + board 取回同一有序点数组
  → polyline 按原始 time/price 重投影到当前图表
```

无移动的简单点击不创建空 brush。保存失败处理不另建体系，维持现有画线保存方式。

## 3. Pointer 手势与状态

### 状态分工

遵循 hook 规范：可变的集成交互状态放 ref，JSX 可见草稿放 state。

- `brushDraftRef`： `{ pointerId, points } | null`，事件执行时的最新手势事实，避免快速 move/up 读到旧闭包。
- `brushDraftPoints`：用于渲染草稿的 `ChartPoint[]`。
- `suppressBrushClickRef`：完成 pointer 手势后抑制紧随其后的一次 click，防止重复创建或误选旧图形。
- 现有 `dragRef` 继续只负责已保存图形拖动；brush 草稿手势优先于 drag 分支处理，两者不得同时提交。

### 事件顺序

1. **overlay pointerdown capture**
   - 仅当 `drawingTool === 'brush'` 时拦截；其他工具保持现状。
   - 在 capture 阶段处理，避免起点落在已有 shape 上时进入旧图形拖动。
   - `pointFromPointer(..., null)` 读取 raw point，磁吸模式不得影响 brush。
   - `preventDefault()`、必要的传播阻止、清空选择、记录 pointerId/首点，并在 overlay 上 `setPointerCapture(pointerId)`。
2. **overlay pointermove**
   - 若存在匹配 pointerId 的 brush 草稿，追加 raw point 并更新草稿，随后 return。
   - 仅忽略 time 与 price 都完全相同的重复点；不能按 time 去重，否则同一时刻的垂直轨迹会丢失。
   - 无 brush 草稿时，现有 ray 预览和 saved drawing drag 逻辑不变。
3. **overlay pointerup**
   - 若存在匹配 brush 草稿，追加最后的有效点，释放 capture。
   - 至少两个点时调用一次 `saveDrawing({ kind: 'brush', ... })`；随后清空 ref/state、`setDrawingTool(null)`，设置一次性 click 抑制标记。
   - 非 brush 的现有 drag-up 保存路径不变。
4. **overlay click capture**
   - 仅消费 brush 手势后的那一次 click：阻止传播并清标记。
   - 其余 click 继续进入水平线/射线创建或空白取消选择。
5. **pointercancel / 切换工具 / Instrument、board 或 enabled 变化**
   - 未提交 brush 草稿直接丢弃，不 POST，清除 click 抑制标记。
   - pointercancel 对既有 saved drawing drag 的既有处理不变，避免顺手改变旧行为。

pointerId 必须匹配，避免第二指或其他 pointer 结束当前草稿。pointer capture 保证移出 overlay 后仍能完成或取消同一笔。

## 4. SVG 渲染与编辑

### 草稿与已保存 brush

- 草稿使用当前两点草稿之外的 brush 点数组；可由 `DrawingOverlay` 统一构造一个 `id='draft'` 的 drawing，但 brush 使用完整 `brushDraftPoints`，不是 `[start, end]`。
- 使用 `<polyline className="drawing-shape">`，`fill="none"`，圆角 linecap/linejoin，颜色与线宽复用 `drawingStyleForTimeframe` 和 selected 规则。
- 已保存图形的坐标映射按 kind 分离：
  - horizontal/segment/ray：保持 `timeframeTimeForPoint` 旧行为。
  - brush：草稿和已保存都直接把原始点传给 `pointToScreen`。
- `pointToScreen` 继续走 `coordinateForTime`，保留加载窗口外推与数据空洞插值能力；这与 Candlestick 时间归整是两件事。

### 选中、拖动、删除

- polyline 的 click/pointerdown 复用 `onSelect` 和 `handleDrawingPointerDown(..., 'body')`。
- brush 选中时不渲染 `circle.drawing-handle`，因此没有逐点编辑入口。
- `moveDrawing` 的 body 分支已对全部点应用相同 time/price delta；保持该通用实现，所有轨迹点同步平移。
- 删除继续调用现有 `deleteSelectedDrawing`，不新增 API。

## 5. 兼容、扫描与性能

- 旧 horizontal/ray/segment 数据与交互不改；工具按钮插入在射线之后，保持现有测试的水平线下标 0、射线下标 1。
- brush 用 polyline，避免污染现有 `line.drawing-shape` 断言。
- SQLite 无 DDL、无历史迁移；旧版本不认识 brush 不属于前向兼容目标。
- `linesFromDrawings` 继续只接收 horizontal/ray；`loadLinesByTimeframe` 对 brush 不建立 bucket，所以 brush 不产生距线、`drawnLineCount` 或 watch 名单。仅以测试锁定，不扩展扫描算法。
- 首版不去重不同点、不做距离简化或压感。高频 move 以 ref 保证数据正确、state 更新草稿；真实长轨迹若卡顿，再把 rAF 节流/轨迹简化作为独立优化，避免首版改变形状。

## 6. 回滚与风险

- 主要风险集中在 `chart-drawing.tsx`：brush up 后 click 导致重复 POST、保存后时间归整导致变形、起点在旧 shape 上误拖、pointercancel 留草稿。
- 回滚可整体还原 domain + hook + 测试改动；不需要数据库回滚脚本。
- 已创建的 brush 数据不得因代码回滚自动删除。旧版本无法正确理解 brush，回滚前应备份 `data/review.sqlite`，并接受旧版本不展示/不能正确展示这些新标注。

## 7. 验证设计

- App 级 pointer 流程：原始多点、一次 POST、自动退出、click 不重复、无磁吸、polyline 草稿与保存形状。
- App 级兼容：同 Candlestick 内点不塌陷、跨周期保留、无 handle、整体移动和删除、取消/空手势。
- Store：brush 多点逐点 round-trip。
- Domain/Server：brush 不转 LevelLine；scan board 只有 brush 时 watch 无行、无 missing、无 Candlestick 请求；horizontal/ray 旧测试全绿。
- 真实浏览器手测 pointer capture、后续 click 和 CSS hit-testing，因为 jsdom 不能覆盖这些浏览器行为。
