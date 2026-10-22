# Journal - Fuzz (Part 1)

> AI development session journal
> Started: 2026-10-21

---



## Session 1: 修复 Bitget K线翻页两处死角（老锚点空图 / later 首根丢失）
<!-- trellis-session: v=2 fp=be6b524d3b01a1f4 -->

**Date**: 2026-10-21
**Task**: 修复 Bitget K线翻页两处死角（老锚点空图 / later 首根丢失）
**Branch**: `master`

### Summary

诊断『个人交割单复盘小周期没数据、日线不齐』：实测 Bitget 两端点窗口语义（/candles 按开盘时刻、startTime 排他、取窗口内最新 limit 根；/history-candles 按收盘时刻、深历史全周期都有），发现翻页实现的两个死角并修复 bitget-candles.ts——(1) 首页 /candles 为空的老锚点改为从 history-candles 取游标（修掉老交易 5m/15m/1H 全空、1D 回滚到≈2023 断）；(2) later 首页窗口改为 (anchor, anchor+perPage*step] 修复锚后首根被排他边界挤掉（修掉小周期后半区全空），1W/1M 页窗口钳 90 天 span 上限；新增 history 前向页（endTime-only）。修正 paging 测试 fake 为实测语义（旧 fake 语义错是 bug 溜过测试的原因），新增 5 个回归测试，全量 586 测试通过；spec market-data.md 沉淀口径与回退规则。另修复 pi 会话 bash 不可用问题（shellPath 指向 E:\git\bin\bash.exe）。

### Git Commits

| Hash | Message |
|------|---------|
| `f2aa379` | fix(bitget): K线翻页两处死角 —— 老锚点回退 history-candles，later 首窗对齐排他边界 |

### Status

[OK] **Completed**


## Session 2: 选品正名「主升浪候选」+ 新增「标线监控」视图
<!-- trellis-session: v=2 fp=077e0f24c0f88f46 -->

**Date**: 2026-10-21
**Task**: 选品正名「主升浪候选」+ 新增「标线监控」视图
**Branch**: `master`

### Summary

范围 B 落地：方法下拉「距你标的线」改「主升浪候选」并新增「标线监控」(method=watch)——行集合为画了线的币，不经粗筛/品种/休市门，解析不到的币走 missingInstruments 上报；距线测量与排序同 shrink 共用 measureLevelAlert/closestRatio（有一致性测试）。粗筛判据按用户确认不动。顺带按用户指示删除 tools/（dsh 插件 49 个 tsc 错误 + 已归档的 labeling 工具）并把 tsconfig include 收窄，全库 tsc 归零；71 文件 586 测试全绿。

### Git Commits

| Hash | Message |
|------|---------|
| `d0541d7` | feat(scan): 选品「距你标的线」正名「主升浪候选」，新增「标线监控」视图 |
| `2b8570b` | chore(tools): 删除 tools/ —— dsh-trellis-plugin 类型错误与已归档的 labeling 工具 |

### Status

[OK] **Completed**


## Session 3: 修复 Bitget later K线未收盘bar进入缓存
<!-- trellis-session: v=2 fp=d275b6a4f819de48 -->

**Date**: 2026-10-22
**Task**: 修复 Bitget later K线未收盘bar进入缓存
**Branch**: `master`

### Summary

个人交割单复盘的 Bitget later 取数缺已收盘过滤：initial 半窗拉入场后 150 根 bar（1D 约 150 天），把当前未收盘日线写入 review.sqlite 并永久冻结（7 个合约实锤）。requestLaterPage 与单请求 later 分支补 isClosedBar（对齐 OKX/Binance 09/20 起的方向无关不变量）；一次性清理 bitget: 命名空间（marker 守卫，真库已执行）。新增 4 用例，593 测试全绿，spec 补 10/22 记录。

### Git Commits

| Hash | Message |
|------|---------|
| `f565490` | fix(bitget): later K线丢弃未收盘bar + 一次性清理已污染缓存 |

### Status

[OK] **Completed**
