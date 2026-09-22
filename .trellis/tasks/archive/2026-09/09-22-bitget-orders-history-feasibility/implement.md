# 实施计划：Bitget 订单明细 + K 线逐笔开平点位

每步都可独立验证；任一步失败可停在该步，不影响已完成部分（回滚点见 design.md）。

## 1. 数据层：订单缓存表

- [ ] `bitget-position-store.ts` 增加 `bitget_orders` 建表（字段见 design.md）、`upsertOrders(rows)`、`listOrdersBySymbol()`（一次读全表按 symbol 分组返回）。
- [ ] 复用现有 store 的 WAL + raw SQL 风格；`BitgetOrder` 类型放 `src/domain/bitget-order.ts`（含 `orderId/symbol/posSide/side/qty/price/fee/profit/source/leverage/tradedAt/placedAt`）。

**验证**：`npm test -- tests/bitget-position-store.test.ts`（新增 upsert 幂等、按 symbol 分组的断言）。

## 2. 客户端：拉取订单

- [ ] `bitget-client.ts` 增加 `fetchOrderHistoryPage({ startTime, endTime, limit?, idLessThan? })`，走 `order/orders-history`，返回 `data.entrustedList` 归一化结果（只保留 `status === 'filled'` 且 `priceAvg` 非空的行）。
- [ ] 归一化时 `tradedAt = Number(uTime)`、`placedAt = Number(cTime)`、`qty = Number(baseVolume)`。

**验证**：`npm test -- tests/bitget-client.test.ts`（用假 fetch 覆盖：filled/canceled 过滤、字段映射、空 `priceAvg` 丢弃）。

## 3. 同步：7 天窗切片 + 翻页

- [ ] `bitget-sync.ts` 增加订单拉取：90 天按 7 天切片，每片按 `idLessThan` 翻页到不满 100 条为止；请求间 150ms 间隔。
- [ ] 切片刻度常量独立于 history-position 的 3 个月窗（不要复用）。
- [ ] 结果结构扩展 `ordersFetched`；订单拉取失败不阻断 history-position 主流程，错误信息随结果透出（限频类错误必须显示给用户）。
- [ ] `app-plugin.ts` 的 `/api/bitget/sync` 路由透传新字段。

**验证**：`npm test -- tests/bitget-sync.test.ts`（假 client 覆盖：单窗多页、边界切片、订单失败但仓位成功）。

## 4. 归属算法

- [ ] 新增 `src/domain/bitget-round-orders.ts`：`ordersForRound(round, orders)`，反向状态机 + 数量校验（design.md 有伪码）。
- [ ] 浮点比较用相对误差 1e-6；校验失败返回 `null`。

**验证**：新增 `tests/bitget-round-orders.test.ts`，用实测真实序列：
- 5 动作轮（开 .0029 → 加 .0039 → 平 .0029 → 加 .0044 → 平 .0083）
- 分批平轮（开 → 平 .0099 → 平 .0099）
- 加仓轮（开 .0013 + 开 .0021 → 平 .0034）
- 窗口内混入上一轮订单 → 正确停在上一轮边界
- 数量对不上 → 返回 null

## 5. API：Trade 带点位

- [ ] `src/domain/trade.ts` 增加 `TradePoint` 与 `points?: TradePoint[]`。
- [ ] 新增 `bitgetOrdersToPoints(round, orders)`（放 `bitget-import.ts`）：归属成功才返回点位，字段映射 + 上海时区 ISO（复用 `epochMsToShanghaiIso`）。
- [ ] `/api/bitget/trades` 每行填 `points`（订单按 symbol 一次性读入，避免 N 次查询）。

**验证**：`npm test -- tests/bitget-import.test.ts`（点位映射、无订单时不带 points）＋ `tests/app-bitget-mode.test.tsx` 仍绿。

## 6. 前端点位产出

- [ ] `src/ui/trade-markers.ts` 改为导出 `ChartPoint[]`（`tradeChartPoints` / `allTradeChartPoints`），内部：有 `points` 展开多点，否则用 entry/exit 生成两点。
- [ ] `muted` 表示非当前交易；`key` 用订单 id 或 `entry/exit`。
- [ ] `chartDataWithWhitespace` 调用处改为传点位时间。

**验证**：`npm test -- tests/trade-markers.test.ts`（改写断言：有明细展开多点、无明细两点、muted 标记正确）。

## 7. Canvas 圆点 + 悬停卡片

- [ ] 新增 `src/ui/trade-marker-primitive.ts`：`ISeriesPrimitive` 实现，绘制逻辑按预览页已验证的画法（直径 11px 圆点、开 low 下方 / 平 high 上方、同侧错开、`useMediaCoordinateSpace`）。
- [ ] 新增悬停卡片：`subscribeCrosshairMove` + 命中半径 16px + 定位避让；卡片样式落到 `styles.css`（沿用预览页的配色与排版）。
- [ ] 卡片内容：开/平、时间、价格、数量、杠杆、手续费、来源（止损标红）、盈亏（正绿负红）。

**验证**：`npm test` 全绿；手工在浏览器核对五种场景 —— 单开单平、加仓轮、分批平轮、归属失败降级、悬停卡片定位贴边。

## 8. 接入 TradeChart

- [ ] `TradeChart` 移除 `createSeriesMarkers`，改挂 primitive；Eye / MapPin 开关改为控制 primitve 绘制。
- [ ] 全部开平仓模式展开每轮全部动作点（用户明确选择），非当前轮 `muted`。
- [ ] 确认 `FreeReplayChart` 未受影响。

**验证**：`npm test`（`app-bitget-mode` / `app-chart-price` / `app-review-progress` 全绿）；浏览器手工确认拖拽/缩放下点位跟随、无卡顿。

## 9. 收尾

- [ ] 同步按钮的结果文案带订单数与耗时；失败信息可见。
- [ ] 删除 `preview/` 临时目录。
- [ ] `npm test` + `npx tsc --noEmit` 全绿。

## 验证命令

```bash
npm test
npx tsc --noEmit
```

## 回滚点

- 步骤 1–5（数据层/同步/API）为纯新增，回滚 = 删新文件 + 还原 `bitget-sync.ts` / `app-plugin.ts` 的增量。
- 步骤 6–8（前端）为主路径替换，回滚 = 恢复 `trade-markers.ts` 旧导出与 `TradeChart` 的 `createSeriesMarkers` 调用。
