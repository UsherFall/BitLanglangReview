# 画线吸附到K线OHLC(磁吸)

## Goal

画线时让端点吸到 K 线上：指针时间归属到某根 K 线柱，价格在该柱的 open/high/low/close 里取最近的一个。语义照搬 klinecharts 的 magnet（Apache-2.0，考证见 `research/klinecharts-magnet.md`）。

## Background

- 屏幕坐标 → 画线点只有一个入口：`src/ui/App.tsx:2037` 的 `pointFromClient()`。自由复盘与交割单复盘两个面板各有一份画线逻辑，共 8 处调用（每面板 4 处：落点、拖拽按下、拖拽移动、拖拽抬起）。`src/ui/OtherCoinChart.tsx` 没有画线。
- 画线点契约是 `{time, price}`（`src/domain/drawing.ts`），`time` 单位是**秒**；已保存的线段在渲染时会先经 `chart-time.ts::timeframeTimeForPoint` 把时间映射到"包含它的那根 K 线"（`App.tsx:2012`），草稿线则直接用原始时间。
- 找"包含某时间的那根 K 线"的能力已存在：`src/ui/chart-time.ts:106` 的 `containingCandleTimestamp()`，目前是文件私有函数。
- 工具栏已有同类先例：`markersVisible` 是会话内 UI 状态 + 一个 `aria-label`/`aria-pressed` 按钮，不持久化。

## Requirements

- R1 三态磁吸模式 `off | weak | strong`，**默认 `weak`**。工具栏新增一个循环切换按钮，带 `aria-label` 与 `aria-pressed`（新测试要用结构化查询，不依赖中文 title）。
- R2 时间维度：指针时间先归属到"包含它的那根 K 线"（复用 `containingCandleTimestamp`），命中则点的 `time` 取该 K 线柱时间（秒）；归属失败（指针在已加载数据范围外、无 K 线）时**不做任何吸附**。
- R3 价格维度（仅当 R2 归属成功）：
  - 候选 = 该 K 线的 `open/high/low/close` 四个价位。
  - `strong`：无条件吸到像素距离最近的候选。
  - `weak`：指针价格落在 `[low, high]` 区间**内** → 无条件吸最近的候选；落在区间**外** → 只有最近候选的像素距离 **≤ 阈值** 才吸，否则保留自由价格。
  - `off`：完全不改。
  - 候选的像素位置用 `series.priceToCoordinate` 求；返回 `null` 的候选剔除（不得产出 `NaN`）。
- R4 覆盖范围：
  - 线段：第一次单击落点、第二次单击终点、两点之间的预览端点。
  - 端点拖拽（`target` 为 `'start'` / `'end'`）。
  - 水平直线的落点（只有价格维度有意义，时间不动）。
  - **不覆盖**整体平移拖拽（`target === 'body'`）：平移增量必须用**未吸附**的指针坐标计算，否则整条线会按 K 线柱/OHLC 台阶跳，横向几乎无法连续移动。`dragRef` 因此要保存按下时的原始点，而不是吸附后的点。
- R5 阈值固定 8px（klinecharts 默认值），作为纯函数参数可注入以便测试，不做 UI 配置项。
- R6 吸附数学做成 `src/ui/` 下的**纯模块**（与 `chart-time.ts` / `chart-autoload.ts` 同层约定），不在 React 组件内写几何逻辑。
- R7 磁吸模式是会话内 UI 状态，**不做** localStorage 持久化（与同工具栏的 `markersVisible` 一致）。
- R8 不改变数据契约与依赖：`ChartPoint {time, price}` 形状、画线仍按 instrument 存服务端并在同 Instrument 的各周期/各交易间共享、不新增 npm 依赖。
- R9 跨周期语义：吸附结果是**绝对价格 + 绝对时间**，只在落点/拖拽那一刻结算一次。同一画线切到别的周期后照旧出现（instrument 级共享，`GET /api/drawings` 只按 instrument 过滤）、价格也不变，但**不再对齐到该周期的 OHLC**。不做"存吸附锚点、切周期重新解析"的锚点式引用（那需要改 `ChartPoint` 结构与服务端存储）。此口径与 TradingView 一致。

## Acceptance Criteria

纯函数（`tests/*.test.ts`，Node 环境，是本次最可信的信号）：

- [ ] AC1 `weak` 区间外：最近候选像素距离 < 8px 时吸附；> 8px 时不吸；正好 8px 时吸附（边界含等于）。
- [ ] AC2 `weak` 区间内：无论距离多远都吸到最近的 OHLC。
- [ ] AC3 `strong` 区间外：距离再远也无条件吸附。
- [ ] AC4 `off`：返回输入值原样。
- [ ] AC5 时间归属失败（指针在所有 K 线之前/之后，或 `candles` 为空）：`time` 与 `price` 都不变。
- [ ] AC6 `priceToCoordinate` 返回 `null` 的候选被剔除，结果不出现 `NaN`。
- [ ] AC7 时间吸附结果等于"包含指针时间的那根 K 线"的柱时间（秒）。

app 级（`tests/*.test.tsx` + mock `lightweight-charts`）：

- [ ] AC8 选线段后两次点击：保存到 `drawing.points` 的 `price` 是对应 K 线的某个 OHLC 值（而不是 mock 里 `coordinateToPrice` 返回的任意值）。
- [ ] AC9 默认模式是弱吸附；点击磁吸按钮依次变为 强 → 关 → 弱，按钮的 `aria-pressed`/可见文本/类名随之变化。

回归与代码审查项：

- [ ] AC10 `tests/app-drawings.test.tsx` 全文通过。**注意**：其中 "previews a segment from the first point to the current pointer" 用例断言草稿线 `x1 === '10'`，该值是在"时间不吸附"前提下算出来的（mock 的 `coordinateToTime: x => 1716256800 + x`，`timeToCoordinate: t => t - 1716256800`）。时间吸附后第一个点会落到 mock 那根 K 线柱上（x 变为 0），**该断言必须按新行为更新**，并保留"两点预览仍在跟随指针"的原意。这是本次唯一被有意改变的既有断言，不是为了让测试变绿。
- [ ] AC11（审查项）`dragRef` 保存的是吸附前的原始点，`'body'` 平移分支不受吸附影响；`design.md` 里写明了理由。
- [ ] AC12 `npx tsc --noEmit` 通过；`npx vitest run` 相关文件全绿（本机全量 `npm test` 长期全红属于已知的 vitest 双模块问题，不作为判断依据）。
- [ ] AC13（审查项）吸附目标（哪根柱、哪个字段）不得写进 `ChartPoint` 或服务端存储；`{time, price}` 形状与 `chart_drawings` 表结构保持不变（R8/R9）。

## Constraints

- 只改 `src/ui/`（新增纯模块 + `App.tsx` 接线 + `chart-time.ts` 导出私有函数），不动 `src/server` / `src/domain` 契约。
- 两个面板的重复画线逻辑都要接上，但**不要求**本次把重复逻辑合并（属于独立重构，避免混在一起）。
- 新增按钮的中文文案与既有工具栏文案保持一致风格。

## Out of Scope

- 其他画线工具类型（斐波那契、通道等）与"吸附到已画线/指标线"。
- 吸附到 K 线实体边缘、指标线、开盘缺口价等 TradingView 的高级磁吸目标。
- 磁吸模式持久化到 localStorage 或服务端。
- 锚点式跨周期重新对齐（存"哪根柱的哪个字段"、切周期重新解析）—— 见 R9 的明确排除。
- 合并两个面板的重复画线实现。
