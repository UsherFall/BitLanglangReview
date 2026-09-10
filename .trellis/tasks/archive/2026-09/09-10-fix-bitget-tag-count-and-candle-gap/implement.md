# Implement

## 前置

- 先读 `.trellis/spec/server/market-data.md`（Binance 源语义与缓存命名空间）、`.trellis/spec/server/market-heat.md`（完成 bar 守卫）、`.trellis/spec/server/api-plugin.md`、`.trellis/spec/frontend/state-management.md`。
- 顺序：先做缺陷 2（服务端，纯函数、可单测），再做缺陷 1（跨前后端契约）。

## Checklist

### A. 缺陷 2：入场 K 线（方案 A）

- [ ] A1 `src/server/binance-candles.ts`：`earlier` 过滤 `candle.timestamp + step <= request.anchor` → `candle.timestamp < request.anchor`；更新该段注释。
- [ ] A2 `src/server/binance-candles.ts`：新增 `coversAnchorBar(request, cached)`（`earlier` 时要求最新缓存 bar `>= boundaryAnchor(anchor - 1, timeframe)`），并加入缓存命中条件。
- [ ] A3 `src/server/market-heat-service.ts`：`heatRowFromCandles` 的完成 bar 守卫由 `last.timestamp + step > anchor → return null` 改为 `filter(timestamp + step <= anchor)`，后续逻辑基于过滤后的数组；更新注释。
- [ ] A4 确认 `endTime = anchor - 1`、`later` 起点、`contiguousCandles` floor 种子均不改。
- [ ] A5 确认 `src/server/candlestick-service.ts`（OKX）与 `coin-scan-service.ts` 不改。

### B. 缺陷 1：标签笔数（服务端 → 前端）

- [ ] B1 `src/server/app-plugin.ts` `POST /api/reviews`：解析 `module`；保存后 `send(res, 200, { review, ...tagPayload(reviewStore, scopedReviewsForModule(parsed.module)) })`。
- [ ] B2 `src/ui/ReviewEditor.tsx`：新增 `module: 'trade' | 'bitget'` prop；导出 `SavedReviewPayload` 类型；`saveReview` 请求体带 `module`，解析 `{ review, tags, tagCounts }`，`setDraftTags(review.tags)`，`onSaved(payload)`。
- [ ] B3 `src/ui/App.tsx`：
  - [ ] B3.1 `handleReviewSaved(payload: SavedReviewPayload)`：设置 `tags` / `tagCounts`，并把匹配 trade 的 `review` 换成 `payload.review`。
  - [ ] B3.2 `toggleStarred`：POST 带 `module`，用返回 payload 调用 `handleReviewSaved`。
  - [ ] B3.3 渲染 `ReviewEditor` 处传 `module={reviewMode === 'bitget' ? 'bitget' : 'trade'}`。

### C. 测试

- [ ] C1 `tests/binance-candles.test.ts`：
  - 新增：非边界 anchor（`anchor` 落在 bar 内）时 `earlier` 返回 anchor 所在 bar。
  - 新增：缓存已有 `limit` 根但最新停在 C-step 时，`earlier` 会补取并返回 C。
  - 既有恰边界用例（`:83-94`）保持通过；如测试名与新语义不符则改名。
- [ ] C2 `tests/market-heat-service.test.ts`：新增「candle 列表含 anchor 所在 bar 时仍产出读数（不判 null）」用例。
- [ ] C3 `tests/review-editor.test.tsx`：`/api/reviews` mock 改为 `{ review, tags, tagCounts }`；断言 `onSaved` 收到新 payload。
- [ ] C4 `tests/app-tag-management.test.tsx`：mock 改为新结构并让 `/api/reviews` 变更 `state.trades`；新增「保存后下拉 `N 笔` 即时更新」与「标签归零后从下拉消失」用例。
- [ ] C5 `tests/app-bitget-mode.test.tsx`、`tests/app-review-progress.test.tsx`：同步 `/api/reviews` mock 到新结构。

### D. 验证

- [ ] D1 `npm test` 全绿。
- [ ] D2 `npx tsc --noEmit` 无类型错误。
- [ ] D3 人工端到端：`npm run dev`，切到「个人交割单复盘」选中 WLD 的 `2026-06-16T07:21:51Z` Trade，在 15m/1H/4H/1D 下确认入场处无缺口（AC5/AC6）。
- [ ] D4 人工端到端：给该 Trade 新增标签并保存，确认下拉笔数立即变为实际值；再移除，确认笔数回落/标签消失（AC1–AC3）。
- [ ] D5 人工抽查「市场热度」面板仍能算出读数（未被 C 污染）。

## 风险点 / 回滚点

- 最高风险：A2 的缓存完整性判定与 A3 的热度守卫。若热度或选币出现「无数据/空结果」回归，优先查 A3 是否已生效。
- 回滚点：A 与 B 可独立回滚。A 回滚后缓存中多出的 C 行无害。

## 完成后

- Phase 3.3 更新 `.trellis/spec/server/market-data.md`：Binance `earlier` 语义改为与 OKX 一致（`timestamp < anchor`，包含 anchor 所在 bar）、新增缓存完整性判定说明、移除「Binance 提前丢弃未收盘 bar」的旧描述；并在 `market-heat.md` 记录守卫已改为过滤。
