# Implement — Bitget API 拉单复盘自己的交割单

> 前置：本任务待用户对最终规划摘要给出显式批准后执行 `task.py start`。当前工作区另有 in_progress 任务 `09-04-coin-scan-skip-closed-markets`，本任务开始前需与用户确认其收尾或让路方式。

## 执行纪律

- 遵循 spec：`.trellis/spec/server/api-plugin.md`、`market-data.md`、`persistence-and-imports.md`、`frontend/directory-structure.md`、domain 规范。
- 每步一个逻辑提交；**step 3（App 抽取）单独提交**并作为回滚点。
- 全程命令：`npm test`、`npx tsc --noEmit`；UI 行为手工回归 `npm run dev`（trade 模式逐项对比重构前后）。

## Ordered Checklist

### Step 0 — 前置阅读与抽取边界冻结（review gate）
- [ ] 通读 `src/ui/App.tsx`：155-540（数据请求 effect/handlers）、562-747（trade 侧栏/工作区）、1410-2060（TradeChart/格式化/metrics）。产出两份精确清单：
  1. trade 复盘工作台依赖的 App 级状态与回调清单（state/ref/effect/函数名）；
  2. 与其它模式共享的部分清单（如 timeframe、leader-coins、sidebar 拖拽）。
- [ ] 决策：6.3 抽 hook+两组件 或 6.4 整体模式组件——按"最少 diff、保持行为"取其一，记录到本文件。
- [ ] 基线：`npm test` 全绿记录；`npm run dev` 手工记录 trade/freeReplay/scan 当前表现快照。

### Step 1 — 域层：可空 Trade + 映射纯函数
- [ ] `src/domain/trade.ts`：leverage/margin/maxPositionValue/returnRate/turnover 改 `number | null`。
- [ ] `src/domain/bitget-position.ts`：类型 + `toTradeId`/`toTrade`/`bitgetSymbolToOkxInstrument`/上海 ISO helper。
- [ ] `src/domain/build-review-queue.ts` `compareByField`：null 沉底（封装 nullSafeCompare）。
- [ ] 适配编译：`src/server/trade-import.ts` 等受类型波及处回归（预期 `?? 0` 已兜底，只需确认无 `number` 窄化处报错）。
- [ ] 测试 `tests/bitget-position.test.ts`：映射全字段/方向/时间/手续费取正、符号到 OKX instrument、非法符号、trade id 确定性。
- [ ] 验证：`npm test` + `npx tsc --noEmit`。

### Step 2 — Server：密钥 + 客户端 + store + 同步 + 路由
- [ ] `src/server/bitget-keys.ts`：`loadKeys/saveKeys/clearKeys`（0600、git-ignored 路径 `data/bitget-keys.json`、校验字符串）。
- [ ] `src/server/bitget-client.ts`：签名、时间校准、`fetchHistoryPositions` 单页、`BitgetApiError`。测试用注入 `fetchJson` mock：验证签名串（时间戳/METHOD/path/排序 query）、header 名、cursor 透传（仿 `http-proxy/http-retry` 测试风格）。
- [ ] `src/server/bitget-position-store.ts`：建表、`upsert/listAll/maxUtime/deleteByTime/close`；测试 `tests/bitget-position-store.test.ts`（临时 sqlite 文件，参照 `review-store.test.ts`）。
- [ ] `src/server/bitget-sync.ts`：窗口切分 + 翻页 + upsert 编排；`BitgetSyncService` 注入 client+store；测试窗口边界/游标结束/幂等（mock client）。
- [ ] `app-plugin.ts`：装配 keys/client/store/sync；新增 4 路由（config GET/POST、sync POST、trades GET）。注意 connect 前缀剥离。
- [ ] `/api/bitget/trades` 与 `/api/trades` 契约一致性（同 `buildReviewQueue` + tagPayload）。
- [ ] 验证：`npm test` + `tsc`；路由可先用 curl 打 401/400 路径（无 key）。

### Step 3 — UI：共享工作台抽取（独立提交 · 回滚点）
- [ ] 按 Step 0 清单，将 trade 复盘 UI 抽到 `src/ui/trade-review-source.ts`（hook）与 `src/ui/TradeReviewWorkspace.tsx`（侧栏/详情两个导出组件或整体组件，视 Step 0 决策）。
- [ ] trade 模式改为调用共享组件；DOM/class/交互逐项对照原实现，不做任何视觉/逻辑变更。
- [ ] 验证：`npm test`（重点 app-tag-management/app-review-progress/app-drawings/review-editor）、`tsc`、手工回归 trade 模式（筛选/进度/列表/星标/标签改名删除/时间周期切换/画线/其他币/龙头）。
- [ ] 提交信息明示"纯搬移、行为不变"，便于 revert。

### Step 4 — UI：Bitget 模块
- [ ] `App.tsx`：ReviewMode 加 `'bitget'`、第 4 按钮、侧栏收起态标签。
- [ ] `src/ui/BitgetPanel.tsx`：unconfigured 设置表单 / 同步范围+按钮+错误提示 / 复用共享列表展示；清除配置入口。
- [ ] 工作区复用共享详情组件（数据来自 `/api/bitget/trades` 选中 trade）。
- [ ] null 字段展示：行/指标条对 `null` 显示 "—"；`formatPercent` 等格式化函数 null 感知。
- [ ] 验证：`npm test` + `tsc` + 手工（构造假响应/mock server 跑通设置→同步→列表→复盘交互）。

### Step 5 — 端到端验证（真实 key 或模拟）
- [ ] 若用户提供只读 key：真实跑通设置→同步→列表→复盘；核对数字口径（profit=netProfit、fee 正、时间+08）。
- [ ] 错误路径演示：错误 passphrase / 无权限 key → 可读中文提示。
- [ ] `data/bitget-keys.json` 不入 git；GET config 不回显。
- [ ] 重复同步幂等（行数不变）。

### Step 6 — 质量收尾（trellis-check 后）
- [ ] `npm test` 全绿；`npx tsc --noEmit` 干净。
- [ ] 复核 spec 一致性（新路由/命名/分层），跑 `trellis-check`。
- [ ] 补 spec 文档（`trellis-update-spec`）与 `CONTEXT.md` 术语（如 Bitget、已平仓仓位历史）。

## Validation commands

```bash
npm test
npx tsc --noEmit
npm run dev   # 手工回归
curl "http://127.0.0.1:5173/api/bitget/config"   # 冒烟
```

## Risky files / rollback points

| 风险 | 缓解 |
|---|---|
| `src/ui/App.tsx` 抽取破坏 trade 模式 | Step 3 独立提交；行为快照回归；失败即 revert 该 commit |
| `src/domain/trade.ts` 可空化编译波及 | tsc 全量校验；xlsx 路径保持 `?? 0` 数字语义 |
| Bitget 签名/时间窗细节与实盘差异 | 客户端用注入 fetchJson mock 单测；真实 key e2e 验证 |
| 多任务并发（09-04 仍在 in_progress、dirty 70 文件） | 开工前与用户确认当前任务收尾或让路，避免互相覆盖 |

## Follow-up checks before task.py start

- [ ] 本 implement.md 与 prd/design 一致，无悬空引用。
- [ ] implement.jsonl / check.jsonl 至少含一条真实 spec/研究条目（见 manifest）。
- [ ] 用户已批准最终规划摘要。
