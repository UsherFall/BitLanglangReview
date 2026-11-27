# 修复跨周期误触止损并恢复BTC持仓

## Goal

让回溯复盘在切换周期后只使用新推进时间段的行情触发模拟订单，杜绝把开仓/下单前的粗周期 OHLC 当作新行情；同时纠正 BTCUSDT `2021-02-28 12:00` 会话中已经被误损的 `position-31`，恢复成一笔合并后的持仓。

## Background

- 目标会话数据源为 Bitget。`position-31` 在北京时间 2021-03-26 15:45 以 53156.5 做多，却在 16:00 被记录为 52403 止损（`fill-35` / `fill-36`）。
- 开仓后的 15m K线最低分别为 53099.5、53462，均未触及止损；15:00–16:00 的 1H K线最低 52398.5 位于开仓前。切到 1H 后步进误用了整根 1H OHLC。
- 根因锚点：`src/ui/use-free-replay-session-lifecycle.ts:269-272` 将新揭示 Cursor K线送入 Paper；`src/ui/free-replay-paper-trading.ts:163-169` 触发各仓止损；`src/ui/free-replay-paper-trading.ts:629-630` 对整根 K线判断 `low <= stopPrice` / `high >= stopPrice`。
- 用户选择“细周期精确重放”，不采用可能漏掉真实成交的“跳过整根过渡粗K线”。

## Requirements

### R1 — 只执行新推进区间

- 每次步进只能处理 `(previousProgressTime,nextProgressTime]` 的行情；细周期开仓/设损后切粗周期，过渡粗K线的开仓前部分不得触发止损、止盈或限价单。
- 过渡K线存在自动订单时，从同一会话的 instrument、Candle Source 和 Candle Grid 加载细K线，选择能对齐首尾边界的最粗子周期，逐根复用 `processRevealedCandle`，eventTime 使用子K线自身完成时间。
- 普通同周期步进保持同步原路径；没有自动订单时不额外加载。现有止损优先、每仓独立止损、权益/FIFO、Focus、ended 冻结和游标契约不变。
- 执行细K线只用于成交，不进入 Dataset 或图表，不泄露/渲染 `nextProgressTime` 之后的行情。
- 必须获得连续完整的新片段才可成交和推进。请求失败、缺K线或分页不前进时，Replay/Paper/Focus 不变并显示可重试错误；禁止退回整根粗K线猜测成交。
- 异步 pending 时拒绝重复步进；start/restore/delete/switch/rewind/end/resume/Paper 修改或卸载后，迟到响应不得提交。pending/error 不进入会话持久化。

### R2 — 纠正并合并 position-31

- 仅修改目标会话：删除 `fill-35`、`fill-36`，撤销其合计 -98.99813938708418 USDT 误判已实现亏损；保留此前成交、`nextId=37`、15m cursor=`1616744700` / progress=`1616745600` 和其他会话。
- 恢复 active Paper Trading 中的一个多头 `position-31` / 一个 leg（首仓 `leg-32`），entry/origin time=`1616744700000`、entry/origin price=53156.5、stopPrice=52403，pending entry/exit 为 null。
- 第一仓按用户指定意图“原保证金不变、1x 改 10x”重算：margin=821.6393452249565、notional=8216.393452249566、quantity=0.15456987296472804。
- 第二仓保持 margin=616.2295089187173、notional=6162.295089187173、quantity=0.11592740472354601。
- 合并结果：margin=1437.8688541436738、notional=14378.688541436739、quantity=0.27049727768827403、leverage=10、entryPrice=53156.5、stopPrice=52403。
- 写入前关闭/离开目标回溯页面，避免旧浏览器 autosave 覆盖；用 SQLite backup API 做一致性备份，并以原始 Paper blob SHA-256 `724f6e7829918e68064d965ff7b4363640021f82120c9fc4951627b98013aa72`、`position=null`、两笔 fill 和游标关键字段为事务前置条件。任何不匹配都不得写入。

### R3 — 验证与恢复能力

- 添加本次 15m→1H 真实数据回归，修复前失败、修复后通过；覆盖普通触损/未触损、过渡段真实触损、开仓前高低点、其他自动订单、连续性和异步竞态。
- 数据脚本默认 dry-run，只有显式 apply 才写入；事务内重读校验、要求仅更新目标一行，commit 后用新连接复核。
- 修复后 realized PnL=2286.557380899826、available margin 约为 1848.688526756152（允许浮点末位误差）；Paper Round Library 不得把仍持仓的 position-31 列为已完成回合。
- 记录备份路径和校验结果；不得用“重置模拟交易”代替数据修复。

## Acceptance Criteria

- [x] **AC1 / R1：** 本次粗 1H K线虽含开仓前 52398.5，细周期新片段未触 52403 时 position-31 类持仓保持，cursor/progress 正常推进。
- [x] **AC2 / R1：** 同一过渡片段若在开仓后真实触价，仍按止损价和实际子K线完成时间成交；普通同周期成交与止损优先测试不回归。
- [x] **AC3 / R1：** 限价开仓/止盈也不会被 previousProgressTime 前的 OHLC 触发；细周期请求沿用会话行情源且不进图表窗口。
- [x] **AC4 / R1：** 加载失败/缺数据/重复点击/迟到响应均不会产生部分推进或幽灵成交；错误可重试，ended 与 autosave 契约保持。
- [x] **AC5 / R2：** 目标会话重新读取后只有一个合并持仓，数值、止损、历史成交、ID 序列和游标完全符合 R2，两笔误损成交消失。
- [x] **AC6 / R2–R3：** 已有一致性备份；前置条件不匹配会安全中止；其他会话与真实 Bitget 数据不变，开放回合不出现在模拟单库。
- [x] **AC7 / R3：** 聚焦测试、`npx tsc --noEmit` 和任务 context 校验通过，相关 spec 已同步；全量 `npm test` 的 788 个可运行用例通过，唯一 suite 失败为既有 level-alert 归档 pool fixture 缺失（详见实施记录）。

## Out of Scope

- 不调整正常止损以触发价成交的规则，不引入滑点、手续费或新的爆仓模型。
- 不修改其他历史回合，不批量重写已有会话；不修改真实 Bitget 交割单或交易所数据。
- 不改变杠杆、仓位比例和复利规则；R2 仅是用户明确指定的一笔反事实纠正。
- 不为执行片段新建行情 API、数据库表或 session 字段，不引入 tick 级成交模型。
