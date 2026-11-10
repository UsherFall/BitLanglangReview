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


## Session 4: 画线跨周期可见性回归修复 + 标线监控端到端验证
<!-- trellis-session: v=2 fp=5e78a1c51a3d4535 -->

**Date**: 2026-10-22
**Task**: 画线跨周期可见性回归修复 + 标线监控端到端验证
**Branch**: `master`

### Summary

选品画线 10/21 距线改造误把图表加载按周期过滤，恢复 instrument 级可见（useChartDrawings 单点：GET 去 timeframe、effect 去依赖），距线扫描测量粒度不变；spec 矛盾（component vs quality guidelines）已消除。另对运行中服务实测 scanWatch：用户当日所画 BNB/HYPE/DOT/PEPE/SYN 5 币全部进入监控名单且均 alert，跨所价位基准换算生效，CORE/EPIC 因 Bitget 无该合约进 missingInstruments。594 测试全绿。

### Git Commits

| Hash | Message |
|------|---------|
| `5952104` | fix(drawing): 恢复画线跨周期可见，距线测量粒度不变 |

### Status

[OK] **Completed**


## Session 5: 复盘图表画线与步进体验修复
<!-- trellis-session: v=2 fp=4c80e202fc8c5391 -->

**Date**: 2026-10-28
**Task**: 复盘图表画线与步进体验修复
**Branch**: `master`

### Summary

回溯复盘三项修复：大周期射线切小周期消失（timeToCoordinate 对未加载数据返回 null，改为 coordinateForTime 边界K线网格外推/缺口内插）；画完一根自动退出画线工具；步进不再回拉画面（cursor follow 改舒适区判定，±10 根内不动、越界最小平移）。附带排查用户现场『下一根加载不出来/仓位不见』：根因为 Binance 断连（旧会话 binance-only 源），仓位安全存于 DB，恢复会话可取回；加网络失败不丢仓位回归测试。spec 更新 component/quality guidelines；任务 10-28-replay-drawing-viewport 已归档。

### Git Commits

| Hash | Message |
|------|---------|
| `f227862` | fix(drawing): 大周期线切小周期仍可见 —— 越界锚点坐标外推 + 画完自动退出工具 |
| `ccb9e7e` | fix(replay): 步进不再回拉画面 —— 光标离开舒适区才最小平移；补K线加载失败不丢仓位回归测试 |
| `41c03c7` | docs(spec): 画线越界外推、单发工具、光标跟随舒适区契约 |

### Status

[OK] **Completed**


## Session 6: 回溯复盘标记层对齐交割单复盘 + 会话切换面板跟随
<!-- trellis-session: v=2 fp=dd42e87b6327f4f3 -->

**Date**: 2026-11-02
**Task**: 回溯复盘标记层对齐交割单复盘 + 会话切换面板跟随
**Branch**: `master`

### Summary

回溯复盘开平仓标记换成交割单复盘同一套 TradeMarkerPrimitive 画布圆点+悬浮卡片；paperTradeChartPoints 锚定包含成交瞬间（完成时刻-1）的已加载K线，修复 2023.3 BTC 会话细周期做单、粗周期查看时标记左移一根蜡烛（实测修复后 57/57 点位落对蜡烛）；隐藏眼睛只留焦点单；模拟面板按会话身份重挂（单子/本地状态不跨会话残留）。620 测试全绿。排查确认：缓存 K 线与币安逐根一致、4-9 1:00 蜡烛差异为 venue 差异；发现偶发 K 线空缺 = 缓存洞（见后续任务）。

### Git Commits

| Hash | Message |
|------|---------|
| `84b48f1` | fix(replay): 开平仓点位换交割单复盘圆点管线 —— 锚定包含成交时刻的K线修复跨周期错位；眼睛按钮只留焦点单；面板随会话切换重挂 |
| `1fd7cff` | docs(spec): 回溯复盘标记层契约 —— 成交时刻锚定、焦点过滤、面板会话重挂 |

### Status

[OK] **Completed**


## Session 7: 回溯复盘行情源可选 + K线缓存洞回填与自愈 + 模拟交易权益制
<!-- trellis-session: v=2 fp=f03563ea1d631bd3 -->

**Date**: 2026-11-03
**Task**: 回溯复盘行情源可选 + K线缓存洞回填与自愈 + 模拟交易权益制
**Branch**: `master`

### Summary

