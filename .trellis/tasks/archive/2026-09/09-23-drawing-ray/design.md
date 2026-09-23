# 射线画线工具 — 技术设计

## 架构与边界

保持不变：画线仍是叠在图表上的 SVG overlay，不引入 canvas primitive，不动服务端存储与路由。
改动集中在四类文件：domain 类型、`App.tsx`（两个面板 + 共用渲染函数）、测试、`.trellis/spec` 契约文档。

## 数据与契约

- `ChartDrawingKind` 增加 `'ray'`（`src/domain/drawing.ts:3`）→ `'horizontal' | 'segment' | 'ray'`。
- **必须保留 `'segment'` 成员**。存量数据里有 segment 记录（`data/review.sqlite` 的 `chart_drawings`，只读统计：horizontal 70 / segment 1）。删掉联合成员会让 `DrawingShape` 无法渲染这条已存在的记录。做法是「移除工具按钮，保留类型成员与渲染分支」。
- points 语义不变：`ray` 用 2 点，`points[0]` = 端点（固定不动），`points[1]` = 方向点（决定方向）。
- 存储层零改动（`src/server/drawing-store.ts`）：`kind` 是普通 text 列，点走 `points_json`，无需迁移。
- 不做历史数据迁移：那条 segment 保持「有限线段」语义。理由见「权衡」。

## 交互

- 复用 segment 的两点流程，不新增交互概念：
  - `handleOverlayClick`（`App.tsx:1448` / `App.tsx:1954`）里把 `segment` 分支放宽为 `segment | ray`，只有写进 `saveDrawing` 的 kind 字面量不同。
  - 草稿预览判断（`App.tsx:1488` / `App.tsx:1994`）：`drawingTool === 'segment'` → `drawingTool === 'segment' || drawingTool === 'ray'`。
- 磁吸复用 `snapDrawingPoint`（`src/ui/drawing-snap.ts:48`），无需改动。
- 拖拽复用 `moveDrawing`（`App.tsx:2143`）：ray 同为 2 点，自然落入默认分支 —— body 整体平移、`start` 改端点、`end` 改方向点，语义正好正确，无需新增分支。

## 渲染（核心）

### 草稿 kind 修正

`DrawingOverlay`（`App.tsx:2060-2081`）目前把草稿 shape 硬编码为 `kind: 'segment'`（`App.tsx:2078`）。必须新增 prop（如 `draftKind`）把当前工具 kind 传进去，否则射线预览仍画成线段 —— 这是最容易漏的一处。

### 新增 ray 分支

`DrawingShape`（`App.tsx:2083`）在现有两点坐标换算之后（`App.tsx:2097`，已保存的走 `timeframeTimeForPoint` 投影、draft 用原始点）加 ray 分支：

1. 方向向量 `d = p1 - p0`。
2. 终点 `p0 + normalize(d) * RAY_LENGTH`。
3. 退化保护：`d` 长度为 0（两次点击落在同一点）时不画或退化成不加长，避免 `normalize` 除零。

`RAY_LENGTH` 取足够大的常量（约 20000px），**不做精确矩形求交**：

- overlay 是铺满 `.chart-wrap` 的根 `<svg>`（`src/ui/styles.css:1190-1197`），根 SVG 元素默认裁剪到自身视口；`.chart-wrap` 另有 `overflow: hidden`（`src/ui/styles.css:885-891`）。超出部分会被裁掉，视觉结果正好止于视口边缘。
- 精确求交需要 overlay 的宽高，要么加 props + `ResizeObserver`，要么用 `chart.timeScale().width()` / `paneSize()`。而现有测试的 chart mock（如 `tests/app-drawings.test.tsx:12-37`）没有这两项，精确求交会波及多个测试文件的共用 mock，收益不抵成本。

其它细节：

- 手柄保留两个：端点 `target='start'`、方向点 `target='end'`。语义从「两个端点」变为「端点 + 角度控制点」，UI 元素不变。
- 与既有 `horizontal` 保持一致：horizontal 用 `x1="0" x2="100%"` 横穿整个 overlay（含右侧价格轴区域），射线同样延伸到 overlay 边界。

## 兼容性

- 旧 `segment` 渲染分支保留，存量数据不丢、仍可选中/拖拽/删除。
- `SaveChartDrawingInput` 与服务端路由（`src/server/app-plugin.ts:182-202`）不改，无 schema 迁移。
- 工具栏是「替换」而非「新增」按钮，`tests/app-drawings.test.tsx:69` 与 `tests/app-drawing-snap.test.tsx:72` 里按 `toolbarButtons[1]` 取线段按钮的下标不会位移，但这两处测试的断言内容需要更新（kind 与预览坐标）。

## 权衡

- **大常量外推 + SVG 裁剪** vs 精确求交：选前者。省掉尺寸 props / `ResizeObserver` / mock 改动，代价是 DOM 里的 `x2`/`y2` 是一个很大的数，测试只能断言方向与量级而非精确交点。
- **不做历史 segment → ray 迁移**：那条存量线段可能是有意标注某一段区间的，静默改成无限延伸会破坏已有标注语义。收益仅是删除 1 条记录即可解决。
- **跨周期角度会变**：x 轴时间尺度随周期变化，射线斜率随之改变。这是既有 segment 的行为，也与 TradingView 一致，保持现状。

## 验证

- 定向运行：`npx vitest run tests/app-drawings.test.tsx tests/app-drawing-snap.test.tsx tests/drawing-store.test.ts`
- 类型检查：`npx tsc --noEmit`

## 风险与回滚

- 主要风险：`FreeReplayChart` 与 `TradeChart` 两份同构画线代码只改了一处。
- 次风险：草稿 kind 未传导致预览仍是线段。
- 回滚：改动为「新增 kind 成员 + 新增渲染分支 + 替换按钮」，单次 `git revert` 即可完整回退。
