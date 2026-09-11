# 技术设计 — 复盘/选币界面视觉与标注优化

## 范围与边界

- 只改前端 `src/ui`（组件 + `styles.css`）。不改 `src/domain` / `src/server`，无接口变更。
- 三处浮层（其他币 / 龙头 / 热度）当前是 `.workspace` 的绝对定位子元素，不参与 grid 布局；本次保持"绝对定位"这一前提，只换成"右上角锚定的 flex 纵列"。
- 热度视图 `MarketHeatView` 是浮窗与内嵌两处共用（见 `.trellis/spec/frontend/component-guidelines.md` 的 Market Heat Panel 契约）；两栏版式通过新增 `layout` prop 复用同一组件，避免两处 markup 分叉。

## 1. 右上角浮层堆叠（R1）

### 结构
`src/ui/App.tsx` 把三个可选浮层包进一个容器，仅在至少一个打开时渲染：

```tsx
{(otherCoinOpen || leaderCoinOpen || heatOpen) && (
  <div className="chart-float-stack">
    {otherCoinOpen && <OtherCoinChart ... />}
    {leaderCoinOpen && <LeaderCoinPanel ... />}
    {heatOpen && <MarketHeatPanel ... />}
  </div>
)}
```

渲染顺序固定为 其他币 → 龙头 → 热度。容器是绝对定位，因此仍是"脱离文档流"，不会给 `.workspace` 的 `grid-template-rows: auto minmax(360px,1fr) auto` 增加网格项（不改变图表/复核面板的行分配）。

### 布局
`.chart-float-stack`：
- `position: absolute; top: 76px; right: 18px; z-index: 30;`
- `width: min(520px, calc(100% - 36px));`（100% = `.workspace` 宽，沿用现状）
- `max-height: calc(100% - 96px);`
- `display: flex; flex-direction: column; align-items: flex-end; gap: 10px;`
- `pointer-events: none;`（避免容器左侧空区挡住图表点击）
- `.chart-float-stack > * { pointer-events: auto; }`

"互不遮挡"用容器 `max-height` + 子项可收缩实现，**不给容器加 `overflow: auto`**：
- 三个浮层各自已有内部滚动区（`.other-coin-chart` / `.leader-coin-list` / `.market-heat-body`），收缩时内部滚动即可，不需要容器级滚动条（容器级滚动条与 `pointer-events: none` 冲突）。

各浮层从"绝对定位"改为"堆叠子项"：
- `.other-coin-panel`：去掉 `position/top/right/z-index`；`position: relative;`（保留内部 `.other-coin-status` 的覆盖定位）；`width: 100%; height: 380px; flex: 0 1 auto;`
- `.leader-coin-panel`：去掉 `position/top/left/z-index`；`position: relative;`；`width: 100%; max-width: 320px; align-self: flex-end; flex: 0 1 auto;`（`max-height: 420px` 保留）
- `.market-heat-panel`：去掉 `position/top/right/z-index`；`position: relative;`；`width: 100%; max-width: 420px; align-self: flex-end; flex: 0 1 auto;`；`max-height` 由 `min(560px, calc(100% - 90px))` 改为 `560px`（`calc(100%)` 在 auto 高度的父级下不生效）

### 取舍
- 选"容器定宽 + 子项右对齐 + pointer-events 分层"而不是"子项百分比宽度"：避免 `width: min(520px, calc(100% - 36px))` 在嵌套容器里百分比基准变成父容器自身导致的循环/歧义。
- 选"子项收缩 + 内部滚动"而不是"容器整体滚动"：与 `pointer-events: none` 兼容，避免空区挡点击回退。

## 2. 其他币图开单 K 线竖线（R2）

采用项目既有手法：**SVG overlay + `timeScale().timeToCoordinate()`**（与主图 `.drawing-overlay` / `pointToScreen` 一致；见 component-guidelines "Chart Components"）。

### 结构（`src/ui/OtherCoinChart.tsx`）
```tsx
<div className="other-coin-chart-wrap">
  <div ref={chartRef} className="other-coin-chart" />
  <svg className="other-coin-marker-overlay" aria-hidden="true">
    {entryX != null && <line x1={entryX} x2={entryX} y1={0} y2="100%" />}
  </svg>
</div>
```
- `.other-coin-chart-wrap`：`position: relative; flex: 1; min-height: 0;`
- `.other-coin-chart`：改为 `position: absolute; inset: 0;`
- `.other-coin-marker-overlay`：`position: absolute; inset: 0; width: 100%; height: 100%; z-index: 2; pointer-events: none;`（无 `viewBox`，用户单位 = CSS px，`y2="100%"` 相对元素高度）
- 线样式：`stroke: rgba(250, 204, 21, 0.4); stroke-width: 1;`（与主图开单标记 `ENTRY_COLOR #FACC15` 同色系，低透明度 = 淡色；无文字标签）

