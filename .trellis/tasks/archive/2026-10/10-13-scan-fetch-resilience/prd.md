# 选品扫描容错：单个标的取数失败不再中断整轮扫描

## Goal

选品扫描中任一 (标的,周期) 取数失败（如 Bitget 12s 超时）会导致整轮扫描 502、已扫结果全丢。改为逐标的隔离失败：跳过失败标的并回报清单，其余照常出结果；418 保持快速失败。

## 触发 / 根因

- 2026-10-13 实测：`GET /api/scan?method=shrink`（Bitget 默认源）整体返回 `Bitget request failed: request timed out after 12s`，UI 报 `扫描失败`，整轮结果全丢。
- 根因在 `src/server/coin-scan-service.ts:120-136`：两阶段都用 `mapLimit`（内部 `Promise.all`，`:257-269`）抓取每 (标的,周期) 的 K 线，mapper 体内没有 try/catch。任一 rejection 让 `Promise.all` reject → `scanShrink` 抛错 → 路由 `catch` 返回 502（`src/server/app-plugin.ts:371-373`）→ UI 丢弃全部结果。
- 放大因素：Bitget 行情路径对超时 / 网络错误**完全没有重试**（`fetchJsonWithRetry` 只重试 429/418，`src/server/http.ts:270-322`），所以数百个请求里任意一次 12s 卡顿就毁掉整轮。Bitget 业务错误（HTTP 200 + `code != '00000'`，`src/server/bitget-candles.ts:98-100`）与 OKX / Binance 同样致命。

## Requirements

- **R1 逐标的隔离失败**：任一标的在任一阶段的 K 线抓取抛错，只淘汰该标的；其余标的照常走完两阶段并出结果。
- **R2 失败标的必须回报**：响应新增 `failedInstruments: string[]`（仅非空时出现）；UI 在结果头部给出可见提示，数量 + 标的名，全名进 `title`（沿用 `.coin-scan-skip-hint` 样式，与 `skippedInstruments` 同级）。
- **R3 418 保持整体快速失败**：IP 被封时不以"跳过标的"方式吞掉——整轮立即中止，沿用现有 502 路径。429 / 超时 / 网络错误 / 业务错误都**不**整体中止。
- **R4 淘汰语义明确**：
  - Stage 1（1D 粗筛）抓取失败 = 无法粗筛 → 该标的淘汰，且**不进入池基数 N**（与既有"窗口不足"路径同款语义）。
  - Stage 2 某周期抓取失败 = 该标的 4 个周期缺数据 → **整行淘汰**，不填 `neutralStructure()`，避免用残缺结构参与排序与计数。
- **R5 判定口径不动**：不新增成功率 / 失败率阈值，不加自动重试，不改 12s 超时值，不动粗筛阈值、排序与 `minScore`。
- **R6 tickers 全量快照失败仍是整体失败**：没有标的可扫，保持 502。

## Acceptance Criteria

- [ ] AC1 单元：Stage 1 某标的抓取抛普通 Error 时 `scanShrink` 正常 resolve；其余标的的 `scanned` 与对照运行一致；失败标的出现在 `failedInstruments`。
- [ ] AC2 单元：Stage 2 某幸存标的的某周期抓取抛错时，该标的**不在** `scanned` 内、计入 `failedInstruments`，其余幸存标的不受影响。
- [ ] AC3 单元：gate 处于 418 封禁态时 `scanShrink` rejects，**不**产出部分结果。
- [ ] AC4 单元：`failedInstruments` 为空时该字段不出现（与 `skippedInstruments` 同款 omit 语义）。
- [ ] AC5 UI：结果头部渲染失败提示，含数量与标的名，仍位于 `.detail-header` 内，`.detail-header` 子元素数不变（grid 仍 2 个顶层子元素）。
- [ ] AC6 三条通道语义不混：限频走 `warnings`，休市走 `skippedInstruments`，取数失败走 `failedInstruments`。
- [ ] AC7 `npx tsc --noEmit` 与 `npm test` 全绿。

## Known residual（review 时请确认）

网络全断（每次请求都 12s 超时）时本轮仍要走到"全部失败"才返回：408 候选 ÷ 5 并发 × 12s ≈ **16 分钟**才出空表 + 失败清单。

用户 2026-10-13 明确二次确认：**不加自动重试、不加连续失败熔断、不放宽 12s 超时**，只要"不再整轮中断 + 跳过失败标的"。因此该残留按此保留，不在此任务内处理；若日后不可接受，"连续 N 次失败即中止"与"超时重试 1 次"都是独立的小改动，各开新任务。

## Notes

- 不改 `MarketHeatService`（同一失败模式，但不在本次触发范围）。
- 规格改动落在 `.trellis/spec/server/coin-scan.md`（`ScanResponse` 契约、服务聚合伪码、错误矩阵），在 finish 阶段（3.3）更新。
