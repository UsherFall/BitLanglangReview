# 设计：Bitget 订单明细拉取 + K 线逐笔开平点位

## 边界

**做**：

- Bitget 同步流程增加 `order/orders-history`（订单级）拉取，落库为原始订单缓存（不做归属）。
- 新增"轮次 → 订单"归属纯函数，用 `openTotalPos`/`closeTotalPos` 校验。
- `/api/bitget/trades` 返回的 Trade 带上可选的 `points`（该轮每笔开/平点位）。
- `TradeChart` 的标记渲染从内置 `SeriesMarker` 换成自绘 primitive：**圆点（中号、青绿/玫红）+ 悬停详情卡**。
- `TradeChart` 的**全部开平仓模式**同样展开每轮的全部动作点。

**不做**：

- 不改 `FreeReplayChart` 的纸面交易标记（保持内置箭头 + 文字）。
- 不改左栏列表粒度（仍是一行一轮）。
- 不拉 90 天以前的数据（`history-position` 本身有 90 天硬墙）。
- 不引入 fill-history（成交流水）；只到订单级。

## 数据结构

### 新表 `bitget_orders`（`src/server/bitget-position-store.ts` 或独立 store）

只存 `status=filled` 的订单（实测 7 天 144 单里 19 单 canceled、14 单 `priceAvg` 空，一律不入库）。

```sql
create table if not exists bitget_orders (
  order_id   text primary key,
  symbol     text    not null,
  pos_side   text    not null,   -- long | short
  side       text    not null,   -- open | close
  qty        real    not null,   -- baseVolume
  price      real    not null,   -- priceAvg
  fee        real    not null,
  profit     real    not null,   -- totalProfits
  source     text    not null,   -- orderSource: market/normal/modify_order_limit/loss_market
  leverage   integer,
  traded_at  integer not null,   -- uTime（成交时刻，画点用它）
  placed_at  integer,            -- cTime（下单时刻，仅参考）
  fetched_at text    not null
);
create index if not exists idx_bitget_orders_symbol_time on bitget_orders (symbol, traded_at);
```

**为什么存 `uTime` 而不是 `cTime`**：实测限价单 cTime→uTime 差 61s / 357s / **799s**（挂单到成交），市价单只差 21ms；用 cTime 画点会把限价单的点画到挂单那一刻。

### `Trade` 可选点位（`src/domain/trade.ts`）

```ts
export type TradePoint = {
  kind: 'open' | 'close';
  time: string;          // 上海时区 ISO，口径同 entryTime/exitTime
  timeMs: number;
  price: number;
  qty: number;
  fee: number;
  profit: number | null; // 开仓无已实现盈亏
  source: string;
  leverage: number | null;
};

export type Trade = { ...原有字段; points?: TradePoint[] };
```

- xlsx 交割单来源：不设 `points`（源数据没有中间动作）。
- Bitget 来源：归属成功时写入；失败时不写 → 前端降级两点。

## 杠杆填充（2026-09-22 追加）

订单历史**直接提供** `leverage`（实测 100/100 有值、同标的恒定，如 BTCUSDT 全 30x），所以 Bitget 来源的 `Trade.leverage` 不再是 `null`：

- 取值：该轮**开仓订单**的 `leverage`；一轮里多笔开仓杠杆不一致时取**首开**那笔（按 `traded_at` 最早）。
- 归属失败 / 无订单明细 → `leverage` 保持 `null`（UI 仍显"—"）。
- `margin` / `maxPositionValue` / `returnRate` **保持 `null`**（用户 2026-09-22 决定）：Bitget 不直接提供，推算口径可能与工作簿的「保证金（最大时）/ 持仓价值（最大时）/ 收益率」不一致，遵循 spec 的 "never fabricate approximations"。
- 影响面：Bitget 复盘列表的杠杆列与详情头不再显"—"；按 `returnRate` 排序时 Bitget 行仍恒沉底（该字段仍为 null）。

## 归属算法（纯函数）

`src/domain/bitget-round-orders.ts`

```ts
export function ordersForRound(
  round: { symbol: string; holdSide: string; ctime: number; utime: number; openTotalPos: number; closeTotalPos: number },
  orders: BitgetOrder[],   // 该 symbol 的已成交订单，按 traded_at 升序
): BitgetOrder[] | null
```

**反向状态机**（从轮次结束往前回溯，持仓归零即起点；一轮的定义就是"持仓从 0 到 0"）：

```
held = 0; picked = []
for o of orders 从后往前:
  if o.side == 'close': held += o.qty; picked.unshift(o)
  else:
    if held <= 0: break            // 已归零，再往前是上一轮
    held -= o.qty; picked.unshift(o)
    if held <= eps: break          // 回到起点
```

**校验**：`picked` 的开仓量合计 == `openTotalPos` 且平仓量合计 == `closeTotalPos`（相对误差 1e-6）。不等则返回 `null`（宁可降级，不猜）。

**为什么可行**：实测 BTCUSDT 一轮 `open 0.0029 → open 0.0039 → close 0.0029 → open 0.0044 → close 0.0083`，反向扫描能得到全部 5 笔；最近 7 天 52 轮里 50 轮自算结果与官方数量、时间完全吻合（另 1 条为跨 7 天窗的边界轮，见"风险"）。

**单测数据**：用实测的真实订单序列（5 动作轮、3 动作分批平轮、加仓轮），断言归属结果与降级路径。

## 同步流程扩展（`src/server/bitget-sync.ts`）

现有：`history-position`（90 天，3 个月窗 + 二分）。
新增：`orders-history`（90 天，**7 天窗 + `idLessThan` 翻页**，`limit=100`）。

