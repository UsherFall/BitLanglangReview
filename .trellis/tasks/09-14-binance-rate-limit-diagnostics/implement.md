# Implement — 币安限流诊断埋点

前置：`prd.md`（需求与验收）+ `design.md`（技术设计）。本文件只写执行顺序与验证。

## 执行清单

按顺序执行，每步可独立验证。

### 1. server：权重观测器（`src/server/http.ts`）

- [ ] 新增常量与推导：`BINANCE_WEIGHT_LOG_STEP`（env 读取，默认 200）、本进程权重上限（`Math.round(60000 / BINANCE_MIN_INTERVAL_MS)` × klines 权重 2 ≈ 1090）与官方限额常量 2400。
- [ ] 新增头名常量 `x-mbx-used-weight-1m` 与解析函数（`Headers.get` → `Number`，非有限数/缺失 → `null`）。
- [ ] 新增 `WeightLogSink` / `WeightMonitor` 类型、`createWeightMonitor(sink, step?)` 工厂、`binanceWeightMonitor` 模块单例。内部维护 `maxObserved` 与 `maxLogged`；`observe` 做步长跨越判断，`recordLimit` 无条件输出。
- [ ] `fetchJsonWithRetry` 追加**可选第 4 参数** `monitor: WeightMonitor = binanceWeightMonitor`；在拿到响应后调用 `observe(...)`；在 `RETRY_BY_STATUS` 命中分支调用 `recordLimit(...)`。
- [ ] **自检**：不修改 `RETRY_BY_STATUS`、`retryDelayMs`、`waitOutGate`、`createRateGate`、`createRequestPacer`、`binanceRatePacer`、`binanceRateGate`、`defaultBinanceFetchJson` 的任何现有语句。

### 2. 回归既有 http 测试（`tests/http-retry.test.ts`）

- [ ] 为触发 429/418 的用例显式传入静默 monitor（`createWeightMonitor(() => {})`），避免测试输出被 warn 污染。
- [x] 确认 9 个用例全部保持通过、断言不变（实际 9 例，非 11）。

### 3. 新增 server 测试（`tests/binance-weight-monitor.test.ts`）

- [ ] AC1：跨步长首次观测输出恰好一行；断言 sink 收到的文案含 `high-water=`、`本进程权重上限` 与 `2400`。
- [ ] AC2：同一步长内重复观测（含回落到更低值）不再输出；断言 sink 调用次数为 1。
- [ ] AC3：`recordLimit(429/418, ...)` 无论步长都输出，文案含状态码、权重、`retry-after=`。
- [ ] AC4：`observe(null)` 与不含该头的响应不产生任何输出、不抛错。
- [ ] AC5：`createWeightMonitor(sink, 0)` 时 `observe` 静默但 `recordLimit` 仍输出；不传 sink 时默认 sink 为 `console.warn`（可用 spy 断言，注意还原）。
- [ ] 补充一条端到端：`fetchJsonWithRetry` 注入捕获 monitor + 模拟带 `x-mbx-used-weight-1m` 的 418 响应，断言 `recordLimit` 被调用且权重取自该响应。

### 4. ui：K 线请求封装（`src/ui/candle-fetch.ts`，新增）

- [ ] 导出 `ServerCandleError` 与 `fetchCandles(params: URLSearchParams): Promise<Candlestick[]>`。
- [ ] 非 2xx → `throw new ServerCandleError(body.error ?? \`HTTP ${status}\`)`；OK → 返回 `body.candles ?? []`。
- [ ] 网络层 reject 原样抛出（不包装）。

### 5. ui：改造 7 个调用点（App.tsx 5 处 + OtherCoinChart.tsx 2 处）