回溯复盘行情源做成选品同款可选（币安/OKX/Bitget）：开始面板三选一、进行中会话头部切源（进度/单子保留、光标按新源网格重算）、交易对词汇跨源翻译（BTCUSDT↔BTC-USDT-SWAP）、修复自动保存丢 candleSource 与按字段存在性映射网格的回归；一次性回填脚本 tools/backfill-candles.ts 补齐 BTC 三命名空间落在会话区间的全部缓存洞（偶发K线空缺根因，命名空间键写库/限速取数/2万根上限），客户端中段洞自愈（可见范围∪光标前方20根对洞中心取initial窗）；模拟交易开仓改权益制复利（可用=本金+已实现盈亏-占用，面板显示权益）。发现并修复回填游标取行序导致的 Bitget 升序翻页失效。635 测试全绿（level-alert-parity 为既有环境性缺失数据失败）。

### Git Commits

| Hash | Message |
|------|---------|
| `cde0c3d` | feat(replay): 行情源可选（币安/OKX/Bitget）+ K线缓存洞回填与中段洞自愈；修复自动保存丢 candleSource |
| `4f2ced8` | feat(replay): 模拟交易开仓改权益制（复利）—— 可用额度 = 本金 + 已实现盈亏 − 持仓占用；面板显示当前权益 |

### Status

[OK] **Completed**


## Session 8: 回溯复盘模拟后锁回退 + 焦点单开仓点前视图 + 顶部读数面板右对齐
<!-- trellis-session: v=2 fp=a41c9e02 -->

**Date**: 2026-11-03
**Task**: 回溯复盘：模拟交易后锁回退、开仓点前视图、顶部面板重叠修复
**Branch**: `master`

### Summary

三项回溯复盘交互改进（Fuzz 反馈）：①开始模拟交易后「上一根 K 线」置灰 + 键盘 ← 堵死（函数级守卫在 rewindFreeReplayCandle 入口；键盘订阅 effect deps 补 paperTrading.active 防闭包陈旧——按钮堵了键盘还漏的坑）；②焦点单「开仓点前」视图：工具栏剪刀按钮（有焦点单才渲染）把揭示边界临时换轨到开仓点——渲染/磁吸边界严格小于 positionOpenTime（同周期成交时开仓后首根恰从该时刻开档，`<=` 会泄漏一根未来，实现时修掉），右缘翻页闸用早一个 step 的闸边界（数据集到开仓 candle 即停发 mode=later，杜绝 11-03 同型请求风暴），开启瞬间开仓 candle 锚右缘留 10 根，退出焦点自动复位、不进会话保存；③hover 百分比面板与复盘图 OHLC 读数条都写死 left: 252px（工具栏 252px 年代的对齐值，现 ~270/~332px 压住尾部按钮）→ 双双改右对齐。新增 6 用例（回退锁正负对照、隐藏/恢复+锚定、隐藏态零 later 请求、退出复位+重点不残留、组件级 canRewind），647 全绿（level-alert-parity 既有环境性失败）。spec 补三节契约：回退锁、开仓点前视图双边界、顶部面板右锚规则。

### Git Commits

| Hash | Message |
|------|---------|
| `fbe90be` | feat(replay): 模拟后锁回退 + 焦点单开仓点前视图 + 顶部读数面板右对齐 |

### Status

[OK] **Completed**


## Session 9: 回溯复盘侧栏列表自适应 + 模拟单库交互 + 切周期视图回右缘
<!-- trellis-session: v=2 fp=fcc72256c773c0c7 -->

**Date**: 2026-11-04
**Task**: 回溯复盘侧栏列表自适应 + 模拟单库交互 + 切周期视图回右缘
**Branch**: `master`

### Summary

三个 UI 小修 + 一个视图缺陷任务。UI：历史会话/模拟单库列表高度从写死 260px 改为视口钳制，模拟单库进一步改 flex 填满铺到页面底部（收起退回内容高度），库行点选/批注展开加蓝色选中高亮。任务 11-04-replay-timeframe-switch-viewport：修复回溯复盘切周期后视图不落光标右缘——首锚守卫加 renderedRangeKeyRef（旧周期数据帧不消费锚定，新数据落地才锚，会话切换同坑一并覆盖）、switchFreeReplayTimeframe 清 orderFocus（焦点单不再跨周期存活，行高亮/剪刀态复位），游标数据集加 cursorCandlesRangeKeyRef 盖章防旧数据误发布；四个测试用例改写/新增（含首锚时机回归），全量 684 用例通过。遗留观察项：翻页加载器响应缺 rangeKey 过期守卫（既有弱点，后续轻量任务加固）；一次未复现的全量偶发失败（疑似并行负载下 waitFor 超时）。

