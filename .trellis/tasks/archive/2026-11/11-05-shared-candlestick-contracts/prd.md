# 共享响应与 Candlestick 纯契约

## Goal

把跨 UI/Server 的 Session 与队列/Library 响应类型、nominal timeframe duration、timestamp Candlestick 合并规则收进 `src/domain` 中性纯 Module，消除重复和漂移，同时保持所有 wire、存储和图表行为。

## Background

- 父任务地图 #7，也是最后一个代码交付项；#1–#6 已完成。
- 精确重复清单和兼容约束见 `research/current-state.md`。

## Requirements

- **R1 — Session 类型单一来源。** `domain/free-replay-session.ts` 定义 Start/Payload/Session；UI Panel、App/hook 和 SessionStore 共享，明确 `updatedAt` 只存在于已保存 Session。
- **R2 — 响应类型共享。** `TradeResponse` 归 `domain/review-queue.ts`；Paper Round session/library response 归 `domain/paper-round.ts`；routes、UI 与 server derivation 实际使用这些类型，而不是只留下未采用的新定义。
- **R3 — 纯时间/合并规则。** `domain/candlestick.ts` 提供完整 `timeframeMs` 和泛型 `mergeCandles`；旧 UI/Server exports 可作为兼容 Adapter，但不得保留第二份实现。
- **R4 — 行为不变。** 1M 仍是 nominal 30 天，merge 仍按 timestamp last-write-wins 后升序；不改变 Candle Grid、closed-bar、venue、payload 字段或排序语义。
- **R5 — 直接验证。** 新纯函数测试覆盖全部 timeframe、排序/去重/泛型/输入不变性；现有 route、Store、UI 测试和 `tsc` 验证类型采用与兼容。
- **R6 — 质量与规范。** focused、全量可运行测试、类型和 diff 检查通过；domain spec 写明 signatures、错误/边界行为和禁止模式。

## Acceptance Criteria

- [x] `src/domain` 是唯一实现 owner，且无 React/Vite/SQLite/fetch 依赖；UI/Server 兼容 re-export 不复制逻辑。
- [x] Session 的 Start/Payload/Session、TradeResponse、Paper Round Library 响应在 UI 与 Server 真实共用，SessionStore 返回类型准确包含 `updatedAt`。
- [x] `timeframeMs` 全值一致，`mergeCandles` 保留泛型、last-write-wins、升序和输入不变性；没有第二份同名实现。
- [x] API payload、存储反序列化、Candle Grid/closed-bar 和所有现有测试行为不变。
  - 证据：Store 以 `<unknown, string>` 显式保留 opaque 旧 JSON，UI 保持严格默认泛型；focused 13 文件 / 97 tests，类型采用检查通过。
- [x] focused tests、全量可运行测试、`npx tsc --noEmit`、`git diff --check` 通过；既有 parity fixture 失败单独记录。
  - 证据：全量可运行 84 文件 / 725 tests；类型与 CRLF-aware diff 检查通过。原始 `npm test` 仅同一缺 pool fixture suite 无法加载。
- [x] domain spec、父地图与验收记录更新，独立提交并归档，随后执行父任务最终集成验收。

## Out of Scope

- 统一不同 venue 的 Candle Grid、日历月、closed-bar 或扫描规则。
- 改变 merge key、API 字段、数据库 schema 或引入运行时 validator 框架。
- 重写 App/路由/Store 或新增全局状态；这些是已完成子任务的边界。
