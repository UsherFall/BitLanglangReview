# 技术设计：回溯复盘结束 / 恢复复盘

## 1. Architecture And Boundaries

本功能是一个跨 Domain → SQLite/API → Session Lifecycle → React UI 的会话状态扩展，不新增导航、页面、报告模块或 Dataset。

| Concern | Owner | Change |
| --- | --- | --- |
| 可逆状态及共享 wire 类型 | `src/domain/free-replay-session.ts` | 新增 `FreeReplayReviewStatus = 'active' \| 'ended'` 及会话字段 |
| 状态持久化与旧库迁移 | `src/server/free-replay-session-store.ts` | 新增 `review_status`，保存/读取/upsert，缺省 `active` |
| PUT 边界校验 | `src/server/free-replay-routes.ts` | 缺省 `active`，非法状态 400 |
| 当前状态、自动保存、结束/恢复与命令守卫 | `src/ui/use-free-replay-session-lifecycle.ts` | 唯一状态owner；冻结 Paper 更新和游标命令 |
| 按钮、只读单子面板、进度控件 | `src/ui/App.tsx`, `src/ui/FreeReplayPanel.tsx`, `src/ui/styles.css` | 呈现状态并禁用/隐藏可变入口 |
| Candlestick Cursor/Focus/Active/Rendered | `FreeReplayDataset` | **不改**；冻结不是数据窗口切换 |
| Paper Round 派生/批注 | `paper-round.ts`, Review Store | **不改**；会话主键与 Paper blob 保持原样 |

状态命名为 `active | ended`，与按钮「结束复盘 / 恢复复盘」一致。`ended` 是可逆查看态，不引入 `completed/archived`，避免被误解为永久完结。

## 2. Shared Contract And Persistence

### 2.1 Domain shape

```ts
export type FreeReplayReviewStatus = 'active' | 'ended';

// 未保存/旧 wire payload 允许缺省；缺省语义为 active。
FreeReplaySessionPayload = FreeReplayStart & {
  timeframe: Timeframe;
  paperTrading: Paper;
  reviewStatus?: FreeReplayReviewStatus;
};

// Store 读出的 saved row 始终给出明确状态。
FreeReplaySession = FreeReplaySessionPayload & {
  reviewStatus: FreeReplayReviewStatus;
  updatedAt: string;
};
```

`FreeReplayStart` 不增加字段：它仍是图表/start 所需参数，新会话状态由 lifecycle 设为 `active`。现有泛型 `<unknown, string>` 保留，不能把 opaque Paper JSON 收窄成严格 UI 类型。

### 2.2 SQLite

`free_replay_sessions` 新增：

```sql
review_status text not null default 'active'
```

- 新库 `create table` 直接包含该列。
- 旧库在现有 `allowCandleSourceColumn()` 之后执行独立的 `allowReviewStatusColumn()`；列不存在时使用 `alter table ... add column ... default 'active'`，已有行自然回填，不复制或删除数据。
- `SessionRow`、insert 列清单、upsert update 清单和 `toSessionPayload()` 同步增加字段。
- Store 保存时将缺省/未知输入归一为 `active`，只把精确的 `ended` 写为结束态；读取旧行同样回退 `active`。
- 不增加 `endedAt`、总结 JSON 或新表；本需求没有永久完结时间或报告语义。

### 2.3 API

`PUT /api/free-replay/sessions`：

- 原有 instrument/startTime/timeframe 校验不变。
- `reviewStatus` 缺省按 `active`；仅接受 `active | ended`，其他值返回 400。
- GET/PUT 响应带明确 `reviewStatus`。
- DELETE 与 Paper Review 原子级联完全不变。
- `/api/paper/rounds` 不需要感知该字段，继续从同一会话 blob 派生回合。

## 3. Lifecycle State And Command Guards

### 3.1 State ownership

`useFreeReplaySessionLifecycle` 新增：

```ts
reviewStatus: FreeReplayReviewStatus;
endReview(): void;
resumeReview(): void;
```

内部 Paper state setter 改名为私有 `setPaperTradingState`；对 App 暴露的 `setPaperTrading` 保持 Dispatch 形状，但变成冻结感知 wrapper：

- `active`：按原逻辑应用值或 functional update。
- `ended`：直接 no-op，不执行 functional update，因此开仓、平仓、撤单、止损、重置以及任何未来新增 App Paper 命令都不能绕过守卫。
- start/restore/delete 等 lifecycle 内部受信任迁移使用私有 raw setter，不被恢复出来的 `ended` 状态卡住。

不复用 `paperTrading.active`：它仍只表示模拟交易是否已开始。结束/恢复不得修改它，因而未开始模拟的会话恢复后仍未开始，已开始的仍已开始。

### 3.2 Command matrix

| Command / transition | active | ended |
| --- | --- | --- |
| `endReview` | 仅在有活跃 Replay 时设为 `ended` | no-op |
| `resumeReview` | no-op | 仅在有活跃 Replay 时设为 `active` |
| exposed `setPaperTrading` | 原行为 | no-op |
| `revealNext` | 原行为 | 在清 Focus、计算游标和 future retry **之前** no-op |
| `rewind` | 原行为（含 Paper active 锁） | 在清 Focus 和游标计算之前 no-op |
| `switchTimeframe` | 原行为 | 仍允许；保持精确 `progressTime`，只做同进度的显示游标重映射 |
| fresh `start` | 新 Replay + `active` + 初始 Paper | 同左 |
| `restore` | 恢复保存状态；当前同 key 会话保持当前状态 | 恢复 `ended`；缺省字段恢复 `active`；ended 下当前同 key restore 完全 no-op，不得隐式 resume 或回滚现场 |
| delete active Session | 原清理并复位 `active` | 同左，防止下一会话继承 ended |

