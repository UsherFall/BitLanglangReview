# Implement · 选品: 距线修复 + 20 个上限 + 画线抽屉

> 依据：`prd.md` + `design.md`（2026-10-21）。
> 顺序：**单位 → 匹配 → 价位 → 截断 → 画线 → 说明**。前两步是「距线可信」的最小闭环，先做完就能验证。

## Step 0 · 准备

- [ ] 读 `.trellis/spec/domain/trade-and-review-model.md`（drawing 契约）、`.trellis/spec/server/coin-scan.md`（扫描全流程）、`.trellis/spec/frontend/component-guidelines.md`（图表组件规范）
- [ ] 确认 `npm test` 基线干净（当前已知：`tests/level-alert-parity.test.ts` 因 archive 路径**失败**，属既有问题，本任务顺带修）

## Step 1 · 时间单位统一到毫秒（domain）

- [ ] `src/domain/level-alert.ts`：
  - [ ] `LevelLine` 的 `p1` / `p2` 改成 `{ ms: number; price: number }`（毫秒在类型上确定）
  - [ ] 新增 `pointTimeMs(point)`：产品 `time`（秒）→ 毫秒；研究 `t`（毫秒）→ 原样
  - [ ] `levelPriceAt(line, at)`：插值全部毫秒；`at` 明确是毫秒
  - [ ] `scaleStartIndex`：按毫秒找起点（原来恒为 0）
  - [ ] `linesFromDrawings`：把 `ChartDrawing.points[]`（秒）转成 `{ms, price}`
- [ ] `src/domain/drawing.ts`：确认 `ChartDrawing.points[].time` 的单位注释（秒）
- [ ] 测试 `tests/level-alert.test.ts`：
  - [ ] 现有断言按毫秒语义重写（`p1: {ms, price}`）
  - [ ] **新增回归**：混用「秒的 `time`」与「毫秒的 `t`」不会算出天文数字
  - [ ] **新增**：斜线在两点之间线性插值（毫秒）
  - [ ] **新增**：有射线时尺子只取「射线起点之后那段」
- [ ] `npx vitest run tests/level-alert.test.ts` 绿

## Step 2 · canonical 名（domain）

- [ ] `src/domain/instrument-symbol.ts` 新增：
  - [ ] `canonicalInstrument(instrument): string` —— `BTC-USDT-SWAP` / `BTCUSDT` / `BTC-USDT` → 同一 canonical
  - [ ] `shortInstrument(instrument): string` —— 展示用去 `-USDT-SWAP` 后缀
- [ ] `src/ui/CoinScanPanel.tsx` 的本地 `shortInstrument` 改用 domain 版（避免两份实现）
- [ ] 测试 `tests/instrument-symbol.test.ts` 扩：三种写法归一；无法识别的原样返回

## Step 3 · 跨交易所价位换算（domain + server + store）

- [ ] `src/domain/drawing.ts`：`ChartDrawing` 增**可选** `refPrice?: number` / `refTime?: number`（毫秒）
- [ ] `src/server/drawing-store.ts`：
  - [ ] 增列 `ref_price REAL` / `ref_time INTEGER`
  - [ ] 迁移照抄 `allowNullableTradeId` 的建表→copy→drop→建索引模式
  - [ ] `toDrawing` / `saveDrawing` 读写新列（NULL ↔ undefined）
- [ ] `src/domain/level-alert.ts`（或新文件）新增纯函数：
  - [ ] `scaleFactor({ refPrice, refTime, sourceClose }): { factor: number; note?: string }`
  - [ ] 规则：缺 `refPrice` → 1；找不到 `sourceClose` → 1 + note；factor 超出 `[0.5, 2]` → 1 + note（不可信）
- [ ] `src/server/coin-scan-service.ts` stage-2：
  - [ ] 线按 **canonical** 分组（`canonicalInstrument`）
  - [ ] 每个 (ticker, timeframe) 找到 `refTime` 时刻在**扫描源**的收盘价（复用已拉到的 K 线；找不到 → 因子 1）
  - [ ] 线价 × 因子后再算距线
- [ ] 测试：
  - [ ] `tests/drawing-store.test.ts`：`refPrice`/`refTime` 存取；旧行（无新列）兼容
  - [ ] `tests/coin-scan-service.test.ts`：drawing 存 OKX 名 → 扫描行 `base+USDT` 名 → `levelAlerts` 非 null；比例因子三种情况

