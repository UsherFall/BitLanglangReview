# 深化 Free Replay Cursor 与 Focus 双数据集

## Goal

把 FreeReplayChart 的 Cursor / Focus 双数据集、Candlestick 加载属主、异步响应校验和延迟渲染协议收进一个可脱离 React 与 lightweight-charts 测试的 Module，让数据正确性通过同一 Interface 直接验证，同时保持现有图表交互、Viewport 和 Session 行为不变。

## User Value

这次交付首先降低回归风险：切周期、切 Session、连续点不同焦点单、拖动翻页和后台预取时，旧数据不能污染当前图表，App 的当前价与开平仓能力始终来自正确的 Cursor 数据集。其次降低后续 Session 生命周期、视口和其他 Replay 功能的修改成本。

## Dependencies

- 子任务 1 已完成并归档：`archive/2026-11/11-05-replay-market-context`，工作提交 `9e627a6`。
- 当前实现已使用 `chartMarketContext(replayCandleSource(replay))` 统一 requestSource 与 Candle Grid，本任务必须复用，不得另建行情映射或撤销其兼容修复。
- 当前基线为 76 个测试文件、694 个测试通过，`tsc --noEmit` 与 CRLF-aware `git diff --check` 通过。

## Confirmed Facts

- `src/ui/App.tsx:1547-2427` 的 FreeReplayChart 为 881 行，含 40 个 `useRef`、18 个 `useEffect`、7 个 `useState`。
- Cursor、Focus、Active、Loaded、Rendered、加载在飞、过期键和延迟渲染分由多个 refs 与 effects 协调；核心发布逻辑集中在当前 `publishActive` / `installIntoDataset`，但调用时序依赖声明顺序与调用方自觉遵守。
- `onCandlesLoaded` 只能接收 Cursor 数据集，App 用它计算 `currentCursorCandle`、浮盈和开平仓可用性；`onActiveCandlesLoaded` 才接收当前渲染数据集供 Paper Round 标记锚定。
- 历史设计明确要求 Cursor 与 Focus 永不互相 merge，焦点窗口一次整窗替换，焦点态只翻焦点窗口，退出后恢复同 rangeKey 的 Cursor 窗口。
- 当前 Future Prefetch 只加载不渲染；焦点右缘翻页与补洞在 pointerdown 时只更新数据层，pointerup / cancel / blur 后才发布最终 Rendered 数据集。
- 当前 `loadCursorInitialWindow` 只按 rangeKey 丢弃旧响应，Focus 取窗也只按 rangeKey 校验；同 rangeKey 的 Focus A→B 竞态未被封住，Earlier / Later / Prefetch 的响应落地缺少统一的 range generation 校验。
- `tests/app-free-replay.test.tsx` 已覆盖首锚、焦点整窗、回 Cursor、跨周期、补洞、预取、Future 隐藏、拖动延迟渲染和 Paper Round 行为，可作为迁移 Characterization Tests。
- 详细属主表、异步操作表、竞态证据和历史约束见 `research/current-state.md`。

## Requirements

- **R1 — 单一数据属主。** 用一个独立 Module 拥有 Cursor、Focus、Active、Rendered 及其加载/发布状态；React 不得再与 Module 各持一份可变副本并手工保持同步。
- **R2 — Cursor 供给不变。** App 的 `onCandlesLoaded` 只能收到 Cursor 数据集；焦点态下 Cursor 后台生长可继续喂 App，但不得替换当前 Focus 渲染。
- **R3 — 全路径过期保护。** 所有异步加载都必须识别当前 range generation；Focus 还必须识别当前 focusKey。旧 range、旧 Focus、卸载后的响应不得修改数据、渲染、状态文本或触发回调。
- **R4 — Focus 协议不变。** 进入焦点仍一次 `mode=initial` 整窗替换，不与 Cursor merge；失败/空窗口保留现有回退语义；退出焦点恢复匹配 rangeKey 的 Cursor，缺失或不匹配时共享 Cursor 初始加载并保持在飞去重。
- **R5 — 渲染协议不变。** Future Prefetch 保持 loaded-but-not-rendered；`syncCursor` 才发布当前 Active 供下一帧揭示。追加型 Later / Gap 在 pointerdown 时只更新数据层，释放后一次发布最终 Rendered。
- **R6 — 请求与加载规则不变。** initial / earlier / later / prefetch / gap 的 instrument、timeframe、entryTime、anchor、mode、requestSource 与现有保持一致；保留在飞去重、Future 失败重试、Gap 加载互斥和 Range 重置。
- **R7 — Viewport 只消费数据。** Chart Navigation Anchor、首锚、舒适区、Focus 锚定、回 Cursor、剪刀边界、绘制与标记算法不改；视口触发键（logical range、history/gap trigger key）可以留在图表侧，但数据属主和响应落地必须进入 Module。
- **R8 — 直接测试 Interface。** 新 Module 不 import React 或 lightweight-charts，通过可替换 Candle Loader Adapter 覆盖双数据集、竞态、预取、Focus 退出、延迟渲染和错误路径；现有 App 测试继续验证真实组合。
- **R9 — 小步无依赖迁移。** 不引入全局 store、新状态库、服务端改动、Session schema 迁移或通用图表抽象；FreeReplayChart 可以暂时留在 App.tsx，避免文件搬迁与协议迁移混在一起。

