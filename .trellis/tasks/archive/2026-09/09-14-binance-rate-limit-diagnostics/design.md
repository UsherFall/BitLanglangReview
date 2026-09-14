# Design — 币安限流诊断埋点

## 架构与边界

改动落在两层，边界清晰：

| 层 | 文件 | 职责 |
| --- | --- | --- |
| server | `src/server/http.ts` | 权重头观测 + 日志输出（本任务唯一的行为新增点） |
| server | `src/server/app-plugin.ts` | `/api/candles` 已返回 `{ error }`，**无需改动**（确认项，见下） |
| ui | `src/ui/candle-fetch.ts`（新增） | 统一的 K 线请求封装，区分「服务端给出的原因」与「网络层失败」 |
| ui | `src/ui/App.tsx`、`src/ui/OtherCoinChart.tsx` | 6 个调用点改用封装，失败文案透出服务端原因 |

`http.ts` 是全项目所有市场数据出站请求的唯一收口（币安 klines/ticker/exchangeInfo + OKX），因此本任务的**核心风险集中在这一点**：新增必须纯增量，不得触碰 `RETRY_BY_STATUS`、`retryDelayMs`、`waitOutGate`、`createRateGate`、`createRequestPacer` 的任何现有语义。

## 数据流与契约

### 权重观测（server）

新增一个与 `createRateGate` 同构的模块级监视器，沿用项目既有风格（工厂函数 + 模块单例）：

```ts
export type WeightLogSink = (message: string) => void;

export type WeightMonitor = {
  /** 记录一次响应的 per-IP 权重观测值（无该头时无操作）。 */
  observe(usedWeight: number | null): void;
  /** 记录一次限流事件（429/418），无论是否跨步长都输出。 */
  recordLimit(status: number, usedWeight: number | null, retryAfterSeconds: number | null): void;
};

export function createWeightMonitor(sink: WeightLogSink = console.warn, step?: number): WeightMonitor;
export const binanceWeightMonitor: WeightMonitor;
```

契约细节：

- **头名**：`x-mbx-used-weight-1m`（undici `Headers.get` 大小写不敏感）。解析失败/缺失 → `null`。
- **高水位**：内部 `maxObserved`，单调不减，跨进程重启重置（本任务不做持久化，见 Out of Scope）。
- **阈值触发**：仅当 `Math.floor(usedWeight / step) > Math.floor(maxLogged / step)` 时输出，随后 `maxLogged` 前移。`step = 0` 时完全关闭高水位日志。
- **`step` 来源**：`process.env.BINANCE_WEIGHT_LOG_STEP`，默认 200；非有限数或负值回落默认。
- **本进程权重上限**：`Math.round(60000 / BINANCE_MIN_INTERVAL_MS)` = 545 req/min，乘以 klines 权重 **2** → **≤1090 weight/min**；对照官方 `REQUEST_WEIGHT` 限额 **2400/min**（已取证，见 `research/binance-rate-limits.md`）。jitter 只增大实际间隔，故这是一个**上界**，文案用 `≤`。
- **日志文案**（统一前缀 `[binance]`）：

  ```
  [binance] used-weight-1m high-water=<N> (本进程权重上限 ≈≤1090/min; 限额 2400/min)
  [binance] HTTP <status> used-weight-1m=<N> retry-after=<S>s
  ```

  限流行中 `used-weight-1m` / `retry-after` 缺失时分别输出 `unknown`，不省略字段（便于 grep 固定列）。

### 接线点

`fetchJsonWithRetry` 增加**可选第 4 参数**，与既有可选 `gate` 参数同构，保持可注入以便测试：

```ts
export async function fetchJsonWithRetry(
  url: string,
  fetchImpl: FetchImpl,
  gate?: RateGate,
  monitor: WeightMonitor = binanceWeightMonitor,
): Promise<unknown>
```

- 每次拿到响应后（**OK 与非 OK 都要**，418 响应本身也带该头）调用 `monitor.observe(parseWeight(response.headers))`。
- 命中 `RETRY_BY_STATUS`（429/418）时额外调用 `monitor.recordLimit(status, usedWeight, retryAfterSeconds)`，位置在现有 `gate?.block(...)` 附近，确保限流行的权重与触发它的那次响应一致。
- OKX 路径不带该头 → `observe(null)` → 无操作。**不做「仅 Binance 才观测」的分支**：头名本身就是币安专属，缺失即无操作，比再加一个布尔开关更简单，也不会与 `gate` 的语义耦合。
- `defaultBinanceFetchJson` 无需改动（走默认 `monitor`）。

### 图表错误透出（ui）

新增 `src/ui/candle-fetch.ts`：

```ts
/** 服务端明确给出的失败原因（非 2xx 且响应体带 error）。 */
export class ServerCandleError extends Error {}

export async function fetchCandles(params: URLSearchParams): Promise<Candlestick[]>;
```

- 实现：`fetch` → `response.json()` → 非 2xx 时 `throw new ServerCandleError(body.error ?? \`HTTP ${status}\`)`，否则返回 `body.candles ?? []`。
- `fetch` 自身的 reject（网络层失败）**原样抛出**，不包装成 `ServerCandleError`。

