# klinecharts 磁吸（magnet）实现考证

来源：<https://github.com/klinecharts/KLineChart>（Apache-2.0），2026-09-20 取 `main` 分支源码。
文档：<https://klinecharts.com/guide/overlay>（"点位与吸附模式" 一节）。

## 配置面

`src/component/Overlay.ts`：

- `export type OverlayMode = 'normal' | 'weak_magnet' | 'strong_magnet'`（:29）
- `mode: OverlayMode = 'normal'`（:258）、`modeSensitivity = 8`（:259），注释："When mode is weak_magnet is the response distance"（:181-183）→ 单位是**像素**。
- 内置画线（`src/extension/overlay/segment.ts` 等）只设 `totalStep`，**不设** `mode` → 内置画线默认 `normal`，即不吸附，要用户显式开。

## 算法（`src/view/OverlayView.ts::_coordinateToPoint`，:387-459）

x 维度：

- 步进式绘制（非自由手绘）时无条件按 `xAxis.convertFromPixel(x)` 取 `dataIndex`，即**指针一定归属到某根 K 线柱**（:398-403）。
- 自由手绘（brush）走 `coordinateToFloatIndex` 保留子柱精度（本项目无此模式，不涉及）。

y 维度：仅当 `mode !== 'normal'` 且当前是主图（`paneId === CANDLE`）且已拿到 `dataIndex`（:411-414）：

```
kLineData = getDataByDataIndex(dataIndex)          // 该根 K 线的 o/h/l/c
if (value > kLineData.high) {
    if (weak)  只有 |指针y - high的y| <= modeSensitivity 才 value = high
    else       value = high                        // strong 无条件
} else if (value < kLineData.low) {
    if (weak)  只有 |指针y - low的y| <= modeSensitivity 才 value = low
    else       value = low
} else {                                            // 落在 [low, high] 内
    max = max(open, close); min = min(open, close)
    value > max → 取 max 与 high 中更近的
    value < min → 取 min 与 low 中更近的
    else        → 取 max 与 min 中更近的               // 即 open/close 里更近的那个
}
```

要点：

1. 区间外才有阈值（weak），区间内**无条件**吸到最近的一个候选 → 弱吸附在最常见的"指针落在 K 线实体附近"场景下几乎总是生效。
2. 候选集合就是 `{open, high, low, close}` 四个价位，按**像素距离**取最近。
3. 阈值比较用像素（`yAxis.convertToPixel` 换算后再比较），不是价格差。
4. 拖拽已有点（`pressedMouseMoveEvent` → `figureType === 'point'`）与平移（`figureType !== 'point'`）都走同一个 `_coordinateToPoint`，也就是 klinecharts 的**平移也会被吸附**。

## 与本项目相关的差异（需自行决策，不要照搬第 4 点）

本项目的平移实现是"用 currentPoint - startPoint 的增量去平移所有点"（`App.tsx::moveDrawing` 的 `'body'` 分支）。若平移也吸，增量会被量化到 K 线柱/OHLC 上，整条线会按台阶跳且横向几乎无法连续移动。故本项目只对落点与端点拖拽吸附，平移用未吸附的原始指针点计算增量。
