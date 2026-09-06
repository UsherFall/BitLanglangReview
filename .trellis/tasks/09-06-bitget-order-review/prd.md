# Bitget API 拉单复盘自己的交割单

## Goal

在本地复盘工具中新增与「交割单复盘 / 回溯复盘 / 选币」并列的第 4 个导航模块：用户在本机配置只读 Bitget API key 后，从 Bitget 拉取自己 USDT 本位永续合约的**已平仓历史仓位**（history-position，等价于 xlsx 交割单的一行=开→平一轮），复用同一套复盘工作台（行情图+进出场标注+画线、标签/备注/收藏、进度统计），对自己实盘交割单做持续复盘——免去每次手动导出 xlsx。

产品价值：把"从静态 xlsx 复盘"升级为"直接连自己账户拉已平仓单子复盘"。

## 背景与事实（2026-09-06 勘查）

- 纯 TS 单仓（React18+Vite+better-sqlite3），后端 = vite 插件 connect 中间件路由，全部路由在 `src/server/app-plugin.ts`；SQLite 无 ORM，store 类原生 SQL。
- 模块并列机制：`src/ui/App.tsx:84` `ReviewMode` + `:557-561` 导航按钮 + 侧栏/工作区条件分支。现有 3 模块：trade=交割单复盘(xlsx)、freeReplay=回溯复盘、scan=选币。
- **UI 单体约束**：trade 复盘工作台全部内联在 `src/ui/App.tsx`（2000+ 行），`TradeChart`:1410、FreeReplay 图表、Metric/格式化 `:2029-2053` 均未导出；独立成文件的仅 `ReviewEditor.tsx`、`trade-markers.ts`、`review-progress.ts`、chart-*.ts 等。
- `Trade` 模型（`src/domain/trade.ts:3-23`）字段目前全部 required number；xlsx 导入在 `src/server/trade-import.ts:53-62` 用 `?? 0` 兜底。
- 仓库当前**零** Bitget/私有 API 基建；唯一密钥先例 `SERVERCHAN_KEY` 走 `.env`（`vite.config.ts:6-8`）。HTTP seam：`src/server/http.ts`。K线一律复用 `candlestick-service`（OKX 行情），trade 复盘用 OKX instrument 名（如 `BTC-USDT-SWAP`）。
- 复盘数据侧共享：`trade_reviews`(按 trade_id)、`/api/reviews`、`/api/tags/*`、`/api/candles`、`/api/drawings` 全部按 id/instrument 键控，新模块可直接复用；xlsx trades 只在内存、不入库。

### Bitget V2 API 核实结论（对照官方文档与 ccxt `ts/src/bitget.ts`）

- 私有签名：headers `ACCESS-KEY / ACCESS-SIGN / ACCESS-TIMESTAMP / ACCESS-PASSPHRASE`；签名串=`毫秒时间戳 + METHOD + '/api' + requestPath`，GET 查询参数需拼入 requestPath 且按键排序、原值拼接后再签（ccxt bitget.ts:11526-11576）；HMAC-SHA256 + Base64。
- **数据源主接口 `GET /api/v2/mix/position/history-position`**（`productType=USDT-FUTURES`）：每行=一笔已平仓轮次，含 `symbol`(如 XRPUSDT)、`holdSide`(long/short)、`openAvgPrice/closeAvgPrice`、`openTotalPos/closeTotalPos`、`pnl`、`netProfit`(=pnl+资金费+开平手续费)、`totalFunding`、`openFee/closeFee`、`ctime/utime`、`marginMode`（ccxt bitget.ts:11011-11042）。单窗最大 3 个月、`limit`≤100、`cursor` 分页。
- 相关：`/api/v2/mix/position/all-position`(当前持仓)、`/api/v2/mix/order/fill-history`(成交流水,≤3月)、`/api/v2/mix/order/orders-history`；只读权限即可。

## Requirements

