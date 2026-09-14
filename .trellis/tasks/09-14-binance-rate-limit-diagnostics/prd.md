# 币安限流诊断埋点：权重头可观测 + 418 留痕

## Goal

币安 418（IP 级自动封禁）在长时间运行后反复发生，但程序目前**没有任何可观测能力**来判定成因。本任务补齐最小诊断能力，让「共享出口 IP」与「自身请求超限」两个假设可以用数据区分，而不是靠猜。

本任务只补可观测性，**不改变现有 110ms 限速行为**。

## Background（已确认事实，均带代码锚点）

### 现场证据

用户实测报错原文：

```
Binance request failed: HTTP 418 (Binance IP auto-banned; retry after ~1659s)
```

- 出现时机：程序跑一段时间之后
- 触发操作：**全部是拉 K 线**（没有扫描/热度的异常放大）
- 网络环境：使用 Clash 节点
- 无其他币安客户端同时运行

### 从这条报错可推出的硬结论

1. 该文案出自 `src/server/http.ts:185`（`waitOutGate` 的 fail-fast 分支）。它只在 **gate 已被更早一次 418 置位之后**才可能抛出，即程序已进入封禁停摆，这条是后续请求撞上已关闭的闸门。
2. `1659s` **只可能来自币安返回的 `Retry-After` 响应头**。418 的兜底退避上限是 180s —— `http.ts:62` 配置 `baseDelayMs: 120_000, maxDelayMs: 120_000`，`http.ts:205-206` 计算为 `base + Math.random() * (base / 2)`，即 120s + 最多 60s 抖动 = 最大 180s。`1659s` 远超该上限，因此必然走了 `http.ts:203-204` 的 `Retry-After` 分支。
3. 结论：**币安明确判定该 IP 需要封禁 ≥ 1659s（约 27.6 分钟）。**
4. 首次 418 的封禁从 **2 分钟**起，只有反复触发才递增（`http.ts:72-75` 注释；`.trellis/spec/server/market-data.md` 的 Error Handling 一节）。因此：**在该程序第一次撞到 418 之前，这个 IP 就已经处在被反复触发过的高等级封禁里了。** 一个从零开始、稳定 9 req/s 的进程不可能作为首次触发生成 28 分钟的 ban。

### 现有能力盘点

- 请求节流：`binanceRatePacer`（`http.ts:136-138`，`BINANCE_MIN_INTERVAL_MS = 110`、jitter 15ms ≈ 9 req/s），挂在 `defaultBinanceFetchJson`（`http.ts:226-231`）——klines / ticker24hr / exchangeInfo 三个出口的唯一收口。
- 全局闸门：`binanceRateGate` 为**模块级内存态**（`http.ts:104`，`createRateGate` 内部 `let until = 0`），进程重启即失忆。
- 响应头消费：**全项目只读了一个头** —— `retry-after`（`http.ts:203`，全项目唯一一处 `headers.get`）。`X-MBX-USED-WEIGHT-1M` **从未被读取**。
- 服务端留痕：`src/server` 内**没有任何 `console.` 调用**。418 只进内存 warnings 数组。
- warnings 消费路径：只有 `coin-scan-service.ts:141` 与 `market-heat-service.ts:145` 调 `takeWarnings()`。`/api/candles`（图表拉 K 线）**从不消费 warnings**，撞 418 时 UI 只显示通用文案（`src/ui/App.tsx:1179` / `:1636` / `src/ui/OtherCoinChart.tsx:123`），502 响应体里的 error 文案被丢弃。

### 待验证的假设（本任务要产出的证据）

- **H1 共享出口 IP**：Clash 机场节点出口 IP 被多人共用（或该机房 IP 被币安重点关照），ban 等级由他人流量推高，本地 9 req/s 只是零头。
- **H2 自身流量超限**：9 req/s 仍高于币安对该 IP 的实际阈值。
- **H3 自身历史触发累积**：gate 内存态导致重启后立刻重新发请求，把 ban 逐级延长（2min → … → 28min）。

区分手段：`X-MBX-USED-WEIGHT-1M` 是 **per-IP** 的（官方原文：*"The limits on the API are based on the IPs, not the API keys."*）。自身权重占用约 960~1090 weight/min（约 2400 上限的 40%~45%，推算见 Technical Notes）。若日志显示的 per-IP 权重显著高于此，即存在同 IP 外部流量，H1 成立。

## Requirements

### R1 权重头观测

币安路径解析响应头 `X-MBX-USED-WEIGHT-1M`，在进程内维护高水位（high-water mark，单调不减）。响应不含该头时为无操作（OKX 路径自然不受影响）。

### R2 高水位阈值触发日志

