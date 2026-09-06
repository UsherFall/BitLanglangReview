# 开平仓交互重构 — 实施

## 前置状态

- 任务 09-06（in_progress 前置：planning）→ `task.py start` 后实施。
- 代码基线：`master` 上 `59f9b32`（含 09-02 已提交功能 + 上轮误修的逐仓平仓控件）。

## Ordered Checklist

1. **Domain 删除 `closeLegMarket`**
   - `src/ui/free-replay-paper-trading.ts:163-169` 删除函数及上方注释（161-162）；`closeLegQuantity`、`closeQuantityFor`、`processRevealedCandle` 不动。
   - `git grep closeLegMarket` 确认仅剩 tests 引用。

2. **Domain 测试改写（`tests/free-replay-paper-trading.test.ts`）**
   - 顶部 import 移除 `closeLegMarket`。
   - 改写 2 个逐仓平用例为 `closeMarket(ratio)` 等价语义：
     - "keeps a leg stop after manually closing a part of that same leg"：单仓设止损 → `closeMarket(..., 50)` → 断言剩余量 50%、止损仍在、触发只平剩余。
     - "market-closes one whole leg…"：两等量仓各设止损 → `closeMarket(..., 50)` FIFO 整删最早仓 → `closeMarket(..., 100)` 全平 → 断言止损不再触发/挂单清除。
   - 运行：`npx vitest run --pool=vmForks tests/free-replay-paper-trading.test.ts` 全绿。

3. **App/面板（`src/ui/App.tsx`）**
   - `FreeReplayPaperTradingPanel`：
     - 删 props `onCloseAll`、`onCloseLeg`（类型+声明+调用方 702-703）。
     - 新增 `onCloseRatio(ratio)` → `closeMarket(current, candle, progressTime, ratio)`。
     - 平仓区：`平仓比例` PresetNumberInput（25/50/75/100，默认 100）+ 单个「市价平仓」按钮（提交后复位 100）；**无「全部市价平仓」**；限价止盈数量 = 持仓 × 平仓比例。
     - `LegStopRow` 调用点移除 `closeRatioPercent` 与 `onClose`。
   - `LegStopRow`：删 local `closeRatioPercent`/`handleClose`/PresetNumberInput/平仓按钮；只留 meta + 止损控件。
   - 校验：`npx tsc --noEmit`。

4. **样式（`src/ui/styles.css`）**
   - 删 `.leg-stop-close`、`.leg-stop-close .preset-input`；`.leg-stop-control` 回单行 grid（input + 按钮 + 按钮）。

5. **app jsdom 用例（`tests/app-free-replay.test.tsx`）**
   - `全部市价平仓` 按钮查询（162/279/452）→ `市价平仓`（语义等价：默认比例 100 点即全平）。
   - 复查是否引用了逐仓平仓相关文案/`平仓比例`（预期无）。

## Validation

- `npx tsc --noEmit`
- `npx vitest run --pool=vmForks tests/free-replay-paper-trading.test.ts`
- `git diff` 复查：仅删 per-leg close 面、保留整仓 FIFO/止损/止盈行为。

## Review Gates

- domain 测试改写后先单独跑绿。
- 提交：单 commit；不动工作区其余 60+ Trellis 框架文件。

## Validation Status（2026-09-06）

- `npx tsc --noEmit` ✅
- 全量 node 套件 `npx vitest run --pool=vmForks --exclude '**/*.test.tsx' tests/`：31 files / 167 tests ✅
- `tests/app-free-replay.test.tsx`：仍因既有 jest-dom 未注册环境问题整体失败（`Invalid Chai property: toHaveValue/toBeInTheDocument`），无新增模块错误；3 处 `全部市价平仓` → `市价平仓` 已改。