- R1 并列入口：`ReviewMode` 增加 `'bitget'`，导航增加第 4 个按钮（名如「Bitget复盘」），侧栏收起态标签同步；trade/freeReplay/scan 外观与行为不变。
- R2 共享工作台（纯搬移重构，trade 模式行为零变化）：把 trade 模式的复盘 UI 从 `App.tsx` 内联代码提成可复用组件/钩子（队列筛选+进度+列表、详情头+TradeChart+指标条+ReviewEditor、星级/标签全局操作、时间周期切换），以"数据源 endpoint"为唯一差异参数；trade 与 bitget 两种模式渲染同一套工作台。由既有 UI 测试兜底。
- R3 密钥设置：服务端新增配置读写（`data/bitget-keys.json`，权限 0600，git-ignored），GET 只回 `{ configured: boolean }` 永不回显密钥；模块内提供设置表单（apiKey/secret/passphrase）与"权限需勾选只读、建议绑 IP"的说明文案。
- R4 Bitget 私有客户端：本地时间与 `/api/v2/public/time` 校准偏差；HMAC-SHA256 签名 + ACCESS-* 请求头；请求走既有 `FetchJson` seam（重试/代理）；HTTP/业务错误映射为可读消息（key 无效 / passphrase 错误 / IP 白名单拦截 / 限频）。
- R5 同步引擎与缓存：新 SQLite 表（原始行 + 确定性 trade id + utime）缓存拉取结果；按 ≤3 个月窗口 + cursor 翻页，从起始时间拉到当前；默认最近 90 天；`upsert` 幂等，重复同步不产生重复行，不做删除；返回本次新增/覆盖数与错误摘要。
- R6 归并映射（纯函数，单测覆盖）：history-position 行 → `Trade`：
  - id：`bg-` + 对 (symbol, holdSide, ctime, utime, openAvgPrice, closeAvgPrice, closeTotalPos, netProfit) 的确定性摘要（避免依赖 positionId 是否存在）；
  - instrument：Bitget `BTCUSDT` → 图表用 OKX 名 `BTC-USDT-SWAP`（映射规则 `去掉尾部 USDT 的币种 + '-USDT-SWAP'`）；
  - direction：holdSide long→多 / short→空；entry/exitTime：ms → 上海时区 ISO（与 xlsx 一致 `+08:00`，用于队列日期切片与 K线锚点）；entry/exitPrice=开/平均价；profit=netProfit（已含资金费与手续费，与"收益"口径一致）；fee=|openFee|+|closeFee|；
  - Bitget 无法提供的字段置空（见 R9）；amplitude=null；sourceNote 标记数据来源。
- R7 列表 API：`GET /api/bitget/trades` 复用 `buildReviewQueue` 同一筛选/排序契约返回（trades/instruments/tags/tagCounts）；评论/标签/画线/K线全部走既有路由。
- R8 模块页：进入模块时若无 key 则引导设置；有 key 后显示同步范围（默认最近 90 天，可自定义起始时间）→ 同步按钮与进度/结果/错误 → 下方即共享工作台的交易队列。
- R9 Trade 可空性扩展：`leverage / margin / maxPositionValue / returnRate / turnover` 改为 `number | null`（Bitget 源无杠杆/保证金，收益率不引入含杠杆的近似值以免误导）；xlsx 路径仍为数字不受影响；列表与指标条对 null 显示 "—"；排序按 returnRate 时 null 恒沉底（`compareByField` 兼容）；`review-progress` 仅用 profit 不受影响。

## Acceptance Criteria

- [ ] A1（R1）界面出现第 4 个并列模块入口且可切换，其余三模块行为不变。
- [ ] A2（R3/R8）无 key 时模块内可完成密钥设置；设置后 `configured=true`；重启后仍生效；任何接口不回显密钥明文。
- [ ] A3（R4/R5/R6）配置只读 key 后，点同步能从 Bitget 拉到已平仓仓位并落库；重复同步行数不增长；错误（key/passphrase/IP）以可读消息呈现。
- [ ] A4（R2/R6/R7/R9）归并后的实盘交易出现在与「交割单复盘」相同的工作台中：筛选/进度/列表一致；点开交易 K线图标注进出场可正常复盘（标签/备注/收藏/画线）；Bitget 行无杠杆/保证金/收益率处显示 "—" 且不报错。
- [ ] A5（R2）重构后 `npm test` 全绿；trade 模式（xlsx 源）在浏览器中的表现与重构前一致。
- [ ] A6（R3）`data/bitget-keys.json` 不进入 git；仓库代码不含明文密钥。

## Out of Scope

- 实盘下单/交易执行/自动跟单（本模块只读）。
- 现货、币本位/USDC 本位、跟单/子账户数据的拉取。
- 成交流水 fill 级逐笔复盘与开平 fill 配对算法（future，若需基于 `history-position` 上再加层）。
- 组合级资产/盈亏总览仪表板。
- 密钥加密（系统钥匙串）与密钥轮换自动化。

## Key Decisions（均已与用户确认，2026-09-06）

- D1 独立并列新增第 4 模块；现有「交割单复盘」(xlsx) 保持不动。权衡：两入口数据同源时未来再评估合并。
- D2 仅拉 USDT 本位永续合约（USDT-FUTURES）。
- D3 密钥本地明文即可（只读 API）：界面表单写入 `data/bitget-keys.json`（git-ignored、0600）。
- D4 复盘粒度=已平仓整轮（`history-position`），不做 fill 配对。
- D5 UI 复用路线=把 trade 模式工作台**纯搬移提成共享组件**（行为不变），Bitget 模块换数据源复用。

## Risks / Deferred

- App.tsx 重构为最大改动面：靠既有 UI 测试（app-tag-management / app-review-progress / app-drawings / review-editor / free-replay 等）+ tsc + 手工回归兜底；若抽取中 trade 分支行为偏差立即回滚该步。
- Bitget 历史可回溯深度以官方实际为准（单窗 3 个月），起始时间早于平台保留范围时 API 报错需透出可读提示。
- OKX 行情对个别 Bitget 交易对可能无 K线（下架币），图表加载失败表现需与既有 trade 模式下架币一致。
- `history-position` 是否恒定返回 positionId 存疑：故 trade id 采用字段摘要而非 positionId。
