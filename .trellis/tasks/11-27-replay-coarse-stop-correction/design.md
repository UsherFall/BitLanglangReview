# 技术设计：跨周期精确成交与 position-31 修复

## 1. 边界与模块

新增 `src/ui/free-replay-order-execution.ts`，负责“过渡粗K线”的执行片段规划、细周期读取、完整性验证与顺序成交。它是**非图表执行读取器**：返回的细K线只活在一次 reveal 调用内，不进入 `FreeReplayDataset` 的 Cursor / Focus / Active / Rendered 窗口。

现有职责保持：

- `useFreeReplaySessionLifecycle`：唯一提交 Replay cursor/progress 与 Paper Trading 状态，负责 pending、错误、取消和竞态。
- `free-replay-paper-trading.ts`：唯一订单状态机。细周期片段逐根调用 `processRevealedCandle`，不复制限价、止损、止盈、FIFO 或权益规则。
- `chart-time.ts`：提供 grid 感知的边界判断，避免另写日/周/月对齐。
- `App.tsx` / `FreeReplayPanel.tsx`：只展示 pending/error 和禁用重复步进，不拥有第二份执行状态。
- 服务器与 SQLite schema 不变，复用 `/api/candles` 和现有 session blob。

## 2. 执行数据流

### 2.1 普通路径

`nextFreeReplayProgress` 找到下一根后：

- 若 `revealedCandle.timestamp >= previousProgressTime*1000`，整根都是新推进区间，维持当前同步处理。
- 若没有 pending entry、pending exit 或任何 leg stop，也不需要额外执行数据，直接推进。
- 普通路径继续立即清 Focus、处理 Paper、提交 Replay，现有测试不应因异步化而改变。

### 2.2 过渡路径

仅当 `revealedCandle.timestamp < previousProgressTime*1000` 且存在自动订单时：

1. 固定本次会话键、timeframe、旧 cursor/progress、下一 cursor/progress 和 Paper 快照，生成递增 operation token。
2. 设置 `revealPending=true`、清旧错误；此时尚不修改 Paper、Replay 或 Focus。
3. 根据会话 `candleSource` 得到原请求 instrument、source 和 grid。
4. 选择能对齐 `(previousProgressTime,nextProgressTime]` 的最粗子周期；候选表见 research 文档。`1M` 不以 `1W` 为子周期。
5. 通过 `/api/candles` initial + 必要 later 分页获取 `[previousProgressTime,nextProgressTime)` 开盘的子K线。只处理该新片段，不读取结果到图表。
6. 按精确时间戳校验连续性：第一根 open=`previousProgressTime`，之后每根递增 child step，最后一根 close=`nextProgressTime`。缺一根、响应失败或分页不前进都失败。
7. 成功后逐根调用 `processRevealedCandle`；每根 eventTime 是自己的完成时间，因此真实触损会记录在实际子K线收线时刻。
8. 校验 token 仍是当前操作，再批量提交 Paper、`nextReplay`、清 Focus，并恢复 pending=false。
9. 失败时只设置 `executionError` 和 pending=false；cursor/progress/Paper/Focus 原样保留，用户可重试。

### 2.3 取消与迟到响应

以下操作使 operation token 失效：start、restore、remove、switchTimeframe、rewind、end/resume、公开 Paper Dispatch、另一次 reveal、hook 卸载。迟到响应在应用任何状态前检查 token；失效后静默丢弃，不写错误、不推进、不成交。

pending 时 reveal 在 lifecycle 入口直接 no-op；FreeReplayPanel 的下一根按钮和 App 的 ArrowRight 同时禁用/拦截。Autosave 不持久化 pending/error，只保存成功提交后的真实 session 状态。

## 3. 建议函数契约

```ts
type ExecutionCandleLoader = (params: URLSearchParams) => Promise<Candlestick[]>;

function hasAutomaticOrders(session: PaperTradingSession): boolean;
function needsPartialExecution(candle: Candlestick, previousProgressTime: number): boolean;
function partialExecutionTimeframe(input: {
  previousProgressTime: number;
  nextProgressTime: number;
  timeframe: ReviewTimeframe;
  grid: CandleGrid;
}): ReviewTimeframe;

async function loadPartialExecutionCandles(input: {
  instrument: string;
  source: ChartCandleSource;
  previousProgressTime: number;
  nextProgressTime: number;
  timeframe: ReviewTimeframe;
  grid: CandleGrid;
}, loader?: ExecutionCandleLoader): Promise<Candlestick[]>;

function processExecutionCandles(
  session: PaperTradingSession,
  candles: Candlestick[],
): PaperTradingSession;
```

`processExecutionCandles` 的子周期不含 `1M`，eventTime 可用 `timestamp/1000 + timeframeMs(child)/1000`。Loader 的页数以理论所需根数计算循环上限，同时要求每页最新时间戳严格前进；不能用一个任意小上限把长片段误判为数据缺失。

## 4. UI / 持久化契约

Lifecycle 新增临时返回字段：

```ts
revealPending: boolean;
executionError: string;
```

- 下一根按钮在 `replayEnded || revealPending` 时禁用；pending 文案为“加载细周期成交数据”。
- `executionError` 在 FreeReplayPanel 状态区显示，明确“未推进 K 线”；下一次 reveal 或场景操作时清旧错误。
- 两个字段不进入 `FreeReplaySessionPayload`，不改变 Store/API/schema。
- 现有 ended 冻结、Focus、跨周期视口锚定和自动保存规则保持。

## 5. position-31 一次性数据修复

在任务目录添加可审计的 `repair-position-31.py`（不进入产品运行时），默认 dry-run，只有 `--apply` 才写入：

1. 要求用户先关闭/离开目标回溯页面，防止旧浏览器快照自动保存覆盖修复。
2. 用 SQLite backup API 生成 `data/review.bak-<timestamp>-position-31.sqlite`，包含 WAL 的一致视图。
3. `BEGIN IMMEDIATE` 后重读目标行；校验原始 Paper blob SHA-256=`724f6e...13aa72`、`position=null`、15m cursor/progress、两笔 fill 的 ID/方向/价格/时间/数量/保证金/杠杆和 `nextId=37`。任一不符则 rollback。
4. 删除 `fill-35/36`；按 research 中的反事实数值恢复一个 `position-31` / `leg-32`，stopPrice=52403，其他交易、ID 序列和会话字段不变。
5. 更新同一行 `paper_trading_json` 和 `updated_at`，UPDATE 条件包含原始 blob，要求 changes=1；事务内重读并验证所有 postcondition 后 commit。
6. 新连接重新读取，验证可用 margin 约为 1848.688526756152（允许浮点末位误差）、已实现 PnL=2286.557380899826，且 `groupFillsIntoRounds`/模拟单库不含仍开仓的 position-31。
7. 把备份路径和校验结果记录到任务实施记录。回滚只恢复该备份，不用产品“重置”按钮。

## 6. 兼容性、权衡与风险

- 用户选择精确重放，明确拒绝“跳过过渡K线”的保守方案；不得在无数据时退回整根粗K线。
- 极端场景（例如从任意分钟进度切到自然月且只能对齐 1m）可能需要大量分页。采用最粗对齐子周期降低常见开销；完整性/正确性优先于用一个不完整片段勉强推进。
- 细周期历史若交易所不提供，操作会安全失败并保持现场；这是显式限制，不伪造OHLC。
- 本次只修目标历史数据，不写通用历史迁移，避免把其他会话中无法证明误判的成交重写。
