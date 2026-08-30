# 币安扫描限流与重试优化

## Goal

币安选币扫描（`CoinScanService.scanShrink`）每次点击 = topN(60) × 5 时间框架 = 300 个 klines 请求，全部强制刷新、并发 10 无节流，瞬时请求率冲高触发币安 IP 自动封禁（HTTP 418）。优化后：保留「每次点击强制刷新最新数据」的既有产品决策，改为**限速 + 重试退避**，让扫描不再触发 418，且在偶发 429/418 时自动恢复而不是整体 502 失败。

## Requirements

- 扫描的 klines 并发拉取（`coin-scan-service.ts` 的 `mapLimit`）加**速率限制**：限制瞬时请求率，避免突发冲高。
- 保留 `refresh: true` 强制刷新语义，不做缓存复用（用户明确决策）。
- Binance HTTP 层（`http.ts`）对 429 / 418 加**指数退避重试**：
  - 429：尊重 `Retry-After` 头，缺省时指数退避 + 抖动重试。
  - 418（IP 封禁）：退避更久，封禁期过后恢复。
- 重试次数有上限，超过上限才向路由层抛错（保持现有 502 语义）。
- 不改变 `defaultFetchJson`（OKX）的既有行为，除非有强理由 —— OKX 未报告 418，改动最小化为原则。

## Acceptance Criteria

- [ ] 一次扫描 300 个 klines 请求的瞬时速率被压制到安全阈值内，不再触发 418（本地连续多次扫描验证）。
- [ ] 限速不影响正确性：扫描结果与限速前一致（同一参数、同一时刻）。
- [ ] 模拟 429（含 `Retry-After`）与 418 响应：重试后成功恢复；超过上限后抛错（保持 502 语义）。
- [ ] OKX 请求路径行为不变（无重试或与改动前一致）。
- [ ] 现有测试通过；新增针对限速与重试的单元测试。
- [ ] 不触碰缓存策略 / `refresh` 语义 / topN 默认值。

## Notes

- 根因：`coin-scan-service.ts:15` `SCAN_CONCURRENCY=10` 无节流；`coin-scan-service.ts:70` `refresh:true` 每次强制 300 请求；`http.ts:53` 非 OK 直接 throw 无重试。
- 可选后续（不在本任务范围）：klines `limit` 100→99 权重 2→1；复用缓存。
- 已确认 alert-monitor 只做 1 次 ticker/24hr 每分钟，非并发大户。
