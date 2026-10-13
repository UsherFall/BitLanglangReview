# Design — 选品扫描取数容错

## 1. 边界与落点

改动只落在 4 处，均在既有契约内扩展，不引入新抽象层：

| 文件 | 改动 |
| --- | --- |
| `src/server/coin-scan-service.ts` | 两阶段 mapper 内隔离失败；收集失败集；fatal 判定；写响应字段 |
| `src/domain/coin-scan.ts` | `ScanResponse` 新增可选 `failedInstruments?: string[]` + 注释 |
| `src/server/http.ts` | 无逻辑改动（见 §2 fatal 判定，仅复用既有 `RateGate.reason()`） |
| `src/ui/CoinScanPanel.tsx` | `CoinScanResults` 头部新增一条提示行（复用 `.coin-scan-skip-hint`） |

不改 `mapLimit` 本身。`mapLimit` 的"一个失败全体失败"是 `Promise.all` 的通用语义，
把它改造成"吞掉所有错误"会让它成为隐性容错原语；容错策略属于扫描服务，留在调用点最清楚。

## 2. Fatal 判定：418

被隔离的错误里必须区分"这一个标的坏了"和"整个 IP 被禁了"。后者继续发请求只会延长封禁
（`http.ts:326-340` 的 `waitOutGate` 注释已写明这条设计），所以必须整体中止。

判定用 **gate 状态**，不用错误字符串匹配：

- `fetchJsonWithRetry` 在 418 时先 `gate.block(..., '418', ...)` 再抛错（`http.ts:313-316`），
  `waitOutGate` 在 gate 已封禁时直接抛错（`http.ts:336-338`）——两条路径下 **catch 时 gate 状态都已是 '418'**。
- `CoinScanService` 已经注入同一个 gate 实例（`app-plugin.ts:95-106`），只需把注入类型从
  `Pick<RateGate, 'takeWarnings'>` 放宽到 `Pick<RateGate, 'takeWarnings' | 'reason'>`。
- 备选方案（从 `http.ts` 导出一个类型化 `IpBanError` 并 `instanceof` 判定）被否：
  要多改一条公共错误词汇表，而 gate 已是权威状态且零新增 API。字符串匹配 `startsWith('HTTP 418')`
  同样被否——文案一改就静默失效。

429 处于退避态时 `reason()` 返回 `'429'` → 非 fatal → 该请求按失败隔离，后续请求在
`waitOutGate` 里正常等待退避结束，符合既有"429 只是暂停"的契约。

## 3. 淘汰语义

**Stage 1**（`coin-scan-service.ts:120-136`）：mapper 失败时返回 `completed: null`。

```
coarseFetches = mapLimit(candidates, 5, async ticker => {
  try { return { ticker, completed: await completedCandles(ticker, '1D', ...) } }
  catch (e) { if (isFatal(e)) throw e; failed.add(ticker.instrument); return { ticker, completed: null } }
})
measures = coarseFetches.map(({completed}) => completed === null ? null : coarseStructure(completed, ...))
```

这正是既有"窗口不足"路径的形状：`coarseStructure` 返回 `null` 的成员**不进池基数 N 且永不 pass**
（spec `coin-scan.md`「No full window ⇒ excluded, silently」）。所以 Stage 1 失败不需要新的
判定分支，只需要它别把整轮带走。代价是它**静默**——由 `failedInstruments` 补偿（要求 R2）。

**Stage 2**（`coin-scan-service.ts:133-136`）：失败即把该标的计入 `failed` 集；构造行时
`if (!passes[index] || failed.has(ticker.instrument)) continue;`。

为什么整行淘汰而不是给那一格填 `neutralStructure()`：`neutralStructure()` 是"该周期没有收敛结构"
的**判定结果**，而不是"没拿到数据"。用判定结果顶替取数失败会让 `convergedTimeframes` /
`qualifiedCount` / `bestScore` / 排序全部基于残缺输入，属于静默错误；而整行淘汰是可解释的遗漏，
且被 `failedInstruments` 明确报出来。

失败集用 `Set<string>`（按 instrument 去重）：同一标的的 4 个周期可能都失败。

## 4. 汇报

- `ScanResponse.failedInstruments?: string[]` — 与 `skippedInstruments` 同款 omit 语义（空则不出现），
  同样只在服务层组装，域层只是类型。
- UI：`CoinScanResults` 头部在 `skippedInstruments` 提示之后追加一条
  `<p className="coin-scan-skip-hint" title={names.join(', ')}>已跳过 N 个取数失败标的:{names}</p>`，
  复用 `formatSkippedNames`。**不改** grid 结构（`.detail-header` 仍是 2 个顶层子元素之一），
  沿用既有测试断言。
- 不进 `warnings`：`warnings` 的既有含义是"限频退避"（rate-gate 通道），取数失败是池级遗漏，
  与 `skippedInstruments` 同类。

## 5. 兼容与回滚

- 纯加法：新字段可选，旧客户端/旧测试不受影响；`/api/scan` 的 400/405/502 矩阵不变。
- 回滚 = 还原 4 个文件；无数据迁移，无持久化状态。

## 6. 测试策略

在 `tests/coin-scan-service.test.ts` 既有 20 名池 harness 上加用例，
`Source` 夹具已支持按 (标的, 周期) 注入行为，只需让其抛错：

- Stage 1 抛错的那个标的被淘汰、其余行与对照一致（AC1）。
- Stage 2 抛错 → 整行消失 + 计入 `failedInstruments`（AC2）。
- gate 为 418 → rejects（AC3）；用 `reason: () => '418'` 的假 gate 注入（与既有
  `{ takeWarnings }` 假 gate 同款写法，需同步更新该处注入）。
- `failedInstruments` 空则字段不存在（AC4）。
- `tests/coin-scan-results.test.tsx` 加一条头部提示断言（AC5）。

## 7. 明确不做

- 不加自动重试、不加退避、不改 `REQUEST_TIMEOUT_MS`（用户选择 A 方案）。
- 不加失败率 / 连续失败熔断（用户已否决 C 方案；风险记在 PRD「Known residual」）。
- 不改 `MarketHeatService`。
