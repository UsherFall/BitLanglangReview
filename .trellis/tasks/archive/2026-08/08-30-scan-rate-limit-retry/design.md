# 币安扫描限流与重试优化 — 技术设计

## 现状

- `coin-scan-service.ts:61` — `mapLimit(tasks, SCAN_CONCURRENCY=10, mapper)`，每个 (coin, timeframe) 一个 klines 请求，无节流。60×5=300 请求瞬间发出。
- `http.ts:45` `fetchJsonWithProxy` — `!response.ok` 直接 throw，无重试。418/429 一出现整个扫描 502。
- `refresh:true` 保留（用户决策），缓存不碰。

## 改动 1：扫描侧限速（`coin-scan-service.ts`）

**目标**：把 300 请求的瞬时速率压到安全阈值（例如 ≤10 req/s），同时保留并发。

**方案**：共享 `pace()` 门控 —— 全局记录 `nextAllowed`，每个 mapper 在发请求前调用 `pace(minInterval)`，保证任意两次请求**开始时间**间隔 ≥ `minInterval`（含小抖动防对齐）。并发仍由 `mapLimit` 控制，但实际吞吐被 `pace` 钳住。

- `minInterval` 默认 100ms → ≤10 req/s → 300 请求 ≈ 30s 完成。
- 抖动：每请求额外 `+rand(0, minInterval/2)`，避免 5 个 worker 请求对齐成小波峰。
- `SCAN_CONCURRENCY` 10→5（降低 in-flight 峰值，配合限速）。
- 实现位置：在 `scanShrink` 的 mapper 顶部 `await pace()`。`mapLimit` 保持通用不侵入。

**为什么不用 token bucket**：burst 已知且一次性，min-gap 门控实现最简单、可测试、吞吐上界确定。token bucket 的优势（平滑长期速率）在单次扫描场景无收益。

## 改动 2：HTTP 层重试（`http.ts`）

**目标**：429/418 自动退避重试，超上限才抛错（保持 502 语义）；OKX 路径不动。

**方案**：抽出可注入 fetch 的重试函数 `fetchJsonWithRetry(url, fetchImpl, opts?)`：

```ts
type RetryPolicy = {
  maxAttempts: number;        // 429: 4; 418: 2
  baseDelayMs: number;        // 429: 1000; 418: 15000
  maxDelayMs: number;         // 429: 5000; 418: 60000
  retryOn: (status: number) => boolean;  // 429/418
};
```

每次尝试独立 `AbortController` + 超时（复用现有 12s）。重试间等待：
- 429：`Retry-After` 头（秒）优先，否则 `min(baseDelay * 2^(attempt-1) + jitter, maxDelay)`。
- 418：退避更长（IP 封禁需时间解除）。
- 抖动 `rand(0, delay/2)`。
- `retryOn` 只匹配 429/418；其余状态（4xx/5xx）照旧立即抛错。

`defaultFetchJson`/`defaultBinanceFetchJson` 改为调用 `fetchJsonWithRetry`（OKX 无 429 特殊处理，同样受益于 429 重试；418 对 OKX 不出现）。

**可测试性**：`fetchJsonWithRetry` 接收注入的 `fetchImpl`，单测传 mock，无需真网络。

## 不改动

- `refresh` 语义、`topN` 默认、`SCAN_WINDOW=100`、缓存逻辑。
- alert-monitor（仅 1 次/分，非问题源）。

## 风险

- 限速让扫描变慢（300 请求 ~30s）。若用户接受慢扫描换取稳定，可接受；`minInterval` 做成常量便于调整。
- 418 重试 2 次 + 长退避，最坏情况下单扫描可能拖到 ~1-2 分钟。超上限才抛错，保持失败可见而非无限挂起。
