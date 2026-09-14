# 币安 USDS-M 合约限流规则（权威取证）

## 取证方式与可信度

- **live 站点不可直取**：`developers.binance.com` 与 `binance-docs.github.io` 现均受 **AWS WAF** 保护。curl 直取返回 `202` + 2KB 挑战页（`window.awsWafCookieDomainList = [...]`），无法通过。
- **实际来源**：Wayback Machine 快照
  `http://web.archive.org/web/20241206044723id_/https://binance-docs.github.io/apidocs/futures/en/`
- **快照时间**：**2024-12-06**。这是该路径下最后一份含真实正文的快照；2025-01-01 之后的快照都是约 1KB 的跳转桩（站点已迁移到 developers.binance.com）。
- **可信度**：正文为币安官方文档原文。但快照距今约 21 个月，**数值可能已变**，结论解读时建议复核。机制性描述（418 的成因与递增）长期稳定。

## 原文摘录（逐字）

### IP Limits 一节

> Every request will contain `X-MBX-USED-WEIGHT-(intervalNum)(intervalLetter)` in the response headers which has the current used weight **for the IP** for all request rate limiters defined.
>
> Each route has a `weight` which determines for the number of requests each endpoint counts for.
>
> When a 429 is received, it's your obligation as an API to back off and not spam the API.
>
> **Repeatedly violating rate limits and/or failing to back off after receiving 429s will result in an automated IP ban (HTTP status 418).**
>
> **IP bans are tracked and scale in duration for repeat offenders, from 2 minutes to 3 days.**
>
> **The limits on the API are based on the IPs, not the API keys.**
>
> It is strongly recommended to use websocket stream for getting data as much as possible, which can not only ensure the timeliness of the message, but also reduce the access restriction pressure caused by the request.

**要点**：418 的官方成因是「反复违反限流 和/或 收到 429 后不退回」。**没有**独立的「每秒请求数」限制被记载 —— 触发面是 weight。

### 权重上限（`rateLimits` / `Rate limiters (rateLimitType)`）

| rateLimitType | interval | limit |
| --- | --- | --- |
| `REQUEST_WEIGHT` | 1 MINUTE | **2400** |
| `ORDERS` | 1 MINUTE | 1200 |

`RAW_REQUEST` 仅在 enum 说明中被列举为**可能**的 rateLimitType，合约 `exchangeInfo` 的 `rateLimits` 里并未声明它，文档也未给出其 limit 值。

### 本项目实际调用的三个端点权重

| 端点 | 权重 | 本项目的调用形态 |
| --- | --- | --- |
| `GET /fapi/v1/klines` | 按 `LIMIT` 分档：`[1,100)`→**1**；`[100,500)`→**2**；`[500,1000]`→5；`>1000`→10 | 扫描 `SCAN_WINDOW=100` → **2**；图表 `limit:150` → **2** |
| `GET /fapi/v1/ticker/24hr` | **1**（带 symbol）；**40**（不带 symbol） | `binance-tickers.ts` 不带 symbol → **40**（有 30s TTL） |
| `GET /fapi/v1/exchangeInfo` | **1** | `binance-instrument-metadata.ts` → **1**（有 6h TTL） |

> **修正**：此前把 klines 权重按 `limit:100` 估为 1 是**错的**。`[100,500)` 是左闭区间，`limit=100` 落在 **2**。

## 由此得到的关键推算

### 当前配置（110ms）自身的权重占用

```
pacer 间隔 = 110ms + jitter(0~15ms)  → 实际 110~125ms
→ 起请求速率 = 8.0 ~ 9.09 req/s  = 480 ~ 545 req/min
× klines 权重 2
→ 自身权重 = 960 ~ 1090 weight/min
占 2400 上限的 40% ~ 45%
```

加上扫描期间的 `ticker/24hr`（40 权重 / 30s TTL → 最多 80/min）与 `exchangeInfo`（1 / 6h，可忽略）：

```
自身峰值 ≈ 1170 weight/min ≈ 2400 的 49%
```

### 历史事故（50ms）可以被完整解释

```
50ms 间隔 → 20 req/s → 1200 req/min × 权重 2 = 2400 weight/min
```

**正好等于 2400 的上限。** 这解释了 `.trellis/workspace/UsherFall/journal-1.md:779` 记录的「50ms 节流 ~20req/s 时偶发 418」—— 当时的配置不是「偏高」，而是**精确坐在限流线上**，必然间歇性触发 429，反复触发后升级为 418。

同时这也说明 `http.ts:120-127` 注释里「418 是 REQUEST RATE 触发，不只是 weight」的说法**不准确**：按官方文档，触发面就是 weight；50ms 时的 weight 恰好触顶才是真因。

## 对本任务的结论影响

1. **H2（自身流量超限）在 110ms 下基本可排除**（前提是出口 IP 干净）：自身约占 45%~49%，不足以独立触顶。
2. **H1（共享出口 IP）成为首要解释**：官方明确「limits are based on the IPs, not the API keys」，且 1659s 的 ban 属于「repeat offenders」的递增区间。自身只占约一半额度时，同 IP 上任何其他流量都能把总量推过 2400。
3. **H3（重启累积）仍可作为叠加因素**：gate 为内存态，重启后在 ban 窗口内继续发请求会按官方描述「scale in duration」继续延长。
4. **日志指标需要修正**：不应只报「req/min」，应报「自身权重/min ≈ ≤1090」并对照 2400，否则读者无法把观测值与真实额度联系起来。
5. 官方建议「尽量用 websocket 取数据」。本任务不涉及，但作为长期降载方向值得记录。
