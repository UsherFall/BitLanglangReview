# 执行计划 — 复盘/选币界面视觉与标注优化

> 复杂任务：`prd.md` + `design.md` + `implement.md` 齐备后方可 `task.py start`。
> 按 R1 → R2 → R3 → R4 顺序实施；每步独立可验证。

## 预检

- [ ] `npm test` 基线通过（记录既有失败项，若有）。
- [ ] `npm run dev` 打开，确认「交割单复盘」与「选币」两个模式的现状。

## 步骤

### 1. 右上角浮层堆叠（R1）

- [ ] `src/ui/App.tsx`：把 `otherCoinOpen / leaderCoinOpen / heatOpen` 三个条件渲染包进 `{(...) && <div className="chart-float-stack">…</div>}`（顺序 其他币 → 龙头 → 热度）。位置：`App.tsx:790-792`。
- [ ] `src/ui/styles.css`：
  - [ ] 新增 `.chart-float-stack`（见 design.md「1. 布局」）与 `.chart-float-stack > *`。
  - [ ] `.other-coin-panel`（styles.css:577）：去掉 `position/top/right/z-index`，改 `position: relative; width: 100%;`，加 `flex: 0 1 auto;`。
  - [ ] `.leader-coin-panel`（styles.css:700）：去掉 `position/top/left/z-index`，改 `position: relative; width: 100%; max-width: 320px; align-self: flex-end;`，加 `flex: 0 1 auto;`。
  - [ ] `.market-heat-panel`（styles.css:1684）：去掉 `position/top/right/z-index`，改 `position: relative; width: 100%; max-width: 420px; align-self: flex-end;`，`max-height` 改 `560px`，加 `flex: 0 1 auto;`。
- [ ] 手动验证：单开龙头 → 在右上；三开 → 纵向排列不重叠；仅龙头时其左侧图表区域可点击（pointer-events 分层，jsdom 测不出）。

### 2. 其他币开单 K 线竖线（R2）

- [ ] `src/ui/OtherCoinChart.tsx`：
  - [ ] import 增加 `markerTimeForEvent`（来自 `./chart-time`）。
  - [ ] state：`const [entryX, setEntryX] = useState<number | null>(null);`
  - [ ] `recomputeEntryX()`：`markerTimeForEvent(entryTime, timeframe, loadedCandlesRef.current)` → `chartApiRef.current.timeScale().timeToCoordinate(time)` → `setEntryX`。
  - [ ] 初次加载 effect（OtherCoinChart.tsx:86-120）：开头 `setEntryX(null)`；`setVisibleRange` 后 `requestAnimationFrame(() => recomputeEntryX())`。
  - [ ] `loadMore()`（OtherCoinChart.tsx:150-184）：`setVisibleRange` 后同样 rAF 重算。
  - [ ] 可见逻辑范围订阅 effect（OtherCoinChart.tsx:122-148）：处理器开头调用 `recomputeEntryX()`（放在 `suppressAutoLoadRef` 早退之前）。
  - [ ] 新增 `ResizeObserver` effect 监听 `chartRef.current` 父容器，尺寸变化时重算；卸载时 `disconnect`。
  - [ ] JSX：`<div className="other-coin-chart-wrap"><div ref={chartRef} className="other-coin-chart" /><svg className="other-coin-marker-overlay" aria-hidden="true">{entryX != null && <line … />}</svg></div>`（OtherCoinChart.tsx:227）。
- [ ] `src/ui/styles.css`：`.other-coin-chart`（styles.css:684）改 `position: absolute; inset: 0;`；新增 `.other-coin-chart-wrap`、`.other-coin-marker-overlay` 及 `line` 样式（`rgba(250,204,21,0.4)`、1px）。
- [ ] 手动验证：选币后竖线落在开单那根 K 线；缩放/平移/换币/换周期/加载更多后仍对齐。

### 3. 选币跳过提示并入标题（R3）

- [ ] `src/ui/CoinScanPanel.tsx`：把 `CoinScanResults` 的 `result.skippedInstruments` 提示块（CoinScanPanel.tsx:177-181）从表格前移入 `<header className="detail-header">` 的第一个 `<div>`，统计 `<p>` 之后；文字与 `title` 内容不变。
- [ ] `src/ui/styles.css`：`.coin-scan-skip-hint`（styles.css:1496）`margin` 改 `4px 0 0`。
- [ ] 手动验证：存在跳过标的时无大块空白，表格占满剩余区域。

### 4. 热度内嵌两栏（R4）

- [ ] `src/ui/market-heat-view.tsx`：`MarketHeatView` 增加 `layout?: 'stack' | 'columns'`（默认 `'stack'`）；两个 `HeatBoard` 包进 `<div className={\`market-heat-boards ${layout}\`}>`。
- [ ] `src/ui/HeatScanResults.tsx`：`<MarketHeatView result={result} layout="columns" />`。
- [ ] `src/ui/styles.css`：新增 `.market-heat-boards` / `.market-heat-boards.columns`（+ 窄屏 media query）与 `.heat-scan-results` 覆盖块（styles.css 末尾 `.market-heat-*` 区域）。
- [ ] 手动验证：选币 → 热度 → 结果占满内容区、涨幅/跌幅榜并排；复盘头部「热度」仍是浮窗（默认 stack）。

### 5. 测试

- [ ] `tests/heat-scan-results.test.tsx`：补一条结构性断言 —— 两栏容器 `.market-heat-boards.columns` 存在（避免依赖中文/具体样式）。
- [ ] 新增 `tests/coin-scan-results.test.tsx`：渲染含 `skippedInstruments` 的 `ScanResponse`，断言跳过提示节点位于 `.detail-header` 内（`closest('.detail-header')`），且文本存在。
- [ ] 若浮层堆叠可测，优先断言 `App` 渲染出 `.chart-float-stack`；否则以手动验证为准（pointer-events 无法在 jsdom 验证）。

## 校验命令

- [ ] `npm test`（全量，必须通过）
- [ ] 项目无独立 lint 脚本（见 quality-guidelines），以 `npm test` + 手动验证为准。

## 风险点 / 回滚点

- 高风险：`.market-heat-panel` 定位语义变更会影响浮窗与内嵌两处 —— 若内嵌观感不对，优先只调 `.heat-scan-results` 覆盖，不回退堆叠改造。
- 回滚：本任务全部改动集中在 `App.tsx` / `OtherCoinChart.tsx` / `CoinScanPanel.tsx` / `market-heat-view.tsx` / `HeatScanResults.tsx` / `styles.css`，可整文件 `git checkout` 回退。
- 必须手动验证（jsdom 盲区）：浮层空区是否挡住图表点击；竖线在真实 canvas 上是否对齐。

## Phase 3 收尾

- [ ] `trellis-update-spec`：更新 `.trellis/spec/frontend/component-guidelines.md` 的 Market Heat Panel 段（堆叠容器 + columns 布局）。
- [ ] 3.4 提交：按逻辑分组提交（R1-R4 可合并为一个 UI 改动提交，测试随附）。
