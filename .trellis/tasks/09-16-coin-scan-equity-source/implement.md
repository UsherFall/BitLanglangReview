# 执行计划（父任务）：集成与验收

父任务本身**不实现功能**，实现都在 `09-16-equity-yahoo-candles`（A）与 `09-16-scan-module-split`（B）。这里只列验收动作与顺序。

## 顺序

1. A 的完成前检查已全过（`prd.md` AC 1–8；52 文件 / 321 测试全绿；真机单请求验证会话序列）。此时单独验证一次：休市时段的加密扫描结果与改动前一致、美股/韩股不再出现在结果里。
2. 等 B 的完成前检查全过（`prd.md` AC 1–8）。
3. 跑本文件的集成验收（下方）。

## 集成验收动作

- [ ] `npx vitest run` 全绿；`npx tsc --noEmit` 干净。
- [ ] `grep -rn "market-session" src/ tests/` 为空；`tests/market-session.test.ts` 不存在；`MarketHeatService` 与 `CoinScanService` 都不再 import 日历。
- [ ] 真机 A：休市时段（周末 / 北京时间白天）`/api/scan?method=shrink&scope=equity` → 结果为空或仅剩开盘市场，且 `skippedInstruments` 列出被跳过的美股/韩股。
- [ ] 真机 B：加密侧扫描结果与拆分前逐行对比（同一 anchor）→ `instrument`、`qualifiedCount`、`bestScore`、排序完全一致。
- [ ] 真机 B：`scope=equity` 的结果只含美股/韩股；抽一个标的核对 K 线时间戳落在真实时段内（`AAPLUSDT` 的 1H bar ∈ 04:00–20:00 ET）。
- [ ] 真机 B：`heat` 在加密侧正常、池子无股票类；`scope=equity&method=heat` 与非法 `scope` 均 400。
- [ ] 一致性核对：`CONTEXT.md` / `spec/server/{coin-scan,market-data,market-heat}.md` 中不再有「Session Gating 按日历剔除」的表述，术语为 `Instrument Scan`（选品）/ `Equity Candle Source` / `Freshness Gate`。

## 回滚点

- A 与 B 各自可独立 revert（B 回滚后退化为「单列表但池子已分治」，A 回滚后恢复 09/06 的日历式 gating 且窗口回到 100）。
- 若不得不临时关掉休市过滤：让 `isScannable` 恒真 + `isCandleInSession` 恒真即退回改动前行为（但会重新引入休市污染，仅作应急）。
