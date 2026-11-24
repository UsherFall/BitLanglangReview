# 新增自由画笔

## Goal

在现有 Chart Drawing 工具中新增“画笔”，让复盘者能通过一次连续按下、移动、释放的指针手势绘制任意轨迹，并在之后重新查看、整体移动或删除该标注。

## Background

现有水平线和射线只能表达少量锚点构成的规则图形，不能记录自由涂画。画笔需要提供自由形状，同时保持 Chart Drawing 的 Instrument 级持久化与 board 隔离语义。

### Confirmed Facts

- `ChartDrawingKind` 当前为 `horizontal | segment | ray`（`src/domain/drawing.ts:9`），工具栏实际提供水平线与射线。
- 画线交互、SVG 渲染、拖动和保存共用 `useChartDrawings`（`src/ui/chart-drawing.tsx:134`），覆盖复盘、自由回放及可绘制的选品抽屉。
- Chart Drawing 是 Instrument 级、按 board 隔离并跨周期显示的持久化标注，不是临时涂鸦（`CONTEXT.md` 的 Chart Drawing 定义；`src/ui/chart-drawing.tsx:157-196`）。
- 存储层将完整点数组序列化为 `points_json`，kind 为普通文本（`src/server/drawing-store.ts:42-89`），因此新增多点类型不需要数据库迁移。
- 现有已保存两点图形会把点时间归入当前周期 Candlestick（`src/ui/chart-drawing.tsx:410`）。直接套用到密集轨迹会让同一 Candlestick 内的多个点共享 x 坐标，破坏自由形状。
- 选品距线只转换水平线与射线（`src/domain/level-alert.ts:186-218`），`loadLinesByTimeframe` 会丢弃其他类型（`src/server/coin-scan-service.ts:571-590`）。
- 现有工具遵循“一次激活完成一个对象后自动退出”（`src/ui/chart-drawing.tsx:236-241`）。

## Requirements

- **R1 工具入口**：在所有现有可绘制图表的画线工具栏提供“画笔”；只读图表不新增入口。
- **R2 自由轨迹**：一次连续按下、移动、释放产生一个由有序多点组成的 brush 对象；轨迹使用原始时间/价格点，不受磁吸影响，不能只保留首尾点。
- **R3 单次激活**：每次激活只绘制一笔，释放后自动退出画笔并提交一次保存；后续 click 不得重复创建。再次绘制需要重新激活。无移动的简单点击不创建空对象，取消的手势不保存。
- **R4 持久化与跨周期**：画笔通过现有 `/api/drawings` 和 SQLite 保存，沿用 Instrument、board、timeframe 等公共元数据；刷新、重新加载及切换周期后仍按原始有序点渲染，不做 Candlestick 时间归整。
- **R5 既有编辑能力**：画笔可选中、整体拖动和删除；拖动时所有点保持相对形状。沿用现有配色与按周期线宽，选中不高亮逐点控制手柄。
- **R6 扫描排除**：画笔只作图上标注，即使在选品抽屉绘制，也不参与距线、画线计数或标线监控名单。
- **R7 旧行为兼容**：现有水平线、射线、旧 segment 数据、磁吸和 board 隔离行为不变。

## Out of Scope

- 连续多笔模式；一笔完成后仍保持画笔激活。
- 颜色、粗细等样式设置及对应持久化字段。
- 逐点编辑、局部擦除、压感或轨迹简化编辑器。
- 将自由轨迹换算为距线价位，或让画笔参与标线监控。
- 新的保存失败提示体系；沿用当前画线保存行为。

## Acceptance Criteria

- **AC1（R1/R2）**：选择画笔后，通过 pointerdown → 多次 pointermove → pointerup 能看到连续草稿，并保存为一个 `kind='brush'`、包含 3 个或更多有序点的对象，而不是首尾直线。
- **AC2（R2/R4）**：默认弱磁吸下，保存点仍保留原始 time/price；同一 Candlestick 内的多个点保持不同 x。刷新或切换周期后轨迹点不丢失、不被 Candlestick 时间归整压扁。
- **AC3（R3）**：一笔手势只 POST 一次，释放后画笔退出；随之而来的 click 不重复 POST。无移动点击、pointercancel 和切换工具均不保存或残留草稿。
- **AC4（R4）**：brush 经真实 Store save/list 后逐点一致，并继续遵守 Instrument canonical 匹配、board 隔离和跨周期加载规则。
- **AC5（R5）**：已保存 brush 可选中、整体拖动和删除；拖动对所有点应用相同 delta，无首尾控制点，样式与现有画线一致。
- **AC6（R6）**：brush 不生成 `LevelLine`；scan board 仅有 brush 的 Instrument 不进入标线监控、没有距线或画线计数，也不触发距线 Candlestick 请求。已有水平线和射线结果不变。
- **AC7（R7）**：现有画线、磁吸、路由和扫描回归测试保持通过。
- **AC8**：定向测试、`npm test`、`npx tsc --noEmit` 和 `git diff --check` 通过；真实浏览器验证 pointer capture、后续 click 和图表拖动。

## Risks / Deferred Items

- 画笔仍以时间/价格为锚，因此图表缩放或周期变化会按坐标轴改变视觉比例；不改成固定屏幕像素涂鸦。
- 首版只忽略完全重复点，不做距离简化。若真实长轨迹出现性能问题，再单独评估 requestAnimationFrame 节流或轨迹简化。