**实测成本**（2026-09-22，真实账户 90 天）：

| 指标 | 实测值 |
| --- | --- |
| 请求数 | **16 次** |
| 订单数 | 821 条 |
| 总耗时 | **7.2s**（含 150ms 间隔） |
| 单请求耗时 | 中位 163ms / 最大 876ms |
| 错误 | 0 |
| 连打 20 次（80ms 间隔） | 0 错误，未触发限频 |

请求间固定 150ms 间隔（实测无压力，保守取）。失败按现有错误透出方式处理；出现限频类错误时按项目既有约定把警告透出给用户（不要静默重试）。

同步结果扩展为 `{ fetchedRows, uniqueRows, ordersFetched, fromMs, toMs }`，UI 的同步结果文案带上订单数与失败信息。

## API 变更（`src/server/app-plugin.ts`）

`GET /api/bitget/trades` 保持不变，只是每行 Trade 多带 `points`：

1. `bitgetPositionStore.listAll()` → 每行转 Trade
2. 对每行调用 `ordersForRound(row, cachedOrdersForSymbol)` → 成功则填 `points`
3. `cachedOrdersForSymbol` 一次性从新表按 symbol 分组读入（避免 N 次查询）

52 轮 × 平均 3 单 ≈ 156 个点对象，响应增量约 30KB，可接受。

## 前端渲染

### 点位产出（改造 `src/ui/trade-markers.ts`）

现有 `tradeMarkers` / `allTradeMarkers` 返回 `SeriesMarker[]`；改为返回纯数据点位：

```ts
export type ChartPoint = {
  key: string;              // 稳定 key（订单 id 或 entry/exit）
  timeMs: number;
  price: number;
  kind: 'open' | 'close';
  muted: boolean;           // 非当前交易 → 小尺寸 + 半透明
  detail: TradePoint | null;// null → 卡片只显示价格/时间
};

export function tradeChartPoints(trade, timeframe, candles, highlighted): ChartPoint[]
export function allTradeChartPoints(trades, activeTradeId, timeframe, candles): ChartPoint[]
```

- `trade.points` 有值 → 逐一展开（每个动作一个点）
- 无 `points`（xlsx 或归属失败）→ `entryTime/entryPrice` 生成 open 点、`exitTime/exitPrice` 生成 close 点

### 绘制（新增 `src/ui/trade-marker-primitive.ts`）

`ISeriesPrimitive` + pane view + renderer，**canvas 自绘圆点**（沿用预览页已验证的画法）：

- 尺寸：中号 = 直径 11px（`state.sizeScale = 1`），muted 时 8px + `globalAlpha 0.5`
- 颜色：开 `#2DD4BF`、平 `#FB7185`
- 位置：开仓点挂在对应 K 线 **low 下方 8px**、平仓点挂在 **high 上方 8px**（不压蜡烛）
- 同侧相邻错开：同一 x 附近的点按 `size + 3` 外推
- 绘制在 `useMediaCoordinateSpace`（CSS 像素，与 `crosshairMove` 的 `param.point` 同坐标系）

**为什么不用内置 marker**：内置只有 4 种形状、`text` 与形状绑死、无悬停能力；DOM/SVG 覆盖层路线 8 月已因拖拽卡顿被否决（见 PRD 历史）。canvas primitive 随图表重绘，拖拽天然跟随。

### 悬停卡片（新增 `trade-marker-tooltip.tsx` 或纯 DOM 类）

- 由 `chart.subscribeCrosshairMove` 触发，命中半径 16px（用 primitive 暴露的点位坐标）
- 卡片内容：开/平标签、时间、价格、数量、杠杆、手续费、来源（`loss_market` 标红为"止损市价"）、单笔盈亏（正绿负红）
- 定位：优先放点位右侧 18px；超出右边界则放左侧；垂直方向夹在容器内
- 样式：沿用预览页已验证的卡片（深色 `rgba(13,18,26,.94)`、圆角 9px、`backdrop-filter`、等宽数字）

### 开关与替换

- 保留现有 Eye（当前交易标记）与 MapPin（全部开平仓）按钮语义，改为控制 primitive 是否绘制。
- `TradeChart` 移除 `createSeriesMarkers` 调用；`FreeReplayChart` 不动。
- 图表 whitespace 逻辑（`chartDataWithWhitespace` 用 marker 时间补白）继续沿用，参数改为点位时间。

## 兼容与降级

| 情况 | 行为 |
| --- | --- |
| xlsx 交割单来源（无 `points`） | 只画 entry/exit 两个圆点，卡片显示价格/时间 |
| 归属校验失败 | 同上一行（降级两点，不报错、不猜） |
| 该轮早于 90 天 / 无订单缓存 | 同上一行 |
| 订单跨 7 天查询窗（边界轮） | 同步按窗切片时可能漏首笔开仓 → 校验失败则降级；后续可加"窗首轮次往前扩一窗"补偿 |
| 未配置 API key | 现有引导逻辑不变 |

## 风险与回滚

- **最大改动面**：`TradeChart` 的标记渲染路径整体换掉。回滚点 = 恢复 `createSeriesMarkers` 调用与 `trade-markers.ts` 的旧返回类型；primitive/tooltip 为纯新增文件，删掉即回到现状。
- 现有 UI 测试（`app-bitget-mode`、`app-chart-price`、`app-review-progress`、`trade-markers`）必须全绿；`trade-markers` 测试随接口变化调整。
- 同步耗时从约 2 秒增至约 10 秒：UI 需要显示"拉取订单中"的进度，且失败不能中断 history-position 主流程。
- 限频：实测 90 天 16 次请求无压力，仍保留 150ms 间隔与错误透出。
