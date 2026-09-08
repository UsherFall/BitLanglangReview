# 选币模块新增「热度」扫描方法

## Goal

「选币」模块目前只有「收敛结构」一种方法。新增与它平级的第二个方法「热度」：选择热度方法后点「扫描」，展示与复盘里市场热度面板同款能力的**整体场子读数**（五档温度 + 广度/中位统计 + 涨/跌幅榜）。用于扫描前先看当前市场是热市还是冷市。

## 已确认事实（2026-09-08 勘查）

- 选币 UI：`src/ui/CoinScanPanel.tsx` 方法下拉写死 `shrink` 且 disabled(:39-41)；参数区 = 扫描数量/最低成交额/结构强度阈值/扫描时间点；`/api/scan?method=shrink`(app-plugin.ts:196-222) → `CoinScanService.scanShrink`；结果表在 CoinScanResults(:106-290) 按 shrink 定制。App.tsx `scanResult` 单一 `ScanResponse`(:212/716/766)。
- 复盘热度：`MarketHeatService.computeHeat({anchor, reviewInstrument?, poolTopN?})`(market-heat-service.ts) —— 恒跑 **Binance**（app-plugin 注入 binanceTickerSource/binanceCandleSource，独立于 MARKET_DATA_SOURCE）；池=Binance USDT-M 24h 成交额 Top80(HEAT_POOL_TOP_N) + 休市跳过 + 可选把复盘币并入；输出 `MarketHeatResult`(domain/market-heat.ts:65)：`tier/stats/topGainers/topLosers/reviewCoin/skipped/warnings`。
- UI：`MarketHeatPanel.tsx`(158 行) fetch `/api/market-heat?anchor&instrument`，渲染 header(标题/锚点/关闭) + tier + numbers + HeatBoard 涨跌幅榜 + skips + warnings；内部 `HeatBoard/renderSkips/TIER_LABEL/TIER_HINT` 未导出。App 里在交易详情作 overlay(:784)。
- 测试：`tests/market-heat-panel.test.tsx`(渲染 tier/numbers/boards + 错误态)；`tests/coin-scan-service.test.ts`。无 /api/scan 路由级测试。

## Requirements

- R1 方法平级：选币方法下拉改为可选「收敛结构 / 热度」；热度方法参数区只保留扫描时间点（锚点，留空=现在）；池固定 Binance USDT-M Top80（与复盘一致），不暴露池大小参数。
- R2 后端：`/api/scan` 增加 `method=heat` 分支（GET），可选 `anchor`，走既有 `marketHeatService.computeHeat`（恒 Binance，不随 MARKET_DATA_SOURCE 变，与复盘热度同源同口径）；非法参数沿用 400。
- R3 结果展示：选币结果区在热度方法时渲染与复盘同款的热度视图（整体五档温度 + 统计 + 涨/跌幅榜 + skip/warnings），不关联具体币（reviewCoin 恒无）；收敛方法结果与现状逐字一致。
- R4 复用而非复制：热度结果呈现层从 `MarketHeatPanel.tsx` 提为共享展示组件，复盘面板(带 fetch/close)与选币热度结果都引用它，文案/样式单一来源。

## Acceptance Criteria

- [ ] AC1（R1/R2）方法下拉可切换；选热度点扫描请求 `method=heat`，返回与 `/api/market-heat` 同构的 `MarketHeatResult`；锚点留空=现在，填入=该时刻历史热度；非法参数 400。
- [ ] AC2（R3）热度扫描结果展示五档温度读数（热市/偏热/中性/偏冷/冷市 + 提示）、统计数字（中位/涨/跌/异动/覆盖）、涨跌幅榜、休市/无行情提示；不出现"复盘币"行。
- [ ] AC3（R4）复盘交易里的市场热度面板渲染不变（既有 market-heat-panel 测试绿）；两处热度视图共享同一呈现组件，无复制 JSX。
- [ ] AC4 收敛结构方法与结果表与现状一致（无回归）；`npm test` + `npx tsc --noEmit` 绿。

## Out of Scope

- 热度结果行与选币流程的联动（点币开始回溯/龙头/复制币）——热度是整体读数，非逐币榜单。
- 改变复盘热度口径/池定义/阈值。
- 为热度方法新增 24h 成交额阈值或池大小参数（热度池固定 Top80，与复盘口径一致）。

## Key Decisions

- D1 热度方法复用 `/api/scan`（method=heat）与 `marketHeatService`，保持"与收敛同级"入口语义。
- D2 热度恒 Binance（与复盘热度定义一致，选币模块的 MARKET_DATA_SOURCE 只影响收敛方法的行情源）。
- D3 结果视图与复盘热度共用呈现组件（MarketHeatPanel 轻重构提取），避免双份样式漂移。

## Risks / Deferred

- 首次热度扫描要拉全池 80×(15m)K 线（与复盘首次一致，有 429 退避/418 快失败/提示）；命中既有蜡烛缓存时更快。
- MarketHeatPanel 提取重构有回归风险：靠 market-heat-panel 测试 + 手工回归复盘热度覆盖。