结束/恢复只改 `reviewStatus`，不直接改 `freeReplay`、`paperTrading`、Focus、Candlestick 数组或 `futureRetryToken`。因此不会额外 reveal、成交、重置单据或移动图表。

### 3.3 Auto-save and restore

自动保存 effect 的 payload 和依赖加入 `reviewStatus`：

- 结束/恢复沿用 trailing 500ms PUT。
- 离开模块 flush、`pagehide` keepalive 都自然携带最新状态。
- restore 在应用另一会话前先 flush outgoing，旧会话保存自己的状态。
- 相同 `(instrument,startTime)` 的 start 仍走 restore，不能把已结束会话隐式恢复成 active；只有用户点「恢复复盘」或创建一个真正的新会话才进入 active。
- `endReview` / `resumeReview` 同时只读更新 history 中匹配 row 的 `reviewStatus`（保留 `updatedAt` 和排序），避免 trailing PUT 尚未返回时，旧 history row 把另一会话或当前会话恢复成过期状态。restore 当前同 key 会话时以 lifecycle 的当前状态为准；**若当前已 ended，同 key restore 在 flush outgoing 后直接 no-op**，连游标/Paper/Focus 也不从旧 payload 重建，模拟单库仍在返回后执行自己的 Focus。restore 不同会话时使用该 row 的保存/本地最新状态。成功 PUT 仍按既有规则 upsert 并排序。

既有 deleted-key tombstone 与 stale PUT-after-DELETE 规则不改，本功能不新增另一份 pending/save 状态。

## 4. UI Design

### 4.1 Header / status

在现有 Replay `detail-header` 内增加一个主按钮，不新增 workspace 顶层行：

- active：显示「结束复盘」。
- ended：显示「恢复复盘」，标题区显示「已结束 · 仅可查看」状态标记。
- 点击只调用 lifecycle 对应命令，图表和 Paper Panel 保持挂载。

### 4.2 K 线进度控件

`FreeReplayPanel` 接收 ended/locked 状态：

- ended 时「上一根 K 线」「下一根 K 线」均 disabled，title 说明「结束复盘后不能调整 K 线进度」。
- active 时下一根恢复；上一根仍同时服从 `!paperTrading.active` 的既有规则，两个禁用原因不能互相覆盖。
- App 的 ArrowLeft/ArrowRight handler 显式检查 ended，依赖加入 `reviewStatus`，避免旧闭包；lifecycle guard 仍是最终权威。

### 4.3 Paper Trading panel

向 `FreeReplayPaperTradingPanel` 传 `readOnly`：

- ended 时固定显示「单子」内容，操作 Tab 不可进入，交易参数和开/平仓、委托、止损控件不渲染或不可提交；重置按钮不可用。
- 持仓、待开仓、待平仓、已完成成交、统计继续显示；点击成交行聚焦、点击持仓回到光标等纯视口操作保留。
- 恢复后回到可操作面板；若冻结前未开始模拟，仍显示「开始模拟」，不自动调用 `startPaperTrading`。
- `readOnly` 是表现层，不能替代 exposed `setPaperTrading` 的 lifecycle guard。

本功能的“只读”冻结 Replay 进度与 Paper Trading 现场。Paper Round 批注/收藏和 Chart Drawings 存在独立 store、不会改变游标或成交，本任务保持其既有行为，不顺带禁用或重写。

### 4.4 Explicitly unchanged viewing behavior

- 拖动、缩放、历史翻页和单子 Focus 可用。
- 切换 Review Timeframe 可用，但不是步进：`progressTime` 不变，`cursorTime` 仅按目标周期做等价映射。
- 其他币、标记和 Dataset 的 reveal boundary 仍由原逻辑计算；ended 不额外加载或揭示未来。

## 5. Compatibility, Risks And Rollback

- **旧 SQLite：** 加列默认 `active`，无需手工迁移用户数据。
- **旧 API/测试 payload：** 缺少 `reviewStatus` 时 route/store/restore 均按 `active`；新响应明确携带字段。
- **Paper Round：** `paper_trading_json`、position/fill id、session key 均不变，批注和删除级联不受影响。
- **最大风险文件：** `App.tsx` 同时包含按钮、键盘和 Paper Panel；必须保留现有 chart effect 依赖与 workspace 行结构。`free-replay-session-store.ts` 的迁移必须覆盖真实旧 schema，而不只测试新内存库。
- **回滚：** 可先回滚 UI/lifecycle，保留新增列和字段，旧功能不受影响；完整回滚后旧代码会忽略 `review_status`，曾 ended 的会话按旧行为可操作，但游标与 Paper 数据不丢失。无需 down migration。

## 6. Rejected Approaches

- **复用 `paperTrading.active=false` 表示结束：** 会混淆“未开始模拟”和“结束整个 Replay”，恢复时还会误改开始时间/回退规则。
- **把 ended 塞进 Paper Trading JSON：** 游标命令不属于 Paper owner，且 legacy normalizer 会丢掉无关字段。
- **结束时 `freeReplay=null`：** 会退出当前图表，不符合原地看单子的需求。
- **仅禁用按钮：** 键盘和直接 lifecycle 调用仍可改状态。
- **自动平仓/撤单：** 会改变盈亏和回合归属，用户已明确选择原样冻结。
- **改 Dataset 实现冻结：** 会混淆数据加载与产品操作权限，并引入 Focus/Cursor 回归风险。
