# Design — 回溯复盘模拟单复盘库

## 核心设计原则

**两个入口、一份数据、两个场景。** 回放中的批注（边练边记）与复盘库（事后检索）操作同一条批注记录，不存在功能重复。

## 数据模型

### 回合（Paper Round）与全局 ID

- 批注粒度 = 回合：一个 `PaperPosition` 从开仓到全部平仓。`session.trades`（fills）按 `positionId` 分组即得回合。
- **已完结回合**：`positionId !== session.position?.id` 的回合（当前持仓的回合不进库，直至全平）。
- 回合全局 ID：`paper:{instrument}:{startTime}:{positionId}`。会话主键 `(instrument, startTime)` 保证跨会话唯一；`positionId` 会话内单调自增、随会话 JSON 持久化，恢复后稳定。
- 该 ID 由唯一构造函数 `paperRoundReviewId()` 生成，server 与 ui 共用（domain 层）。

### 批注存储：复用 `trade_reviews` 表

不建新表。批注（tags/note/starred）以回合全局 ID 为 `trade_id` 存入现有 `trade_reviews`：

- 标签改名/删除自动对模拟单全局生效（`renameTag`/`deleteTag` 重写全表）——R4 零成本。
- 模块计数隔离：`scopedReviewsForModule('paper')` = `trade_id` 以 `paper:` 为前缀的 reviews；`'trade'`/`'bitget'` 分支按各自真实单 ID 集合过滤，天然排除 `paper:` ID。
- 真实单 ID 来自交割单/Bitget（`bg-` 前缀），与 `paper:` 前缀不会冲突。

回合的行情数据（价格/盈亏/笔数）**不落库**，库列表由会话 blob 实时派生（见下）——单一事实源仍是会话 JSON，批注表只存用户内容。

## 数据流

```
GET /api/paper/rounds?tag=&starred=&session=
  → freeReplaySessionStore.listSessions()（含 paper_trading_json）
  → 逐会话 groupFillsIntoRounds(trades, position?.id)（domain 纯函数）
  → 合并 trade_reviews 中 paper: 前缀批注
  → 过滤（tag / starred / 来源会话）→ 按 closedAt 降序
  → { rounds, sessions(有回合的会话清单，供筛选下拉), tags, tagCounts }

POST /api/reviews  （复用现有路由，module='paper'）
  → saveReview({ tradeId: 'paper:…', tags, note, starred })
  → 响应带 paper 作用域的 tagPayload（同交割单模块模式）

DELETE /api/free-replay/sessions  （级联扩展）
  → deleteSession(instrument, startTime)
  → reviewStore.deleteReviewsByPrefix(`paper:${instrument}:${startTime}:`)  ← 新增小方法
```

## 模块边界与类型迁移

- `PaperTrade` / `PaperTradingSession` 等类型目前在 `src/ui/free-replay-paper-trading.ts`，服务端解析会话 blob 需要它们 → **类型（仅类型）下移到 `src/domain/paper-trading.ts`**，ui 文件 import 并 re-export，现有调用方零改动。纯函数逻辑留在 ui 不动。
- 新 domain 模块 `src/domain/paper-round.ts`：`PaperRound`、`groupFillsIntoRounds`、`paperRoundReviewId`、`filterPaperRounds`——纯函数，单测覆盖。

## UI 设计

### ① 回放进行中（FreeReplayPaperTradingPanel 的「单子」列表）

- 同一回合可能有多行（部分平仓）；同一回合所有行共享该回合的批注状态（星标/标签 chips 同步显示）。
- 每行：左侧星标按钮（切换收藏，乐观更新）；点击行主体保持现有「跳到开仓点」不变；行内新增批注按钮（或点击标签区）展开**行内联编辑器**（复用 ReviewEditor 的 `TagCombobox` + 一条笔记 textarea + 保存）。
- 数据：App 持有当前会话的 `paperReviews`（进入会话时按 `session=` 过滤拉取，保存后局部修补），随会话切换重取。

### ② 复盘库（FreeReplayPanel，无活跃回放时的首页）

- 「历史会话」旁新增并列的可折叠「模拟单库」区（复用现有 collapsible 模式）。
- 筛选条：标签下拉（带 paper 作用域 `N 笔` 计数）、收藏状态、来源会话下拉。
- 行：星标 | 方向 | 入场→出场 | 盈亏/收益率 | 笔数 | 来源会话标签（`BTCUSDT · 11-01 08:00 起`）| 标签 chips；点行展开同一个批注编辑器。
- **行点击跳回**：恢复该来源会话（复用 `onRestore`）并焦点定位到该回合最后一笔 fill（复用 `focusPaperOrder` 机制；恢复后异步等 paperTrading 就位再 focus）。

### 会话删除的级联（Q2 采纳方案）

删会话 = 该会话的回合数据与批注一并删除（库中消失）。理由：回合行情数据随会话 blob 消亡，保留批注即成无源孤儿；实现只需 DELETE 路由加一条前缀删除。

## 关键取舍

| 决策 | 选择 | 放弃的方案与原因 |
| --- | --- | --- |
| 批注存储 | 复用 `trade_reviews` 表 | 新建 `paper_round_reviews` 表：改名/删除全局联动要改两处，module 作用域逻辑重复 |
| 回合行情数据 | 从会话 blob 实时派生 | 独立回合表快照：与会话 blob 双写不一致风险，恢复/覆盖需对账 |
| 删会话 | 级联删批注 | 保留孤儿批注：行情数据已失，行无法渲染，无意义 |
| 库排序 | 平仓时间降序（最近在前） | 入场时间升序：库是检索场景，最近练习最相关 |

## 兼容与回滚

- 不迁移旧数据：旧会话的 fills 本就带 `positionId`，派生即得回合，天然兼容。
- `trade_reviews` 表结构不变（无 DDL）；新前缀 ID 不影响现有模块。
- 回滚 = Revert 提交；`paper:` 前缀的批注行残留无害（无会话引用，且被各模块作用域过滤排除）。

## 风险

- **DELETE 级联范围**：前缀匹配必须精确到 `paper:{instrument}:{startTime}:`（含尾冒号），避免误删同币种不同会话（`startTime` 前缀撞车）。测试锚点。
- **恢复后焦点时序**：跳回依赖会话恢复完成 + 图表数据加载，`focusRequest` 机制已支持异步（token 触发），需测试验证。
