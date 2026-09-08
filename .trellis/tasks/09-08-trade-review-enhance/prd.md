# 个人交割单复盘增强：名义价值显示 / 标签按模块隔离 / 持久化保障

## Goal

用户对「个人交割单复盘」模块（`reviewMode==='bitget'`，Bitget 已平仓持仓源）提出三点：

1. 列表里「保证金」位恒显示 "—"，想要一个能体现仓位金额口径的数字；
2. 标签下拉与 `N 笔` 计数不要和「交割单复盘」(xlsx) 模块串（现为全库全局计数）；
3. 重启 `npm run dev` 后密钥与已同步单子仍应在，不用重新填写/同步。

## 已确认事实（2026-09-08 勘查，含运行实证）

- **保证金不可得**：Bitget `v2/mix/position/history-position` 原始行无杠杆/保证金/持仓价值；用户 228 行全部 `crossed` 全仓（单笔保证金在交易所无定义）。`Trade.margin/leverage` 对 bitget 恒 null（bitget-import.ts:36-40），UI 显示 "—"。**可精确计算**：开仓名义价值 = `entryPrice × size`（语义等同 xlsx 的 `交易额 (USD)`）。
- **标签计数为全库全局**（抱怨属实）：`tagPayload`(app-plugin.ts:393-398) 用 `listReviews()` 全表（1237 行、跨模块）算 `tags/tagCounts`；`/api/tags/rename|delete`(app-plugin.ts:93-110) 全局改写。UI 消费点：侧栏 tag 筛选(App.tsx:643-645)、ReviewEditor 计数/下拉(ReviewEditor.tsx:191-193)。
- **持久化已成立**：密钥 `data/bitget-keys.json`(0600)、单子 `data/review.sqlite.bitget_positions` 均已落盘；2026-09-08 实测**全新 dev 进程**从项目根目录启动返回 `configured:true` + 226 笔。但路径用 `path.resolve('data')` 跟随启动目录（app-plugin.ts:43-46 / bitget-keys.ts:10），从别的目录启动会"看起来全丢"。
- 行渲染：侧栏行 App.tsx:707 `{formatLeverage(trade.leverage)} · 保证金 {formatUsdtAmount(trade.margin)} · 平仓 …`；详情 metrics(App.tsx:786-793) 无杠杆/保证金位。

## Requirements

### R1 名义价值替代保证金占位（个人交割单复盘）
- `historyPositionToTrade`(bitget-import.ts)：`turnover = entryPrice × size`（可算名义价值），`margin/leverage/returnRate/maxPositionValue` 仍 null。
- 侧栏交易行：bitget 行把「杠杆 — · 保证金 —」整段替换为「名义价值 N」（用 `turnover`，`formatUsdtAmount`）；xlsx(trade) 行保持「杠杆 X · 保证金 Y」不变。
- 不可得字段（杠杆/收益率等）仍显示 "—"，不伪造。

### R2 标签下拉与计数按模块隔离（名字仍全局）
- `/api/trades` 与 `/api/bitget/trades` 的 `tags/tagCounts` 只统计**本模块全部交易**（模块宇宙，不受当前筛选影响）而非全库。
- 标签改名/删除保持**全局语义**（用户确认）：一处改名两边交易引用同步更新。
- UI 改名/删除后改为重新拉取当前模块队列接口（`requestTradeRefresh`）获取 scoped tags/counts，不再用 `/api/tags/rename|delete` 返回的全局 tags/tagCounts 直接覆盖。

### R3 持久化路径加固（防御上次"重启丢数据"）
- 密钥与 SQLite 路径改为**按项目文件位置锚定**（`src/server` 向上定位项目根，`import.meta.url` 求值），不随进程启动目录变化；从任何目录启动都指向同一份 `data/`。
- 行为回归：项目根目录启动时路径与现状一致，现有 `data/` 数据无缝沿用。

## Acceptance Criteria

- [ ] AC1（R1）个人交割单复盘列表行显示「名义价值 数字」，不再出现「保证金 —」；交割单复盘(xlsx) 行仍显示「杠杆 x · 保证金 y」；两模块其余 "—" 展示不变。
- [ ] AC2（R1）`npm test` 相关用例绿（bitget-import 映射 turnover 计算；UI 行文案）。
- [ ] AC3（R2）在个人交割单复盘里，标签下拉与各标签「N 笔」只统计 bg- 交易；交割单复盘里只统计 xlsx 交易；两模块同一标签名下笔数各自独立。
- [ ] AC4（R2）任一模块改名/删除标签后，双方交易的标签引用同步更新（全局语义不破），且当前模块列表刷新后计数仍按模块口径。
- [ ] AC5（R3）密钥与单子在重启后仍在（现状回归）；新增从项目根目录以外的 cwd 也能解析到同一 `data/` 的单测。
- [ ] AC6 全量 `npm test` + `tsc --noEmit` 通过；相关 spec（domain/server/frontend 索引指向的指南）同步。

## Out of Scope

- 用成交流水 fill 级配对反推杠杆/保证金；密钥加密/系统钥匙串。
- 打开模块自动增量同步（当前需求是"持久化不丢"，不是"自动拉新"）。
- xlsx 源工作簿路径锚定（workbook 仍在项目根由现有逻辑发现，未报告问题）。
- 详情 metrics 条新增名义价值/杠杆位（未要求，保持现状）。

## Key Decisions

- D1（R1）显示**开仓名义价值**（可精确计算），不伪造保证金/杠杆。理由：API 无数据 + 全仓模式单笔保证金无定义。
- D2（R2）计数与下拉**按模块宇宙隔离**；标签名与改名/删除**仍全局**。理由：用户选择；工作量适中。
- D3（R3）路径锚定项目根。理由：防御"启动目录不同→另建空 data→看似丢数据"。

## Risks / Deferred

- R2 改名/删除后 UI 走整体 refetch：有极短暂刷新间隙（可接受）；选中交易若仍在队列则保持选中（fetch effect 既有逻辑保证）。
- R1 名义价值用开仓口径（entryPrice×size）；若未来想显示平均口径再评估。
- 持久化"丢数据"的历史原因未 100% 复现（当前根目录实测不丢）；R3 是防御性修复，若另有原因待复现后另案。
