# 画线跨周期可见性回归（交割单复盘等所有图表）

## Goal

恢复画线的 instrument 级可见性：在任一周期画下的线，切到同一品种的其他周期时依然显示。距线扫描（选品）的"按线所在周期测量"语义保持不变。用户在交割单复盘报告："画了线然后各个周期没有同步出现线"。

## Background / 确认事实（代码与历史证据）

- **这是 10/21 引入的行为变化，不是一直如此**：7-8 月画线是 instrument 级（无 timeframe 列，`08-03-free-replay-session-history` PRD 记录 "Drawings are instrument-level and already persist; they appear automatically"）。10/21 的 `ebb01f9`（距线扫描改造）给 `chart_drawings` 加了 `timeframe` 列（含数据迁移），`16bbda4` 把 UI 加载改成 `GET /api/drawings?instrument=…&timeframe=…`。
- **spec 自相矛盾，说明可见性切换是连带损伤而非意图**：
  - `frontend/quality-guidelines.md:20`（trellis init 时的存量规范）："Drawings remain instrument-level and appear across trades/timeframes for the same Instrument."
  - `frontend/component-guidelines.md:50`（10/21 新写）："Levels are per (instrument, timeframe)"——但其真实动机是**扫描测量**："each timeframe is measured with its OWN volatility scale"、`coin-scan-service.ts:199` "Only the timeframes the user actually drew on are measured"。可见性与测量粒度是两回事，UI 加载被顺带改掉了。
- 现行实现链：`chart-drawing.tsx:157-165` 的加载 effect `fetch('/api/drawings?instrument=…&timeframe=…')`（注释明写"Levels are per (instrument, timeframe), so a timeframe switch reloads the set"）→ `drawing-store.ts listDrawings` 按两列过滤 → 切周期后其他周期的线不显示。**渲染层（`drawings.map(<DrawingShape>)`）无二次过滤**——修复点只有这一处 fetch。
- 服务端已具备能力：`GET /api/drawings` 的 `timeframe` 参数本就可选（`app-plugin.ts:274` 注释、`listDrawings({ instrument, timeframe? })`）——不带该参数即返回该品种全部周期的线。**无需改服务端/存储**。
- 三个消费者共用 `useChartDrawings`（TradeChart 交割单+个人复盘、FreeReplayChart、OtherCoinChart 选品画线抽屉）——hook 单点修复，三处同时恢复。
- `timeframe` 字段对距线扫描是**测量粒度**：`level-alert.ts:195` `if (drawing.timeframe !== timeframe) continue;`、扫描 Stage 2 只取"用户画过线的周期"的 K 线。线的显示位置与周期无关（水平线是纯价格；segment/ray 的点是绝对日历时间，秒），跨周期渲染几何上正确。
- 保存/编辑语义：新画的线继续打**当前图表周期**的标签（在哪个周期画，距线就在哪个周期测它）；在其他周期看到并可拖动/删除同一条线（编辑的是同一对象）。

## Requirements

1. `useChartDrawings` 的加载 effect 不再带 `timeframe` 参数：`GET /api/drawings?instrument=…`，注释改为"可见性是 instrument 级（quality-guidelines.md），`timeframe` 标签只服务距线扫描的测量粒度"。保存（`saveDrawing`）继续写当前周期标签，不动。
2. spec 同步，消除矛盾：
   - `component-guidelines.md:50` 改为：levels 按保存时的周期**打标签**（距线在该周期测量），但图表**可见性是 instrument 级**——图表加载该品种全部周期的线。
   - `quality-guidelines.md:20` 保持并成为权威表述。
3. 测试（`tests/app-drawings.test.tsx` 或新增用例）：
   - 加载请求不含 `timeframe` 参数；
   - mock 返回"5m 画的水平线 + 4H 画的射线"，图表在 4H 周期时两条都渲染；切到 5m 后两条仍在（列表来自同一份 instrument 级响应）。

## Acceptance Criteria

- 交割单复盘任一品种 5m 画一条水平线 → 切 4H/1D：该线仍在原价位显示；反向同理。segment/ray 在其他周期显示在同一日历位置。
- 新画的线保存后带画线时所在图表的周期标签（距线扫描行为不变：5m 画的线只会在 5m 距线里报警）。
- 选品画线抽屉、回溯复盘图表同样恢复跨周期可见（同一 hook）。
- `tsc --noEmit` 与全量 `vitest run` 绿。

## Out of Scope

- 不做"线的归属周期角标/悬停提示"（当前无 tooltip 体系；真被困扰再说，记为 deferred）。
- 不改距线扫描（`listDrawingsByTimeframe` / `measureLevelAlert` / Stage 2 周期裁剪）。
- 不改服务端存储与路由（`timeframe` 可选过滤已存在）；不做历史数据迁移（列与标签保留原义）。
- 不做跨品种显示（仍是同 instrument）。

## Key Decisions

- 修复面收敛在 hook 单点（可见性），保留标签（测量粒度）——两者解耦，是 10/21 改造本应落地的形态。
- 保存标签语义"画时所在周期"不变：这是 10/21 有意的产品决策（OWN volatility scale），用户的抱怨只针对可见性。

## Risks / Notes

- 选品抽屉会看到其他周期的线，可能先不习惯；但抽屉里的线列表本就按周期分组提示扫描归属（组件已有该列表）。
- 历史上（10/21 前）无标签的旧线：迁移时已复制为各周期各一份（`drawing-store.ts` 的 `insert ... select` 迁移），会全量显示——多份同价位水平线可能视觉重合，属可接受的既有事实，不在本任务清理。

## 实施结果（10/22）

- 单点修复：`chart-drawing.tsx` 加载 effect 改为 `GET /api/drawings?instrument=…`（无 timeframe）；`timeframe` 同时移出 effect 依赖——切周期不再重拉、不清选中/半成品草图（同品种同一套线）。
- `app-plugin.ts` 路由注释同步（过滤器现在无 UI 调用方，保留供定点查询）；spec `component-guidelines.md` 改为"标签 = 距线测量粒度，可见性 = instrument 级"，与 `quality-guidelines.md` 权威表述一致。
- 测试：`app-drawings.test.tsx` 新增回归用例（GET 无 timeframe 参数断言 + 5m 水平线与 4H 射线同图表共存 + 切周期不重拉不掉线）；`other-coin-chart.test.tsx` 的旧契约用例（断言 GET 带 timeframe）同步为新契约。
- `tsc` 通过；全量 71 文件 / 594 用例全绿。