调用点改造形态（6 处）：

```ts
fetchCandles(params)
  .then((candles) => { /* 原逻辑不变 */ })
  .catch((error) => setStatus(error instanceof ServerCandleError ? error.message : '<该处原有通用文案>'));
```

**关键**：fallback 必须是**该调用点原有的文案**（`K 线加载失败` / `后续 K 线加载失败` / `更早 K 线加载失败` / `没有拿到 K 线`），因此网络层失败时 UI 行为与今天完全一致。

`ServerCandleError` 这个类型存在的唯一理由是**区分两类失败**：网络层失败保留通用文案（`tests/app-free-replay.test.tsx:987` 断言依赖它），服务端失败显示真实原因。

### `/api/candles` 无需改动（确认项）

`app-plugin.ts` 的 `/api/candles` 已经在 catch 里 `send(res, 502, { error: error.message })`，且 `defaultBinanceFetchJson` → `labeledFetch` 会把原因包成 `Binance request failed: HTTP 418 (...)`。因此**服务端侧无需改动**，缺的只是 UI 丢弃了它。

## 关键取舍

1. **对照官方限额输出，而非只看观测值绝对值**。官方 `REQUEST_WEIGHT` = 2400/min 已从 Wayback 快照取证（`research/binance-rate-limits.md`），因此日志可同时给出「观测到的 per-IP 权重」与「自身权重上限 ≤1090」，两者对照直接回答问题。注意快照为 2024-12-06，数值建议复核。
2. **高水位 + 步长触发，而非逐请求日志**。一次扫描 300+ 请求，逐条打印会淹没终端。步长把日志压成一条可读的阶梯。
3. **console 作为唯一存储**。用户已明确选择「仅 console」，不引入端点/面板/落盘。代价是只能靠 scrollback 回看，若日后需要事后分析，可另开任务做持久化。
4. **不 drain 共享 warnings 数组**。见 PRD R4 的偏离说明：`takeWarnings()` 是单槽位，图表若也消费会抢走扫描/热度的警告。
5. **可注入 monitor 而非 spy console**。与既有 `gate` 注入模式一致，测试既能断言又不会产生日志噪声。

## 兼容性

- `fetchJsonWithRetry` 新增的是**可选尾参**，现有 9 个用例的调用签名不变；只有断言日志的用例需要显式传捕获 sink。
- `BINANCE_MIN_INTERVAL_MS` / jitter / `binanceRatePacer` / `binanceRateGate` / `RETRY_BY_STATUS` **零改动**。
- `BINANCE_WEIGHT_LOG_STEP` 未设置时行为即默认（步长 200），无需任何配置迁移。
- UI 侧：网络层失败的展示文案逐字不变，服务端失败的文案从通用改为具体原因。

## 风险与回滚

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| `http.ts` 是全量出口，改坏影响所有数据源 | 本任务只做增量：新增参数 + 新增 observe/recordLimit 调用 | 不改任何现有分支；`tests/http-retry.test.ts` + `tests/binance-*.test.ts` + `tests/request-pacer.test.ts` 作为回归网 |
| 日志噪声 | 步长过小会刷屏 | 默认 200；可用 `BINANCE_WEIGHT_LOG_STEP=0` 完全关闭 |
| 测试输出被 warn 污染 | 现有 429/418 用例会触发默认 `console.warn` | 这些用例显式传捕获 sink；新增专用测试文件断言行为 |
| UI 改动误伤既有断言 | `tests/app-free-replay.test.tsx:987` 依赖通用文案 | 用 `ServerCandleError` 区分，网络层失败走 fallback，断言不变 |

**回滚点**：改动集中在 4 个文件（`http.ts`、新增 `candle-fetch.ts`、`App.tsx`、`OtherCoinChart.tsx`）。monitor 是纯增量，若需回滚 server 侧只需还原 `http.ts` 即可让日志静默；UI 侧还原两个组件与新增文件即可恢复原文案。

## 待核实项（不阻塞本任务）

- **取证已补上**：官方数值来自 2024-12-06 的 Wayback 快照（live 站点受 AWS WAF 保护，curl 无法直取），详见 `research/binance-rate-limits.md`。快照距今约 21 个月，**数值建议复核**；机制性描述（418 成因与递增）长期稳定。
- `.trellis/spec/server/market-data.md` 的 Error Handling 一节把 418 描述为「等满 Retry-After 后重试一次」，这实际只描述了**无 gate 的 OKX 路径**；带 gate 的币安路径是 fail-fast（`http.ts:163-166`）。属既有 spec 与代码的措辞偏差，建议在 3.3 步骤一并校正（本任务不强制）。
- `src/server/http.ts:120-127` 的注释称「418 是 REQUEST RATE 触发，不只是 weight 窗口」。按官方文档，触发面就是 weight（无独立请求速率限制被记载）；旧的 50ms 配置 → 1200 req/min × 权重 2 = 2400/min 正好触顶才是真因。建议在 3.3 一并校正该注释。