### Git Commits

| Hash | Message |
|------|---------|
| `9c3cbce` | fix(replay): 历史会话/模拟单库列表高度自适应视口 |
| `5813069` | fix(replay): 模拟单库列表铺满到页面底部 |
| `16ea543` | feat(replay): 模拟单库行选中高亮 |
| `f31793d` | fix(replay): 切周期首锚等新数据落地 + 焦点单不跨周期 |

### Status

[OK] **Completed**


## Session 10: 修复回溯复盘 StrictMode K 线空白
<!-- trellis-session: v=2 fp=7bb89d9ae2e6d11f -->

**Date**: 2026-11-05
**Task**: 修复回溯复盘 StrictMode K 线空白
**Branch**: `fix/replay-candlestick-regression`

### Summary

定位并修复 Free Replay 在生产 React.StrictMode 下无 K 线：effect 重放复用了已 dispose 的 render-scope Dataset，首次有效响应被丢弃且二次 syncRange 空转。改为订阅 effect 每次 setup 创建实例、cleanup 对称 dispose，所有命令读当前 ref，latest callback refs 保持 mount-only；新增生产包装 StrictMode 红绿回归。focused 76 通过、全量可运行 77 文件/707 测试通过、tsc 与 diff check 通过；原始 npm test 仅既有 level-alert-parity 缺 gitignored pool 数据失败，按历史既定口径单独记录。更新 hook/Dataset/quality specs，归档缺陷子任务，父架构任务继续。

### Git Commits

| Hash | Message |
|------|---------|
| `d4e55a1` | fix(replay): 修复 StrictMode 下 K 线空白 |
| `52d4748` | docs(task): 记录回溯复盘 K 线回归验收 |

### Status

[OK] **Completed**


## Session 11: 完成架构深化全部七项交付
<!-- trellis-session: v=2 fp=dd6f9270d633fbd3 -->

**Date**: 2026-11-05
**Task**: 完成架构深化全部七项交付
**Branch**: `feat/architecture-deepening`

### Summary

父架构任务 #1–#7 全部提交、验收并归档。新完成：Session 生命周期 hook（状态/自动保存/恢复/删除墓碑与 cursor commands，7 个直接测试）；真实 SQLite 同事务 Session+Paper Review 级联（触发器证明第二步失败会回滚）；15 个路由按工作流提取且保留 Vite 组装根/顺序和 Bitget Adapter 隔离；共享 Session/Trade/Paper 响应类型、nominal timeframeMs 与泛型 mergeCandles 收进纯 domain，Store 以显式泛型保留旧 JSON。此前 StrictMode K 线空白修复一并纳入父验收。最终 84 文件/725 可运行测试通过，tsc 与 CRLF-aware diff check 通过；原始 npm test 仍仅既有 level-alert-parity 缺 pool fixture 失败。无全局 store、通用 Router、ORM、依赖或 schema/data 迁移，相关 domain/frontend/server specs 均已更新，父任务集成证据落盘。

### Git Commits

| Hash | Message |
|------|---------|
| `9e627a6` | fix(replay): 统一行情源与 Candle Grid 上下文 |
| `665ad0d` | refactor(replay): 收拢 Cursor 与 Focus 双数据集协议 |
| `d4e55a1` | fix(replay): 修复 StrictMode 下 K 线空白 |
| `81896b4` | refactor(replay): 收拢 Session 生命周期 |
| `720367d` | fix(replay): 事务化会话级联删除 |
| `9f771a2` | refactor(server): 按工作流收拢路由模块 |
| `4c78c8d` | refactor(domain): 收拢共享响应与 Candlestick 契约 |

### Status

[OK] **Completed**


## Session 12: 回溯复盘结束与恢复复盘
<!-- trellis-session: v=2 fp=9bf392452989461f -->

**Date**: 2026-11-10
**Task**: 回溯复盘结束与恢复复盘
**Branch**: `feat/replay-end-review`

### Summary

实现 active/ended 会话状态、SQLite 旧库迁移、交易与 K 线进度双重冻结、只读单子查看和原样恢复；补齐历史恢复防绕过及持久化测试。相关测试与类型检查通过，排除既有缺失 level-alert fixture 后全量 735 项测试通过。

### Git Commits

| Hash | Message |
|------|---------|
| `7a24f8e` | feat(replay): 增加结束与恢复复盘冻结态 |
| `06e803a` | docs(spec): 回溯复盘结束恢复状态契约 |

### Status

[OK] **Completed**