- [x] `src/ui/App.tsx` 共 5 处：`~1171`（initial / FreeReplay，fallback `K 线加载失败`）、`~1289`（later，fallback `后续 K 线加载失败`）、`~1328`（earlier，fallback `更早 K 线加载失败`，`try/catch`）、`~1617`（initial / workbook，fallback `K 线加载失败`）、`~1795`（earlier/later，fallback `K 线加载失败`，`try/catch`）。
- [x] `src/ui/OtherCoinChart.tsx` 共 2 处：`~100`（initial，fallback `K 线加载失败`）、`~188`（earlier/later，fallback `K 线加载失败`）。
- [ ] 每处 catch 统一为 `error instanceof ServerCandleError ? error.message : '<该处原有文案>'`。
- [ ] **自检**：逐个确认 fallback 文案与该处改动前的字符串**逐字一致**。

### 6. 新增 ui 测试（`tests/candle-fetch.test.ts`）

- [ ] AC7：mock 非 2xx + `{ error: 'Binance request failed: HTTP 418 ...' }` → `fetchCandles` 抛 `ServerCandleError` 且 message 为服务端文案。
- [ ] AC8：mock fetch reject → 抛出**非** `ServerCandleError`（保证调用点走 fallback 通用文案）。
- [ ] 非 2xx 且无 `error` 字段 → message 回落 `HTTP <status>`。
- [ ] 2xx 且无 `candles` → 返回 `[]`。

### 7. 更新 spec（`.trellis/spec/server/market-data.md`）

- [ ] 在 Error Handling / Shared request-rate budget 附近补一段「权重可观测性」契约：头名、高水位步长、env 开关、日志格式、以及「本进程上限由 `BINANCE_MIN_INTERVAL_MS` 推导、不硬编码币安上限」的理由。
- [ ] 可选校正：该文件把 418 描述为「等满 Retry-After 后重试一次」，实际带 gate 的币安路径为 fail-fast（`http.ts:163-166`）。若校正，保持与 `http.ts` 注释一致。

## 验证命令

```bash
# 全量回归（项目既有 265 测试必须全绿）
npm test

# 类型检查（项目无 typecheck 脚本，直接调 tsc）
npx tsc --noEmit

# 聚焦验证
npx vitest run tests/http-retry.test.ts tests/binance-weight-monitor.test.ts tests/candle-fetch.test.ts tests/app-free-replay.test.tsx tests/request-pacer.test.ts
```

## 验收对照

| AC | 覆盖位置 |
| --- | --- |
| AC1 / AC2 | 步骤 3（`tests/binance-weight-monitor.test.ts`） |
| AC3 | 步骤 3（`recordLimit` 用例 + 端到端用例） |
| AC4 | 步骤 3（`observe(null)` 用例） |
| AC5 | 步骤 3（`step=0` 与默认 sink 用例） |
| AC6 | 步骤 2 + `npm test` |
| AC7 | 步骤 6（`tests/candle-fetch.test.ts`） |
| AC8 | 步骤 6 + `tests/app-free-replay.test.tsx:987` 保持通过 |
| AC9 | `npm test`（`tests/request-pacer.test.ts`、`tests/binance-*.test.ts`） |

## 风险文件与回滚点

- **高风险**：`src/server/http.ts` —— 全部市场数据出口的收口。只做增量；任何涉及现有分支语义的改动都必须停手重评。
- **中风险**：`src/ui/App.tsx` —— 4 个调用点分散在 1000+ 行的组件里，改动前先定位精确行号，逐处核对 fallback 文案。
- **回滚**：server 侧还原 `http.ts` 即静默；UI 侧还原 `App.tsx` + `OtherCoinChart.tsx` 并删除 `candle-fetch.ts` 即恢复原文案。两侧互不依赖，可分别回滚。

## task.py start 前的复查项

- [ ] `prd.md` 无残留 TBD / Open Questions
- [ ] `design.md`、`implement.md` 已就位
- [ ] `implement.jsonl`、`check.jsonl` 均已填入真实 spec 条目（非空、非 `_example` 占位）
- [ ] 用户已对最终规划摘要给出**显式**实施批准
