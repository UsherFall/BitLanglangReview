# 执行计划（父任务）：集成与验收（已完成）

父任务不实现功能；实现都在 `09-16-equity-yahoo-candles`（A）与 `09-16-scan-module-split`（B）里，两者均已归档。

## 集成验收结果

- [x] `npx vitest run` → **54 文件 / 336 测试全绿**；`npx tsc --noEmit` 干净。
- [x] `grep -rn "选币\|Coin Scan" src/ tests/ CONTEXT.md .trellis/spec/` → 仅剩 `coin-scan.md` 里一句「renamed from 选币 09/16」的历史说明（有意保留）。
- [x] **真机 A**：实时锚点（2026-09-16 07:01Z = 03:01 ET，美股未开盘）扫描 → equity scope 跳过 **50** 个股票类标的、结果为空；加密/商品照常。
- [x] **真机 B**：历史锚点（2026-09-15 14:00 ET，美股盘中）→ equity rows `SNDK KORU MU SOXL MSTR CRCL SPCX SKHY`，crypto rows `XAU LSK ETH SOL XRP CL ZEC BTC`，**两池互斥**，港/A 股与 Pre-IPO 两池都不出现。
- [x] **降级可见**：跑真机时币安共享出口 IP 被 418 两次，期间 `metadataAvailable()` 返回 false、响应带 `metadataUnavailable`（该路径在真实环境里被验证过，不是纸面）。
- [x] 一致性：`CONTEXT.md` 术语为 `Instrument Scan`(选品) / `Crypto Scope` / `Equity Scope` / `Session-only Series` / `Scan Pool Policy` / `Session Gating`；`spec/server/{coin-scan,market-data,market-heat}.md` 与 `spec/frontend/component-guidelines.md`、`spec/server/api-plugin.md` 同步。

## 交付顺序

1. A 先落地（单独即修掉休市污染，且当时 UI 仍是单列表）—— 已提交归档。
2. B 在 A 之上做池子分治与 UI 形态 —— 已提交归档。

## 回滚点

- A、B 各自独立 revert。A 回滚恢复 09/06 的日历式 gating 且窗口回到 100 根；B 回滚退化为「单列表但池子已按 scope 分治」。
- 应急关掉休市过滤：让 `isScannable` 恒真 + `isCandleInSession` 恒真即退回改动前行为（会重新引入休市污染）。

## 未纳入本轮（另开任务）

- 图表 K 线链路与选品结果的联动（现状不联动）。
- 股票侧的热度读数（需要另定语义）。
- 商品单独成子模块；隔夜 session（20:00–04:00 ET）纳入扫描。
- `spec/frontend/component-guidelines.md` 的 Coin Scan Panel 段落早已与实现脱节（仍描述 `plateauMin`/`maxCompression`/`trendWindow` 等已删除的参数）—— 本轮只做了更名，未重写该段。
