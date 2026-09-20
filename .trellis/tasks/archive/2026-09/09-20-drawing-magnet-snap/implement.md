# Implement — 画线磁吸

前置：口径见 `prd.md`，算法与接线见 `design.md`，klinecharts 原语义见 `research/klinecharts-magnet.md`。
本任务只碰 `src/ui/` + `tests/`，所以 **dev server 不需要重启**（Vite 对 UI 模块是热更新；只有 `src/server/**` 才需要重启）。

## 1. 暴露已有的 K 线归属能力

- [ ] `src/ui/chart-time.ts`：把私有的 `containingCandleTimestamp()` 改为导出（保持行为与签名不变，仍接收**毫秒**时间戳，返回毫秒柱时间或 `null`）。
- [ ] 顺手在它的 JSDoc 里写清"毫秒进、毫秒出"，避免与画线点的秒单位混用（这是本次最容易踩的坑）。

## 2. 纯模块 `src/ui/drawing-snap.ts`

- [ ] 按 `design.md` 的契约实现 `MagnetMode` / `SnapDrawingPointInput` / `snapDrawingPoint()`。
- [ ] 常量 `DEFAULT_MAGNET_SENSITIVITY = 8`。
- [ ] 异常路径全部返回**输入原样**：`mode === 'off'`、时间归属失败、候选全被剔除 —— 不抛错、不返回 `NaN`、不返回半个点。
- [ ] 不 import `lightweight-charts`，只 import domain 类型与 `chart-time` 的归属函数。

## 3. 先锁数学：`tests/drawing-snap.test.ts`

按 AC1-AC7 逐条写，一个 AC 一个 `it`。要点：

- [ ] 用**线性假换算**构造确定性场景，例如 `priceToY = (p) => (200 - p) * 2`，这样"像素距离 8px"直接对应可算的价格差。
- [ ] AC1 要覆盖三个点：距离 7px（吸）、9px（不吸）、**正好 8px（吸）**。
- [ ] AC2 用"价格落在 [low, high] 内但离四个 OHLC 都很远"的构造，证明区间内无条件吸（这条最容易实现成"统一阈值"而漏掉）。
- [ ] AC5 构造 `candles` 为空、以及指针时间早于第一根 K 线两种失败形态。
- [ ] AC6 让 `priceToY` 对某个价格返回 `null`，断言其余候选仍能正常选中且结果 `Number.isFinite`。

## 4. 接线 `src/ui/App.tsx`

- [ ] 新增 state：`const [magnetMode, setMagnetMode] = useState<MagnetMode>('weak');`（两个面板各一份，与现有 `markersVisible` 同风格）。
- [ ] 新增工具栏按钮：循环 `weak → strong → off → weak`，带 `aria-label`（固定文案，便于测试查询）与 `aria-pressed={magnetMode !== 'off'}`；显示当前态（图标 + `title` 说明下一步会切到哪）。
- [ ] `pointFromClient()` 增加可选吸附参数；实现里先算原始点，再在调用方要求的场合过 `snapDrawingPoint`，`pointerY` 用同一个 `clientY - rect.top`。
- [ ] 8 处调用点按 `design.md` 的表格分别接"吸 / 不吸"：落点+预览+端点拖拽吸；`dragRef` 存的按下点**不吸**。
- [ ] `handleOverlayPointerMove` 里若同时需要两种点，直接调两次（一次带吸附、一次不带），不要事后反推。
- [ ] 两个面板（自由复盘 ~1107-1505、交割单复盘 ~1527-1940）都改到；改完 grep 一遍 `pointFromMouse\|pointFromPointer` 确认没有漏网的调用点仍走老签名。

## 5. app 级用例 `tests/app-drawing-snap.test.tsx`

- [ ] 抄 `tests/app-drawings.test.tsx` 的 mock 骨架，但把假图表改成**能体现吸附**的版本：`coordinateToPrice` 随 y 变化、`priceToCoordinate` 与之互逆、`candles` 给 2 根以上，且 `coordinateToTime` 落在某根 K 线内部。
- [ ] AC8：点线段工具 → 两次点击 → `fetch('/api/drawings', {method:'POST'})` 的 body 里 `points[*].price` 命中该 K 线的 OHLC 之一。
- [ ] AC9：默认 `aria-pressed` 为真（弱吸附）；连点按钮断言三态循环与按钮属性变化。
- [ ] 注意 spec 里的已知坑：`.test.tsx` 依赖 jest-dom 时要有 `import '@testing-library/jest-dom/vitest'`（照抄既有文件第一行），中文断言优先用 `aria-label` 等结构化查询。

## 6. 更新既有断言（AC10）

- [ ] `tests/app-drawings.test.tsx` 的 "previews a segment..."：第一个点的 x 断言由 `10` 改为时间吸附后的实际值，并保留"第二点仍在跟随指针"的原意。在用例里加一行注释说明为什么这个值变了（时间吸附），避免后人误以为是随手改绿。

## 7. 验证

- [ ] `npx vitest run tests/drawing-snap.test.ts tests/app-drawing-snap.test.tsx tests/app-drawings.test.tsx`
- [ ] 相邻回归：`npx vitest run tests/chart-time.test.ts tests/app-free-replay.test.tsx tests/app-review-progress.test.tsx tests/free-replay-chart.test.ts`
- [ ] `npx tsc --noEmit`
- [ ] 本机全量 `npm test` 长期全红（vitest 4.x 的 `@vitest/runner` 双模块实例），不作为判断依据。
- [ ] **人工验证（必做）**：jsdom 不模拟真实坐标换算与 CSS `pointer-events`，吸附的手感只能人工看。启动 dev server：
  - 线段：靠近某根 K 线的最高/最低点时预览是否吸住，落在实体内部是否吸到最近的 OHLC；
  - 端点拖拽是否按柱/OHLC 走；
  - 整体平移（拖动线身）是否仍然连续、不被量化；
  - 切到"关"后是否恢复完全自由；
  - 自由复盘与交割单复盘**两个面板**都过一遍；
  - **跨周期回归**：在同品种切 5m/15m/1H/4H/1D，确认画线照旧全部出现（instrument 级共享未被破坏），且切周期不会改变已存的价格（R9：不重新对齐）。

## 8. 收尾

- [ ] spec 更新（3.3）：把"画线吸附"的约定写进 `.trellis/spec/frontend/component-guidelines.md`（chart overlay 一节）：三态语义、区间内无条件吸、平移不吸的理由、纯模块 + 注入 `priceToY` 的做法、以及"时间归属用 `containingCandleTimestamp`（毫秒进毫秒出）"。
- [ ] 提交（代码 + 测试 + spec）。

## 回滚点

- 步骤 2/3 独立可回滚（纯新增文件）。
- 步骤 4 是唯一有行为风险的接线；默认模式改为 `off` 即等价于关闭特性。
- 步骤 6 改的是既有断言，回滚时要与步骤 4 一起退，否则测试与行为会不一致。
