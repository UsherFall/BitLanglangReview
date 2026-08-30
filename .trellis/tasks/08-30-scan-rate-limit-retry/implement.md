# 币安扫描限流与重试优化 — 执行计划

## 步骤

1. [x] **`src/server/coin-scan-service.ts` 加限速**
   - 加 `createRequestPacer`（模块级共享 `scanPacer`，min-interval 100ms + jitter 50ms）。
   - `SCAN_CONCURRENCY` 10 → 5。
   - `scanShrink` mapper 顶部 `await scanPacer.pace()`。
2. [x] **`src/server/http.ts` 加重试**
   - 抽 `fetchJsonWithRetry(url, fetchImpl)`，429/418 指数退避 + Retry-After 尊重 + 抖动，`maxAttempts` 上限（429:4 / 418:3）。
   - `defaultFetchJson` / `defaultBinanceFetchJson` 改走 `labeledFetch` → `fetchJsonWithRetry`。
3. [x] **单测**
   - `tests/http-retry.test.ts`：429（含 Retry-After）重试后成功；418 长退避后成功；超上限抛错；非 429/418 立即抛错；OK 直接返回。
   - `tests/request-pacer.test.ts`：pace 间隔 ≥ minInterval；并发 burst 串行化。
   - 现有 `coin-scan-service` / `binance-candles` / `binance-tickers` 测试全绿。
4. [x] **验证**
   - `npx tsc --noEmit` 通过。
   - `npm test` 全绿（37 文件 / 187 测试）。
5. [x] **官方文档校调**（Binance 2400 weight/min/IP，klines@limit=100 权重 1~2，418 封禁期重试会延长）
   - `SCAN_MIN_INTERVAL_MS` 100 → 50（~20 req/s，300 请求 ~15s，仅用预算一小部分）。
   - 418 策略改为尊重 Retry-After / 等满封禁期后**只试一次**，仍封即抛（不锤 API 避免延长封禁）；Retry-After 推广到所有可重试状态。
   - 新增测试：418 尊重 Retry-After 恢复成功；持续 418 只恢复一次即放弃。
6. [x] **data.zip / data/ 不进仓库**
   - `.gitignore` 加 `data/` + `data.zip`。
   - `git rm --cached data.zip`（本地文件保留，解除跟踪）。
   - 彻底清远程历史（重写 + force push）待用户决定。

## 验证命令

- `npm test`
- 若有 lint：`npm run lint`（确认存在再跑）

## 审查门

- 代码 review：限速不改变结果；重试不改变 502 语义；OKX 路径行为合理。
- PRD 验收标准逐条核对。

## 回滚点

- 单文件小改动，`git checkout -- src/server/http.ts src/server/coin-scan-service.ts` 即可回滚。
- 重试/限速常量集中在文件顶部，调参方便。