## Acceptance Criteria

- [x] **AC1 / R1,R8：** 新 Dataset Module 的测试无需挂载 App、React、jsdom 或 lightweight-charts，能通过 fake Candle Loader 验证数据与异步状态；生产路径复用现有 `fetchCandles` Adapter。
  - 证据：`tests/free-replay-dataset.test.ts`（13 tests，deferred `CandleLoader`，无 React/DOM/chart import）；生产默认构造 `new FreeReplayDataset()` 使用 `fetchCandles`。
- [x] **AC2 / R1,R2,R4：** Focus 窗口总是整窗替换且不与 Cursor 拼接；Focus 期间 App 仍收到 Cursor 数据并能开平仓，退出后恢复正确 Cursor / Active / Rendered。
  - 证据：Dataset 的 Focus A/B 与 Focus exit 用例；`tests/app-free-replay.test.tsx` 的焦点整窗 / App Cursor 供给 / 恢复 Cursor 用例。
- [x] **AC3 / R3：** 单测证明旧 range 的 initial / earlier / later / prefetch / gap 响应全部被丢弃；同 range 的 Focus A→B 中，A 的迟到成功或失败均不能覆盖 B；卸载后的响应无副作用。
  - 证据：`discards a stale range initial success, error and empty response`、`only installs the current focusKey…`、`discards page/prefetch/gap responses from an older range`（含 earlier）、`ignores every completion after disposal`。Mutation 验证：去掉 focusKey 校验 → Focus A/B 用例红；去掉 earlier 的 generation 校验 → stale page 用例红。
- [x] **AC4 / R5：** 单测证明 Prefetch 不直接改变 Rendered，Cursor 同步后才发布 Active；pointerdown 下 Later / Gap 只更新数据层，pointerup 后一次发布最终合并结果，非拖动对照立即发布。
  - 证据：`keeps prefetched candles loaded but not rendered…`、`defers append-type publications…`。
- [x] **AC5 / R4,R6：** Cursor 初始加载在飞去重、Focus 失败/空回退、Future 失败重试、Earlier / Later 属主捕获、Gap 互斥及所有请求参数与旧实现一致；`chartMarketContext` 和 Session source 兼容测试保持通过。
  - 证据：`captures the Earlier/Later owner at invocation`、`settles an empty or failed Focus…`、`preserves the request matrix…`；`tests/chart-market-context.test.ts` 与 App source 用例保持通过。
- [x] **AC6 / R7：** 现有 Free Replay Characterization Tests 全部保持并通过，包括首锚等新 range 数据、Focus 不跨周期、舒适区、回 Cursor、Future 隐藏、补洞、拖动延迟渲染、Paper Round 标记与模拟交易。
  - 证据：`tests/app-free-replay.test.tsx` 62 tests 全通过；断言未修改。
- [x] **AC7 / R1,R9：** App 中 Cursor / Focus / Active / 加载在飞 / Pending Render 不再由平行 refs 和 `publishActive` / `installIntoDataset` 手工协调；Viewport 所需快照来自 Module，不能只把原函数换名搬到新文件。
  - 证据：`publishActive` / `installIntoDataset` / `activeCandlesRef` / `cursorCandlesRef` / `focusCandlesRef` / 5 个 loading ref / `pendingInstallRenderRef` / focus 去重 ref 全部删除；图表只保留 refs 指针、视口触发键与视口算法。App 从 3074 行降至 2775 行（-299），数据属主集中在 482 行的 Module 内。
- [x] **AC8：** focused Dataset + Replay + chart tests、完整 `npm test`、`npx tsc --noEmit`、`git diff --check` 全通过；最终 diff 仅限本任务代码、测试、任务文档和相关 spec。
  - 证据：focused 8 files / 139 tests；`npm test` 77 files / 707 tests；`npx tsc --noEmit` 通过；`git diff HEAD --check` 退出 0（仓库已配置 `core.whitespace=cr-at-eol`）。

## Out of Scope

- Free Replay Session 生命周期、自动保存、删除防复活、Paper Round Library 状态重构（后续子任务 3）。
- Chart Navigation Anchor、Viewport、价格刻度、绘图、TradeChart、OtherCoinChart 的统一抽象或算法修改。
- SQLite 原子删除、路由拆分、共享 timeframe/merge 契约整理（后续子任务 4–6）。
- 新产品行为、新行情源、服务端 API / SQLite / 依赖变化、全局状态库。
- 为了解决本任务之外的旧问题而改写整个 FreeReplayChart 或测试套件。
