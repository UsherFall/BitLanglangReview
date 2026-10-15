# Implement — 标注窗口扩到 1 年（含 Bitget 往前翻页能力）

## 执行清单

### 1. 能力层（`src/server`）
- [ ] `src/server/market-data.ts`：`CandleRequest` 加可选 `allowPaging?: boolean`（带 design §2 的注释，说明为何 opt-in）。
- [ ] `src/server/bitget-candles.ts`：
  - [ ] 常量：`BITGET_HISTORY_CANDLES_PATH = '/api/v2/mix/market/history-candles'`；`BITGET_PAGE_BARS = 90`。
  - [ ] 抽出私有 `requestPage(request, endTimeExclusive, path, limit)`：建 URL → `fetchJson` → 业务错误检查 → map/filter（沿用现有的剔未收盘规则）→ `store.save` → 返回本页根数。
  - [ ] `getCandlesticks`：保留现有"缓存命中即返回"与**非翻页路径原样不动**；`request.allowPaging` 为真时走 `fetchPaged`。
  - [ ] `fetchPaged`：按 design §3 —— 最新页走 `/candles`（`endTime = anchor - 1`），之后按 `oldest - 1` 用 `/history-candles` 往前；`have.length >= limit` 或空页即停；`MAX_PAGES` 护栏。
- [ ] **不动** 线上调用方（`coin-scan-service.ts` 等不传 `allowPaging`）。

### 2. 单测
- [ ] 新增 `tests/bitget-candles-paging.test.ts`（伪造 `fetchJson`，不触网）：
  - [ ] 每页 URL 含 `endTime`，且逐页严格前移（断言调用序列）。
  - [ ] 每页 `limit` ≤ 90。
  - [ ] 空页即停（次新币只发 1~2 次）。
  - [ ] 攒够 `limit` 即停（不多发）。
  - [ ] **历史页命中缓存后不再发请求**：先跑一次填满缓存，再以 `refresh: true` 跑第二次 → **只 1 次请求**（只有最新页）。
  - [ ] `allowPaging` 缺省时**只发 1 次请求**（R1.5 的回归保护）。
- [ ] 现有 `tests/bitget-candles.test.ts` 不改、必须全绿。

### 3. 工具层
- [ ] `tools/labeling/shared.ts`：加 `SlimBar`；`Snapshot` 增加 `history`；`candles` / `history` 都改 SlimBar；加 `toCandles(instrument, bars)` rehydrate 辅助。
- [ ] `tools/labeling/sample.ts`：
  - [ ] 池阶段照旧（`limit: scanWindowFor()`，**不传** `allowPaging`）→ 判定/粗筛/候选集不变。
  - [ ] 新增显示阶段：仅对抽中的候选，`allowPaging: true` + `limit: 365` 抓 `history`。
  - [ ] 落盘 SlimBar；调用判定器前 rehydrate。
  - [ ] CLI 加 `--history <bars>`（默认 365）。
- [ ] `tools/labeling/build-page.ts`：内联数据用数组；页内映射成 `{time,open,high,low,close}`。

## 验证

```bash
npx tsc --noEmit
npm test                       # 含新增的 paging 单测；现有用例全绿
npm run label:sample -- --refresh --history 90    # 基线
cp tools/labeling/out/candidates.csv /tmp/c90.csv
npm run label:sample -- --refresh --history 365   # 一年
diff <(...) ...
npm run label:page
```

- [ ] **AC1**：`--history 90` 与 `--history 365`（同一 anchor）的 `candidates.csv` **逐行一致**。
- [ ] **AC2**：随机抽 3 张图，`bars.length >= 300`（次新币除外）。
- [ ] **AC3**：paging 单测全绿（含"刷新只 1 请求"与"缺省只 1 请求"两条）。
- [ ] **AC4**：`git diff src/server/coin-scan-service.ts` 为空；现有 bitget 单测不改动。
- [ ] **AC5**：`ls -l tools/labeling/out/` 报出快照与页面体积（目标 < 10MB / < 8MB），数字写进提交信息。
- [ ] **AC6**：tsc + `npm test` 全绿。
- [ ] **AC7**：页面 jsdom 行为回归（键盘、回退、scoreShown、理由键位、CSV 字段与行数、断点续标）全绿。

## Review gates

- **Gate A（改工具之前）**：paging 单测全绿且"缺省只 1 请求"通过 —— 这是线上零变化的证据。此处不过，不许往下走。
- **Gate B（收尾之前）**：AC1 与 AC4 同时成立（候选集没变 + 线上调用方没动）。

## 回滚点

- 能力层：`allowPaging` 为新增可选字段，去掉字段与 `fetchPaged` 分支即回到今天。
- 工具层：删 `tools/labeling/out/` 重跑；`tools/` 改动可整目录丢弃。
- 若 `/history-candles` 行为异常 → 退回只抓 90 根，本任务不交付（PRD 允许）。

## Spec 更新（3.3）

- `.trellis/spec/server/market-data.md`：补 `CandleRequest.allowPaging` 的语义、翻页策略与"只有最新页刷新"的缓存规则。
- 若 `StructureResult` 未变（本任务不改判据），`coin-scan.md` 不动。
