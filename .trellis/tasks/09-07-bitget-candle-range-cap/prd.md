# 修复 Bitget k 线 later 窗口超过 90 天上限

## Goal

Bitget v2 mix candles 单次请求限定 `startTime ~ endTime` 跨度 ≤ 90 天。`BitgetCandleSource` 的 `later` 分支把 `endTime` 设为 `anchor + step × limit`(limit=150),1D 窗口=150 天、1W/1M 更大,触发 Bitget 返回 HTTP 400(code 00001),导致个人复盘图在 1D 上加载失败。修复:later 的 endTime 钳制在 `anchor + min(step × limit, 90d)` 内,保持块紧邻 anchor、可正常分页续载。

## Requirements

- **R1 钳制 later 窗口**:`endTime = anchor + Math.min(step * limit, MAX_RANGE_MS)`,`MAX_RANGE_MS = 90 × 24h`,保证 interval(`endTime - (anchor+1)`)不超过 90 天。
- **R2 语义保持**:窗口仍紧邻 anchor(仍以 startTime=anchor+1 兜底过滤);当 `step×limit ≤ 90d` 时行为不变(现有 5m/15m 等单测不得回归)。
- **R3 无数据策略不变**:不回退、不加提示;老交易(如 Bitget 上线前的 ZEC)空数据时图表维持空态。

## Acceptance Criteria

- [ ] AC1 对 1D/1W/1M 的 `later` 请求,URL 中 `endTime - startTime ≤ 90d`;不再触发 Bitget HTTP 400。
- [ ] AC2 5m/15m 等小窗口 later 行为与参数与修复前一致(相关单测仍绿)。
- [ ] AC3 新增针对 90 天上限的单测(如 1D limit=150 断言 endTime 被钳制)。
- [ ] AC4 `npm test`(受影响子集 + 全量)与 `tsc --noEmit` 通过。

## Out of Scope

- 空态提示文案改造(Bitget 上线前老交易不回退、不提示,用户已确认)。
- 无数据回退 OKX 策略(已确认不做)。
