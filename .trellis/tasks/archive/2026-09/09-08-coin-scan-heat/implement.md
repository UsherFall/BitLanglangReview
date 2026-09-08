# Implement：选币模块新增「热度」扫描方法

依赖顺序：Step A（后端分支）→ Step B（展示抽取 R4，先保回归）→ Step C（选币 UI/结果接线）→ Step D（验证/收尾）。每步独立小提交。

## 前置校验
- [ ] `git status` 基线记录；`npm test` 全绿基线。
- [ ] 通读 `src/ui/MarketHeatPanel.tsx`、`src/ui/CoinScanPanel.tsx`、`src/server/app-plugin.ts` /api/scan 段，确认行号与 design 一致。

## Step A 后端 `/api/scan` method=heat
1. `app-plugin.ts` /api/scan（:196-222）：method 校验从"非 shrink 一律 400"改为分发。
   - heat：解析 `anchor`（`parseOptionalNumber`，非法/<=0 → 400），池固定 80。
   - 调用 `marketHeatService.computeHeat({ anchor: anchor ?? Date.now() })`，`send(res,200,result)`；catch → 502 同 shrink。
2. 校验：`npx tsc --noEmit`；手工 curl `GET /api/scan?method=heat` 返回 MarketHeatResult 结构、`method=shrink` 无回归、`method=xxx` 仍 400。

## Step B 呈现抽取（R4，先行独立提交）
1. 新建 `src/ui/market-heat-view.tsx`：把 MarketHeatPanel 的 tier/numbers/HeatBoard/skips/warnings 呈现段 + TIER_LABEL/TIER_HINT/formatSigned/formatVolume/HeatBoard/renderSkips 迁入，导出 `MarketHeatView({ result })`（className/文案逐字保留）。
2. `MarketHeatPanel.tsx` 瘦身为：fetch/loading/error + header(标题/锚点/close) + `<MarketHeatView result={result} />`；删除本地重复常量/组件。
3. 校验：`tests/market-heat-panel.test.tsx` 不改且绿；`npm test`；`npx tsc --noEmit`。此步失败即 revert 该提交。

## Step C 选币 UI 与方法接线
1. `CoinScanPanel.tsx`：
   - method state + 可控下拉（收敛结构/热度）。
   - 参数区按 method 切换（heat：只显示扫描时间点，留空=现在）。
   - 导出/定义 `type ScanResult`；`scan()` 按 method 拼 `/api/scan` query，统一做 response.ok/error 处理；提示文案按 method。
2. `App.tsx`：`scanResult` 类型 `ScanResult | null`；workspace 分支按 method 渲染 `HeatScanResults`（新组件）或 `CoinScanResults`。
3. 新建 `src/ui/HeatScanResults.tsx`：detail-header（标题「选币结果」副标题「热度 · 锚点 …」）+ `<MarketHeatView result>`。
4. 校验：`npx tsc --noEmit`；`npm test`；浏览器手工：
   - 收敛结构与现状一致；
   - 切热度 → 参数变化 → 扫描 → 五档读数/统计/涨跌幅榜出现，无"复盘币"行；
   - 扫描时间点填历史值 → 历史热度；空 → 现在；
   - 复盘交易里点「热度」面板仍正常。

## Step D 收尾
- 全量 `npm test` + `npx tsc --noEmit`；跑 `tests/market-heat-panel.test.tsx` 重点回归。
- Spec 同步：`.trellis/spec/` 的 coin-scan/market-heat 相关指南如定义"scan 仅 shrink 方法"需更新为可插拔多方法（选中币索引指向的指南文件核对后修订）；CONTEXT.md 选币词条同步（方法从 V1 仅 Shrink 扩展为 shrink|heat）。
- 整理成 3~4 个提交（A/B/C/D）。

## 验证命令
- `npm test`（Windows 用 PowerShell 跑全量）
- `npx tsc --noEmit`
- 手工：`npm run dev` + curl + 浏览器（见 Step C）
