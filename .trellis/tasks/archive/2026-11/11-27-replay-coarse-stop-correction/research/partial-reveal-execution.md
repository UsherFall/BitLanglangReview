# 跨周期过渡 K 线的精确成交研究

## 真实数据复现

目标：`data/review.sqlite` 中 `BTCUSDT` / `2021-02-28 12:00` / Bitget 会话。

- `position-31` 的两笔成交为 `fill-35`（1x）和 `fill-36`（10x），均以 53156.5 开仓、52403 平仓；entryTime=`1616744700000`，exitTime=`1616745600000`。
- 53156.5 是 Bitget 15m `2021-03-26 07:30Z` K线的收盘价，因此开仓事件为 07:45Z（北京 15:45）。
- 切到 1H 时，`freeReplayCursorTimeForTimeframeSwitch(1616744700,'1H','shanghai')=1616738400`（06:00Z）；下一根揭示 07:00Z–08:00Z 的 1H K线。
- 该 1H K线 low=52398.5，满足现有多头 `low <= 52403`，所以产生上述精确 exitPrice/exitTime。
- 但 52398.5 属于 07:00Z 的 15m K线，在开仓前；07:45Z 的 15m K线 low=53099.5。用当前函数以该 1H K线处理会平仓，以 07:45Z 的 15m K线处理则继续持仓，已实际复现。

结论：不能只判断粗 K线是否包含止损价；每次步进只能成交新推进区间 `(previousProgressTime,nextProgressTime]` 内的行情。

## 现有代码边界

- `src/ui/use-free-replay-session-lifecycle.ts`：同步 reveal，直接把新揭示的 Cursor candle 和 `nextReplay.progressTime` 传给 Paper Trading。
- `src/ui/free-replay-paper-trading.ts`：`processRevealedCandle` 已封装限价开仓、每仓止损、止盈及其优先级；细周期重放必须复用它，不能复制一套成交规则。
- `src/ui/free-replay-dataset.ts`：只拥有图表 Cursor/Focus/Active/Rendered 窗口。执行用细周期数据不得注入这些窗口，否则会造成未来泄露/拼窗。
- `src/ui/chart-time.ts`：已有日界 grid、进度→游标和 K线完成时间规则；子周期边界对齐必须复用同一 grid。

## 可复用行情接口

无需新增服务器路由。`GET /api/candles` 已支持：

- `source=bitget|okx|binance-only`，与会话保存的 `candleSource` 一致。
- `timeframe`、`mode=initial|earlier|later`、`anchor`、`entryTime`。
- `initial` 合并 entry 前 150 根与后 150 根；`later` 可继续向后翻页。
- Bitget 在 chart 请求中启用分页；OKX/Binance 也沿用同一标准化 Candlestick 返回。

执行loader以 `fromMs=previousProgressTime*1000` 为 initial anchor，过滤并验证 `[fromMs,toMs)` 的子周期开盘时间；若 150 根不足，再以当前最新一根为 later anchor 续页。最终必须精确覆盖 `fromMs + i*childStep`，直到 `toMs-childStep`。任何缺口、空响应或不再前进都报错，不得退回粗 K线成交。

## 子周期选择

为兼顾准确性和请求量，选择能对齐 `previousProgressTime` 与 `nextProgressTime` 的**最粗子周期**，且只保留该段完整子K线：

- 5m → 1m
- 15m → 5m → 1m
- 1H → 15m → 5m → 1m
- 4H → 1H → 15m → 5m → 1m
- 1D → 4H → 1H → 15m → 5m → 1m
- 1W → 1D → 4H → 1H → 15m → 5m → 1m
- 1M → 1D → 4H → 1H → 15m → 5m → 1m（1W 不能稳定平铺自然月）

本次 07:45Z 与 1H 的 08:00Z 完成时间都对齐 15m，因此只需 07:45Z 一根 15m K线。

## 原子性与竞态要求

- 普通、非过渡 reveal 保持现有同步路径，不请求额外数据。
- 过渡 reveal 且存在挂单/止盈/止损时才异步加载；无自动订单时无需细周期数据。
- 加载完成前不推进 cursor/progress、不改变 Paper、不清 Focus。
- 成功后按子K线顺序逐根调用 `processRevealedCandle`，eventTime 使用各子K线自己的完成时间；随后一次提交 Paper + Replay，并清 Focus。
- 请求失败或数据不完整：游标、Paper、Focus 不变，显示可重试错误。
- 加载期间发生 start/restore/delete/switch/rewind/end/resume/Paper 修改或组件卸载：作废旧 token，迟到响应不得提交。
- 重复点击/键盘 Right 在 pending 时由 UI 和 lifecycle 双重拒绝。

## position-31 恢复口径

第一笔杠杆错误的反事实重算保持其保证金不变：821.6393452249565 USDT 在 10x 下对应名义价值 8216.393452249566、数量 0.15456987296472804。第二笔保持原值。合并后：

- 一个 `position-31` / 一个 leg（采用首仓 `leg-32`），10x 多头；
- entry/origin price=53156.5，entry/origin time=`1616744700000`；
- margin=1437.8688541436738，notional=14378.688541436739，quantity=0.27049727768827403；
- stopPrice=52403；
- 删除 `fill-35/36`，保留此前成交和 `nextId=37`，position 恢复、pending 保持 null；
- timeframe=15m，cursor=`1616744700`，progress=`1616745600` 不变。

当前目标 Paper blob SHA-256：`724f6e7829918e68064d965ff7b4363640021f82120c9fc4951627b98013aa72`。修复脚本以此及关键字段做前置校验，防止覆盖规划后新增的用户操作。目标 `paper:BTCUSDT:2021-02-28 12:00:position-31` 当前无批注行。

## 必须保留的现有订单契约

以下来自 `.trellis/spec/frontend/component-guidelines.md` 的 Free Replay Paper Trading Orders（完整文件较大，上下文注入可能截断，因此在此保留本任务所需契约）：

- 订单状态转换放在 `free-replay-paper-trading.ts`，先写单元测试，再接 App 控件。
- 市价开平仓使用当前 Cursor K线收盘价；限价开平仓只在新揭示K线包含限价时成交。
- 多头止损只能低于当前价，空头止损只能高于当前价；多头用 low、空头用 high 判断触发。
- 同一根K线同时触及止盈和止损时，因 OHLC 没有盘中先后顺序，必须先执行止损。
- 每仓一个止损，平仓数量为该仓剩余数量；权益复利、部分平仓和 FIFO 契约不变。
- 修改该区域必须有 `free-replay-paper-trading.test.ts` 单元测试与 `app-free-replay.test.tsx` 可见工作流测试。

## 操作风险

浏览器若仍打开该会话，旧内存快照可能通过自动保存覆盖直接 SQLite 修复。实际写入前必须让用户关闭/离开该回溯页面；用 SQLite backup API 做含 WAL 的一致性备份，再在 `BEGIN IMMEDIATE` 事务内重读、校验、更新并复核。备份路径和修复后校验结果需记录到任务/journal。