### 对齐逻辑
内部 `entryX` 用 state（需要驱动渲染），通过 `recomputeEntryX()` 更新：
```ts
const time = markerTimeForEvent(entryTime, timeframe, loadedCandlesRef.current); // 已存在的时间对齐助手
const x = chart.timeScale().timeToCoordinate(time);
setEntryX(x == null ? null : x);
```
- `markerTimeForEvent` 复用 `src/ui/chart-time.ts` 的"事件时间 → 所属 K 线 timestamp"逻辑（已被 `tests/chart-time.test.ts` / `tests/trade-markers.test.ts` 覆盖），无需新写纯逻辑。
- 若开单 K 线不在已加载数据内，`timeToCoordinate` 返回 `null` → 不画线（可接受）。

### 何时重算（关键：保证缩放/平移/换币/换周期/加载更多后仍对齐）
1. 初次加载 `setData` + `setVisibleRange` 之后（用 `requestAnimationFrame` 兜一帧，等 time scale 应用完范围）。
2. `loadMore()` 里 `setData` + `setVisibleRange` 之后（同样 rAF）。
3. 现有 `subscribeVisibleLogicalRangeChange` 处理器**开头**调用（放在 `suppressAutoLoadRef` 早退之前，保证程序化换范围时也更新）。
4. 用 `ResizeObserver` 监听 `.other-coin-chart-wrap`，面板宽度变化时重算（`autoSize` 只重排 canvas，不会触发逻辑范围事件）。
5. 切换 `instrument` / `timeframe` 的加载 effect 开头 `setEntryX(null)` 复位。

## 3. 选币"已跳过休市标的"提示（R3）

`CoinScanResults`（`src/ui/CoinScanPanel.tsx`）把提示 `<p className="coin-scan-skip-hint">` 从"表格前独立兄弟节点"移入 `<header className="detail-header">` 的第一个 `<div>`（统计 `<p>` 之后）。

- 根因：`.workspace` 的 `grid-template-rows: auto minmax(360px,1fr) auto`；有提示时 `header / <p> / table-wrap` 三个网格项，`<p>` 落进 `1fr` 行被撑高。移入 header 后只剩 2 项（header / table-wrap），`1fr` 落到表格。
- CSS：`.coin-scan-skip-hint` 的 `margin: 0 0 8px` 改为 `margin: 4px 0 0;`，其余（`font-size:12px; color:#8b949e;` 单行省略）保留。文字内容不变（`已跳过 {N} 个休市标的:{names}`）。

## 4. 热度内嵌结果样式（R4）

`HeatScanResults`（`src/ui/HeatScanResults.tsx`）给 `MarketHeatView` 传 `layout="columns"`。

### `MarketHeatView` 改造（`src/ui/market-heat-view.tsx`）
新增可选 `layout?: 'stack' | 'columns'`（默认 `'stack'`，浮窗行为不变），把两个 `HeatBoard` 包进 `.market-heat-boards`：
```tsx
<div className={`market-heat-boards ${layout}`}>
  <HeatBoard ... 涨幅榜 />
  <HeatBoard ... 跌幅榜 />
</div>
```
CSS：
```css
.market-heat-boards { display: grid; gap: 8px; }
.market-heat-boards.columns { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 24px; }
@media (max-width: 720px) { .market-heat-boards.columns { grid-template-columns: 1fr; } }
```

### 内嵌样式
新增 `.heat-scan-results`（覆盖 `.market-heat-panel` 的浮窗定位）：
```css
.heat-scan-results {
  position: static;
  width: auto;
  max-height: none;
  border-radius: 8px;
}
.heat-scan-results .market-heat-body { flex: 1 1 auto; min-height: 0; }
```
- 作为 `.workspace` 第二个网格项，默认 stretch 占满 `minmax(360px,1fr)` 行；`.market-heat-body` 内部滚动。
- `.market-heat-panel` 的 `display:flex; flex-direction:column; background; border; box-shadow` 保留，与 `.coin-scan-table-wrap` 的卡片观感一致。
- 复盘头部「热度」按钮仍由 `MarketHeatPanel` 渲染，走默认 `layout="stack"` + 新的堆叠定位（R1）。

## 兼容性与回归风险

- `MarketHeatPanel` 的浮动定位被替换为堆叠子项定位；`tests/market-heat-panel.test.tsx` 依赖其渲染内容而非定位，预期不受影响（实现后须跑测试确认）。
- jsdom 不模拟 CSS `pointer-events`（见 quality-guidelines）：`.chart-float-stack` 的"空区穿透"必须在 `npm run dev` 里手动验证（打开仅龙头币时，能否点到其左侧的图表）。
- 浮层默认渲染顺序变化（其他币/龙头/热度）不改变各自开关状态与关闭逻辑。
- `.workspace { overflow: hidden }` 会裁剪超出容器底部的浮层；靠子项收缩避免（`flex: 0 1 auto` + 内部滚动）。

## 需要同步的 spec（Phase 3.3）

- `.trellis/spec/frontend/component-guidelines.md` 的 "Market Heat Panel" 段：需补充"三个右上浮层由 `.chart-float-stack` 纵列堆叠；热度内嵌结果走 `layout="columns"`"。
- `Coin Scan Panel` 段与实际代码已有漂移（列名等），本次不展开，仅在 R3 相关处补一句提示布局位置。