## Step 4 · 结果默认 20 个（ui）

- [ ] `src/ui/CoinScanPanel.tsx`：
  - [ ] `COLLAPSED_ROWS = 20`；`showAllRows` state
  - [ ] 渲染 `showAllRows ? rows : rows.slice(0, 20)`（**降权沉底在前**：`orderScanRows` 已做）
  - [ ] 表头：`粗筛 N 个 · 显示 M 个` + 「显示更多 / 收起」按钮（还有 N 个）
- [ ] 测试 `tests/coin-scan-results.test.tsx`：
  - [ ] 30 行数据默认只渲染 20 行
  - [ ] 「显示更多」展开到 30 行
  - [ ] 降权行沉底且不占前 20

## Step 5 · 画线能力抽成可复用模块（ui）

- [ ] 新建 `src/ui/chart-drawing.tsx`：
  - [ ] 搬 `DrawingOverlay` / `DrawingShape` / `rayEndPoint` / `drawingStyleForTimeframe` / `pointFromMouse` / `pointFromPointer` / `pointFromClient` / `moveDrawing`
  - [ ] 导出 `useChartDrawings({ instrument, timeframe, tradeId, candles, chartApiRef, seriesRef, overlayRef })` → 工具条 + overlay + 状态
  - [ ] 磁吸（`drawing-snap.ts`）保持现状
- [ ] `src/ui/App.tsx`：
  - [ ] `TradeChart` / `FreeReplayChart` 改用 `useChartDrawings`（**行为逐字不变**）
  - [ ] 画线浮层（`level-drawer`）把 `drawTimeframe` 传给 `OtherCoinChart`
- [ ] `src/ui/OtherCoinChart.tsx`：
  - [ ] 新增 `drawable?: boolean`（默认 false）
  - [ ] `drawable` 时：载入 `GET /api/drawings?instrument&timeframe`、渲染 overlay + 工具条、保存带 `refPrice`/`refTime`
- [ ] `src/server/app-plugin.ts`：`/api/drawings` GET 支持可选 `timeframe` 查询参数
- [ ] 测试：
  - [ ] `tests/app-drawings.test.tsx` 扩：抽屉里能画水平线/射线 → 保存 → 重新载入仍在
  - [ ] 现有 `TradeChart` / `FreeReplayChart` 画线测试保持绿

## Step 6 · UI 说明 + 收尾

- [ ] `src/ui/CoinScanPanel.tsx`：表头加「日线窗口 23 天」的口径说明（`title` + 一行小字）
- [ ] 迁移 `tests/level-alert-parity.test.ts`：
  - [ ] 路径改到 `.trellis/tasks/archive/2026-10/10-20-anomaly-level-tracker/research/`
  - [ ] `LevelLine` 构造改 `{ms, price}`（研究数据的 `t` 是毫秒 → `ms = t`）
- [ ] `npx tsc --noEmit` 干净
- [ ] `npm test` 全绿
- [ ] 更新 `.trellis/spec/server/coin-scan.md`（粗筛截断在 UI 层 + 距线的 canonical/比例因子口径）与 `.trellis/spec/frontend/component-guidelines.md`（画线模块的位置与共用）

## 验证清单（人工）

- [ ] 选品页扫描 → 结果默认 20 行，表头显示「粗筛 N 个 · 显示 20 个」
- [ ] 「显示更多」→ 全部行可见
- [ ] 点「画线」→ 抽屉里能画水平线/射线 → 关闭重开 → 线还在
- [ ] 该币在扫描结果里出现距线数值（不是 `—`），且数值合理（不是恒 -100%）
- [ ] 表头有「日线窗口 23 天」的解释

## 回滚点

| Step | 独立提交 | 回滚代价 |
| --- | --- | --- |
| 1 | `fix(level-alert): 时间单位统一到毫秒` | 低（纯 domain） |
| 2 | `feat(symbol): canonical instrument 名` | 低 |
| 3 | `feat(level): 跨交易所价位换算` | 中（涉及 store 迁移，迁移是只增列） |
| 4 | `feat(scan-ui): 结果默认 20 个` | 低 |
| 5 | `refactor(ui): 画线模块抽出并接入抽屉` | 中（碰两个成熟图表） |
| 6 | `docs(spec): 口径同步` | 低 |
