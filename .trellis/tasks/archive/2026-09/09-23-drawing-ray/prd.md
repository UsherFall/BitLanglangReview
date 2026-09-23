# 画线线段改为射线

## Goal

把画线工具里的「线段」替换为「射线」：落两点后，从首点出发沿第二点方向无限延伸，用于把趋势投射到 K 线右侧的未来区间，而不是画完就停的短线段。

## Background / Confirmed Facts

- 画线工具枚举只有两种：`src/domain/drawing.ts:3` — `ChartDrawingKind = 'horizontal' | 'segment'`。
- 数据模型是「绝对时间(秒) + 绝对价格」，与像素无关（`src/domain/drawing.ts:5-23`）。`horizontal` 用 1 点，`segment` 用 2 点。
- 画线是叠在图表上的 SVG overlay，不是 canvas primitive（`TradeMarkerPrimitive` 只负责开平仓圆点，与本需求无关）。
- 工具栏在两个面板各有一份同构实现：`FreeReplayChart` 的 `App.tsx:1524-1532`、`TradeChart` 的 `App.tsx:2020-2031`。线段按钮位于 `App.tsx:1526` 与 `App.tsx:2022`，`title="线段"`，图标 `Slash`。
- 渲染入口是共用的 `DrawingShape`（`App.tsx:2083-2106`）：`horizontal` 用 `x1="0" x2="100%"` 画全宽水平线；`segment` 把两点经 `pointToScreen`（`App.tsx:2173-2177`）换算成屏幕坐标后画 `<line>`。
- overlay 是铺满 `.chart-wrap` 的根 `<svg>`（`src/ui/styles.css:1190-1197`），`.chart-wrap` 带 `overflow: hidden`（`src/ui/styles.css:885-891`），因此超出视口的内容会被裁剪。
- 跨周期语义：已保存的点在渲染时用 `timeframeTimeForPoint`（`src/ui/chart-time.ts:12`）把时间投影到当前周期包含它的那根 K 线，价格不变，所以线的屏幕斜率会随周期/缩放变化。
- 草稿预览的 shape 硬编码为 `kind: 'segment'`（`App.tsx:2078`）。
- 存储层无需改动：`chart_drawings.kind` 是自由 text 列，点存于 `points_json`（`src/server/drawing-store.ts`）。
- 存量数据实测（只读查询 `data/review.sqlite`）：`horizontal` 70 条、`segment` 1 条。
- 全仓库无任何 ray / 射线 / 延伸 / extend 的既有实现，属从零新增。

## Requirements

- **R1** 工具栏的「线段」按钮替换为「射线」按钮（更新标题与图标），不再能新建 `segment`；两个面板都要改（`App.tsx:1526`、`App.tsx:2022`）。
- **R2** 射线为两点式：`points[0]` 是端点（固定不动），`points[1]` 是方向点；线从端点沿「端点 → 方向点」方向无限延伸。
- **R3** 射线在 `FreeReplayChart` 与 `TradeChart` 两个面板都可用且行为一致。
- **R4** 草稿预览必须按射线形态渲染：落第一点后跟随鼠标的预览要已经是射线，否则预览与实际结果不一致。
- **R5** 落点、草稿、拖拽全部复用现有磁吸机制 `snapDrawingPoint`（`src/ui/drawing-snap.ts:48`）与 `moveDrawing`（`App.tsx:2143`），不新增吸附或平移逻辑。
- **R6** 历史 `segment` 画线保持可用：刷新后仍正常渲染，且可选中、拖动、删除。

## Acceptance Criteria

- [ ] 工具栏出现「射线」按钮、不再有「线段」按钮，两个面板都有。（R1、R3）
- [ ] 选射线后点两下可画出线：第一点是端点，线从该点沿第二点方向延伸到视口边缘，不溢出图表区域。（R2）
- [ ] 落第一点后移动鼠标，预览即为射线形态（不是线段）。（R4）
- [ ] 选中的射线可整体拖动平移；拖首点改变端点位置；拖方向点改变射线方向。（R5、R2）
- [ ] 切磁吸三态（off/weak/strong）时，射线的落点与拖拽同样遵循吸附规则。（R5）
- [ ] 切换周期、平移、缩放时射线跟随重绘，端点仍是原来的价格/时间。（R2）
- [ ] 此前已保存的 `segment` 画线刷新后仍照常显示，可选中、拖动、删除。（R6）
- [ ] 删除按钮对选中的射线有效；Escape 取消选中行为不变。（R1）
- [ ] 两次点击落在同一点（方向向量为零）时不产生异常渲染或报错。（R2）

## Key Decisions

- **替换而非并存**：用户明确表示不想要线段工具，工具栏只保留「射线」。
- **延伸方向 = 沿「首点 → 第二点」**：标准射线语义。趋势线通常从左往右画，实际效果即向右延伸到未来；若倒着画则向左延伸。
- **不迁移历史 segment 数据**：那 1 条存量线段可能是有意标注某一段区间的，静默改成无限延伸会破坏其语义；收益仅是手动删 1 条记录。代价是历史线段保持「有限」形态。
- **类型成员 `'segment'` 保留、只移除工具按钮**：删掉联合成员会让存量记录无法渲染（见 R6）。
- **不做精确矩形求交，采用「大常量外推 + SVG 裁剪」**：详见 `design.md` 的「权衡」，可避免引入 overlay 尺寸 props / `ResizeObserver` 并波及其它测试文件的共用 chart mock。

## Out of Scope

- 双向无限延伸的「直线 / 延长线」工具。
- 历史 `segment` 数据到 `ray` 的批量迁移。
- 射线在未加载 K 线区间（数据缺口）的特殊处理，沿用现有时间投影行为。
- 让射线斜率的屏幕角度在跨周期时保持固定。