高水位每跨过一个步长输出一行，包含当前高水位值、本进程权重上限（由 `BINANCE_MIN_INTERVAL_MS` 与 klines 权重 2 推导）以及 2400/min 的官方限额。步长默认 200，可通过环境变量 `BINANCE_WEIGHT_LOG_STEP` 调整；设为 `0` 关闭高水位日志。同一步长内重复观测不得重复输出。

### R3 限流事件留痕

收到 429 / 418 时，**无论是否跨步长**都输出一行，包含 HTTP 状态码、该响应的权重值、`Retry-After` 秒数。418 的 `Retry-After` 是判定 H1/H2/H3 的关键数字。

### R4 图表路径可见性

`/api/candles` 返回非 2xx 且响应体带 `error` 时，图表状态显示该服务端文案（例如 `Binance request failed: HTTP 418 (Binance IP auto-banned; retry after ~1659s)`），替代当前的通用「K 线加载失败」。

**实现方式偏离说明**：原选项措辞为「图表路径也消费 warnings」。实际不采用让 `/api/candles` 调 `takeWarnings()` 的做法 —— 该数组是**单一共享槽位**，扫描开头会清空它（`coin-scan-service.ts:49`）、结尾消费它（`:141`），图表是高频路径，若也去 drain 会**抢走扫描/热度的警告**。改为让图表直接呈现 502 的 `error` 文案，信息量等价且无争用。

### 日志格式约定

统一前缀 `[binance]` 便于过滤。两行形态：

```
[binance] used-weight-1m high-water=<N> (本进程权重上限 ≈≤1090/min; 限额 2400/min)
[binance] HTTP <status> used-weight-1m=<N> retry-after=<S>s
```

## Acceptance Criteria

- [x] AC1 币安响应带 `x-mbx-used-weight-1m` 时，进程内高水位单调不减；注入捕获 sink 可断言首次跨步长输出恰好一次，且文案含本进程权重上限与 2400 限额。
- [x] AC2 同一 200 步长内重复观测不产生重复日志（断言 sink 调用次数）。
- [x] AC3 收到 429 或 418 时，无论是否跨步长，都输出一行含状态码、权重、`Retry-After` 的日志。
- [x] AC4 响应不含该头时（OKX 路径）不产生任何日志，且不抛错。
- [x] AC5 未注入 sink 时默认写 `console.warn`；`BINANCE_WEIGHT_LOG_STEP=0` 时无高水位日志，限流事件日志仍保留。
- [x] AC6 `tests/http-retry.test.ts` 现有用例全部保持通过。
- [x] AC7 `/api/candles` 返回非 2xx 且带 `{ error }` 时，对应图表状态显示该 error 文案。
- [x] AC8 `/api/candles` 网络层失败（fetch reject）时，图表状态仍显示原有通用文案，`tests/app-free-replay.test.tsx:987` 的「后续 K 线加载失败」断言保持通过。
- [x] AC9 不改变 `BINANCE_MIN_INTERVAL_MS` / jitter / gate 语义；`tests/request-pacer.test.ts`、`tests/binance-*.test.ts` 保持通过。

## Out of Scope

以下为后续任务候选，本任务不做（用户选择「先加诊断埋点，用数据定性后再决定」）：

- 基于权重头的闭环自适应限速（接近阈值自动降速）
- `binanceRateGate` 持久化（重启后仍尊重 ban 窗口，对应 H3）
- 大 ban 自保策略（`Retry-After` 超阈值时长时间停摆并提示换节点）
- 调整现有 110ms / jitter 参数
- 权重样本落盘或历史留存（console 是唯一存储，靠 scrollback 回看）
- 切换或新增市场数据源（OKX 路径现状不变）

## Technical Notes

- 官方数值已取证，见 `research/binance-rate-limits.md`：`REQUEST_WEIGHT` = **2400 / 分钟**（per-IP）；klines 权重按 `LIMIT` 分档，`limit=100`（扫描 `SCAN_WINDOW`）与 `limit=150`（图表）均落在 **2**。
- 自身权重占用：pacer 110ms + jitter → 480~545 req/min × 权重 2 = **960~1090 weight/min**，约占 2400 的 **40%~45%**；叠加扫描期 `ticker/24hr`（权重 40，30s TTL）后峰值约 **1170 ≈ 49%**。
- 因此日志同时给出「观测到的 per-IP 权重」与「自身权重上限」，两者对照即可判断是否存在同 IP 外部流量。
- 历史对照：旧的 50ms 配置 → 1200 req/min × 权重 2 = **2400 weight/min，正好触顶**，这解释了 journal 记录的「50ms 时偶发 418」。
- **取证局限**：live 站点受 AWS WAF 保护，数值来自 2024-12-06 的 Wayback 快照，距今约 21 个月，建议复核。
