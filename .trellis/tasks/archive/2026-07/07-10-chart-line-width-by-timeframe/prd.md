# 图表画线粗细按周期自适应

## Goal

画线（水平线 / 线段）的粗细按当前 chart 的 `timeframe` 自适应：小周期线细，大周期保持当前观感，解决大周期画出的线在切到小周期时视觉上太粗的问题。同时修正画线选中态：点击图表空白处后，已选中的画线应取消选中。

## Background

- 画线通过 SVG overlay 渲染在 lightweight-charts 上方（`src/ui/App.tsx`）。
- 当前线宽硬编码：未选中 `2px`，选中 `3px`（`src/ui/App.tsx:1101`）。
- 当前拖拽手柄半径硬编码为 `5px`（`src/ui/App.tsx:1109`、`src/ui/App.tsx:1118`、`src/ui/App.tsx:1119`）。
- 当前 overlay 空白点击在未启用画线工具时直接返回，不会清空 `selectedDrawingId`（`src/ui/App.tsx:687`、`src/ui/App.tsx:996`）。
- 画线本身的点击会 `stopPropagation`，可避免点击画线时触发 overlay 空白点击清空选中态（`src/ui/App.tsx:1108`、`src/ui/App.tsx:1117`）。
- `timeframe` 参数已传入 `DrawingShape`，但目前只用于时间吸附，未用于视觉控制（`src/ui/App.tsx:1100`、`src/ui/App.tsx:1113`）。
- 代码中支持的 `ReviewTimeframe` 为 `5m | 15m | 1H | 4H | 1D | 1W | 1M`（`src/domain/trade.ts:25`）。
- 画线按 instrument 拉取全量，不做 timeframe 过滤；本任务保持此行为。

## Requirements

1. 线宽 `strokeWidth` 按当前 chart 的 `timeframe` 分档映射。
2. 选中态拖拽手柄 `circle r` 跟随线宽分档缩放。
3. 线宽变化只影响 SVG 画线表现，不改画线的存储、拉取、创建、拖拽、时间吸附逻辑。
4. Trade Review 和 Free Replay 两个模式都应通过同一个 `DrawingShape` 行为生效。
5. 当没有启用画线工具时，点击图表 overlay 空白区域应取消当前画线选中态。
6. 点击画线本身、拖动画线、拖动手柄时不应取消选中态。

## Line Width Mapping

| timeframe | 未选中 strokeWidth | 选中 strokeWidth | 手柄 r |
|-----------|-------------------|------------------|--------|
| `5m`, `15m` | 1 | 2 | 4 |
| `1H`, `4H` | 1.5 | 2.5 | 5 |
| `1D`, `1W`, `1M` | 2 | 3 | 5 |

## Acceptance Criteria

- [ ] 在 `5m` / `15m` 周期，未选中线宽为 `1px`，选中线宽为 `2px`，手柄半径为 `4px`。
- [ ] 在 `1H` / `4H` 周期，未选中线宽为 `1.5px`，选中线宽为 `2.5px`，手柄半径为 `5px`。
- [ ] 在 `1D` / `1W` / `1M` 周期，未选中线宽为 `2px`，选中线宽为 `3px`，手柄半径为 `5px`，保持当前大周期观感。
- [ ] 切换 timeframe 时，已有画线和 draft 画线的粗细随当前 chart 周期更新。
- [ ] 画完一条线后，该线保持选中；随后点击图表空白处，该线变为未选中，删除按钮随之禁用。
- [ ] 点击已有画线时，该线变为选中；点击另一条线时，选中态切换到另一条线。
- [ ] 点击或拖动画线本身、拖动端点手柄时，不会因为 overlay 空白点击逻辑而立即取消选中。
- [ ] Trade Review 和 Free Replay 两个模式均生效。
- [ ] 不引入画线按 timeframe 过滤；旧画线仍可在同一 instrument 的不同周期中显示。

## Out of Scope

- 画线按 timeframe 过滤。
- 线色动态化。
- 画线透明度调整。
- 新增或修改 timeframe 选项。

## Product Decisions

- `1M` 归入 `1D` / `1W` 同一大周期档。
- 大周期（`1D` / `1W` / `1M`）线宽保持当前 `2px` / `3px`，只降低小周期和中周期视觉重量。
- 手柄半径采用 `4px` / `5px` / `5px`，避免让大周期选中态比当前更重。
