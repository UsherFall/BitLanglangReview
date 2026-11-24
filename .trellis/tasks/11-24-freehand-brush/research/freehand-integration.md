# 自由画笔集成研究

## 结论

在现有 `useChartDrawings` 内新增 `brush` 类型即可覆盖所有可绘制图表，不需要新增图表 primitive、数据库表、API 路由或扫描计算。核心不是存储，而是两点：

1. 自由轨迹必须保存并渲染原始、有序的 `ChartPoint[]`，不能套用现有两点图形的 Candlestick 时间归整。
2. 画笔的 pointer 手势必须与现有 click 创建流程、已有图形拖动手势隔离，确保一次手势只保存一个对象。

## 现有集成路径

- 类型：`src/domain/drawing.ts:9` 的 `ChartDrawingKind` 当前为 `horizontal | segment | ray`。
- 唯一交互与渲染入口：`src/ui/chart-drawing.tsx:134` 的 `useChartDrawings`。复盘、自由回放、选品画线抽屉共用此 hook；只读的其他币面板不会获得工具栏。
- 保存：hook 的 `saveDrawing` POST `/api/drawings`；`src/server/chart-routes.ts:66-102` 只额外校验 `board`，不限制 kind 或点数。
- 存储：`src/server/drawing-store.ts:42-89` 将 kind 写入普通文本列，将完整点数组写入 `points_json`。因此 `brush` 与多点轨迹不需要 DDL 或迁移。
- 可见性：按 Instrument canonical + board 加载，跨周期不按 timeframe 过滤；画笔应自然继承。
- 扫描：`src/domain/level-alert.ts:186-218` 仅把 horizontal/ray 转为 `LevelLine`；`src/server/coin-scan-service.ts:571-590` 对不能转换的 drawing 不建立 instrument bucket。因此 brush 不参与距线，也不会仅凭 brush 进入标线监控，无需改扫描生产代码。

## 坐标与渲染约束

### 不能复用两点图形的时间归整

`src/ui/chart-drawing.tsx:410` 对已保存图形执行：

```ts
timeframeTimeForPoint(point.time, timeframe, candles)
```

水平线/射线借此在跨周期时落到包含锚点的 Candlestick。画笔若沿用，同一 Candlestick 内大量轨迹点会获得相同 x，自由形状会被压扁或改变。`brush` 必须在草稿和已保存两种状态下都绕过这一步，直接使用原始秒级时间和价格。

`coordinateForTime` 仍应复用：它负责 lightweight-charts 的直接坐标、加载窗口外推及数据空洞插值，不等于 Candlestick 时间归整。画笔仍是时间/价格锚定的 Chart Drawing，不是固定屏幕像素的临时涂鸦。

### SVG 形状

- 使用 `<polyline>` 或等价的非闭合 `<path>`，`fill="none"`、`strokeLinecap="round"`、`strokeLinejoin="round"`。
- 沿用 `drawingStyleForTimeframe`、普通蓝色和选中黄色；不新增样式字段。
- 选中 brush 时不渲染首尾 handle；点击/按下 polyline 仍走选中与 body 拖动。
- `moveDrawing(..., 'body', ...)` 已对所有点应用相同 time/price delta，可直接保持轨迹内部形状。不要让 brush 进入 start/end 单点编辑分支。

## Pointer 手势设计

现有水平线/射线由 `onClick` 创建，已有图形由 shape 的 `onPointerDown` + overlay move/up 拖动。brush 是第一种持续按压手势，建议独立为以下流程：

1. **pointerdown（仅 brush 激活时）**：在 overlay 捕获阶段拦截，避免起点落在已有 shape 上时误进入旧图形拖动。读取 raw point（snap 传 `null`），记录 pointerId 和点数组，设置 pointer capture，清空选择并显示草稿。
2. **pointermove**：只处理匹配 pointerId 的 brush 草稿；追加 raw point，忽略完全相同的重复点。用 ref 持有最新点数组，React state 只负责触发草稿渲染，避免快速事件读到旧闭包。
3. **pointerup**：追加最后一个有效点，释放 capture；至少两个有效点才 POST 一次 `kind: 'brush'`。清理草稿并立即退出工具，与现有一次激活一个对象的规则一致。
4. **后续 click**：浏览器通常会在 pointerup 后派发 click。必须通过一次性 click-capture 抑制或等价防护，确保它不会再进入现有 click 创建逻辑、清空新选择或选中起点的旧图形。
5. **pointercancel / 工具切换 / Instrument 或 board 切换**：丢弃未提交草稿，不 POST；清 ref、state 与一次性 click 防护，避免下一次点击被误吞。

磁吸只服务现有水平线/射线；brush 全程使用 raw point，即使磁吸处于弱/强模式也不改变轨迹。首版无需 coalesced events、压感、轨迹简化或逐点编辑。无移动的简单点击不保存空对象。

## 测试影响与高信号用例

### 现有测试兼容性

- `tests/app-drawings.test.tsx` 与 `tests/app-drawing-snap.test.tsx` 多处使用 `toolbarButtons[0]`（水平线）和 `[1]`（射线）。brush 按钮应放在射线之后，保持这两个下标不变；删除、磁吸应继续用 title/role 查询。
- 现有测试大量查询 `line.drawing-shape`。brush 使用 polyline 不会污染这些 line 数量断言。
- `app-drawing-snap` 已 stub pointer capture；若在 `app-drawings` 增加 brush 手势/拖动测试，也要 stub `setPointerCapture` / `releasePointerCapture`。
- jsdom 不模拟 CSS hit-testing，pointer capture 与后续 click 的真实浏览器顺序必须手测，不能只靠组件测试。

### 建议新增覆盖

1. **App 手势测试**：激活画笔 → pointerdown/move/move/up；断言草稿为 polyline、POST 恰好一次、kind 为 brush、保存 3+ 有序点、工具自动退出，后续 click 不重复保存。
2. **磁吸绕过**：在默认弱磁吸下，于同一 Candlestick 内取多个非 OHLC、非整 bar 点；断言 POST 保留 raw time/price，而不是被吸附或归整。
3. **已保存渲染与跨周期**：加载同一 Candlestick 内多个 brush 点，polyline 的 x 仍不同；切换 timeframe 后点数组不丢、不退化成首尾直线，且不重新请求 drawings。
4. **选中/拖动/删除**：brush 无 handle；body 拖动后每个点应用相同 delta，POST 保存更新；删除复用现有按钮。
5. **取消与空手势**：pointercancel、切换工具、无移动 click 均不产生 POST/残留草稿。
6. **存储**：`tests/drawing-store.test.ts` 增加 brush 多点 save/list round-trip，逐点 deep-equal。
7. **扫描排除**：`tests/level-alert.test.ts` 断言 brush 不转成 LevelLine；`tests/coin-scan-service.test.ts` 增加 scan board 只有 brush 时 `scanWatch` 无行、无 missingInstrument，且不发起距线 Candlestick 请求。现有 horizontal/ray 测试作为不变量。

## 风险与延后项

- 高频 pointermove 会触发 React 草稿渲染；首版采用最小实现并去除完全重复点。若真实长轨迹出现卡顿，再单独研究 requestAnimationFrame 节流或距离简化，不能在首版以牺牲形状为代价。
- 保存失败提示沿用当前画线行为，不在本任务扩展新的错误处理体系。
- 自由轨迹跨周期仍按时间轴缩放，视觉形状会随图表周期/缩放变化，这是时间/价格锚定标注的预期行为；不改成屏幕固定像素。
