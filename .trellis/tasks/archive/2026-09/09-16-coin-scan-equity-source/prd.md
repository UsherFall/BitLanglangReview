# 选品模块：加密 / 股票分治 + 股票真实时段 K 线

> 父任务。直接实现工作都在两个子任务里；本任务持有原始需求集、任务图、跨子任务验收标准与最终集成验收。

## Goal

选币模块升级为**选品**，按标的类型分治为「加密」（加密 + 指数 + 商品）与「股票」（美股 + 韩股）两个子模块，分开扫描、各自独立的池子与参数。股票类标的按**真实交易时段**判定与取数：休市标的剔除（美股窗口放宽到 04:00–20:00 ET），且送入检测器的 K 线序列只保留真实时段的 bar（**会话序列**）。数据源保持**币安 USDT-M**，不引入外部依赖。

用户诉求演进（原话）：
1. 「选币模块我想他能够扫到美股，但因为美股合约不开盘的话基本没波动很容易扫到收敛的，我想换个数据源去扫」
2. 「扫现在这些交易所的应该也可以，他们好像有股票现货的k线数据…主要是不想被休市时候的k线影响」
3. 「tradingview的k线能免费拿吗…我想是这些交易所的tradefi就不去扫了，也不去维护什么开盘关盘时间，从别的地方拿是不是更好些」
4. 「选币这个模块改为选品，在里面分加密货币和美股模块，要去扫描的话可以分开扫」

## Task Map

| 子任务 | 目录 | 内容 | 依赖 |
|---|---|---|---|
| A | `09-16-equity-yahoo-candles` | 池子策略表 `isScannable`；美股时段放宽到 04:00–20:00 ET；**会话序列**（`isCandleInSession`，送检测器的 K 线只含真实时段 bar）；分周期取数窗口；元数据降级可见；热度池同步 | 无（**已完成**：52 文件 / 321 测试全绿，真机单请求验证通过） |
| B | `09-16-scan-module-split` | 选币 → 选品；加密 / 股票子模块；`/api/scan?scope=`；按 scope 的默认参数与池子过滤 | A |

**顺序**：A 先落地（它本身就能修掉休市污染，且删日历的编译影响面在 A 内闭合），B 在 A 之上做 UI 与 API 分治。

证据与实测原始记录：`09-16-coin-scan-equity-source/research/session-pollution-measurements.md`（Yahoo 响应契约与韩股别名逐条核对、休市污染量化、K 线重组配对结论、TradingView/东方财富不可用、结果列表不联动图表）。

## Cross-Child Acceptance Criteria

1. 选品模块内两个子模块都能完成扫描；加密侧全程不依赖任何日历；股票侧 K 线只含真实交易时段（美股 04:00–20:00 ET、韩股本地 09:00–15:30）。
2. 两个子模块的池子互斥，并集 = 全部可扫标的；港/A 股、Pre-IPO、无别名的股票标的**在任何 scope 下都不出现**（既不在结果、也不在跳过提示里）。
3. 休市行为：加密标的永远在池（24/7）；休市的美股/韩股被新鲜度剔除、列入 `skippedInstruments`、不占 `topN`、不产生其余周期的请求。
4. `heat` 只在加密子模块提供；其池子不含任何股票类标的，且不依赖日历。
5. `grep -rn "market-session" src/ tests/` 为空；`tests/market-session.test.ts` 已删除。
6. 缺省调用路径（`/api/scan` 不带 `scope`）的行为与拆分前一致（响应形状、排序、`anchor` 回显）。
7. 两个子任务的 `npx vitest run` 全绿、`npx tsc --noEmit` 干净；真机验证 `/api/scan` 的三种请求（无 scope / `scope=crypto` / `scope=equity`）与一次休市时段的股票扫描。
8. 文档一致：`CONTEXT.md` 术语（`Instrument Scan` 选品 / `Equity Candle Source` / `Freshness Gate`）与 `spec/server/{coin-scan,market-data,market-heat}.md` 均反映新模型，无残留「Session Gating 日历」表述。

## Key Decisions（已定）

- 数据源 = **币安 USDT-M**（不引入外部源）。实测否掉了全部候选：Yahoo 免费 chart API ~40 次请求即被 IP 级封禁 >15 分钟（一次扫描要 60–270 次请求）；Binance Stocks 的真时段 K 线只有公开 WebSocket 实时流、无 REST 历史、无 15m/4h、且只有美股；TradingView 无官方免费 K 线 API；腾讯只有日线；东财本机不通。
- 覆盖范围 = **美股 + 韩股**（`US_EQUITY` / `KR_EQUITY`，约 45 个过 1000 万门槛）；港/A 股与 Pre-IPO 不入池（`scan-pool.ts`）。
- K 线真实性 = **会话序列**：`isCandleInSession` 把「跨度内没有交易时间」的 bar 剔除后再送检测器（真机验证：MUUSDT 5m 200 根 → 120 根，隔夜/晚间全剔）；gated 标的取 2× 原始窗口补偿。
- 休市判定 = **时段表**（美股窗口放宽到 **04:00–20:00 ET**，含盘前盘后；隔夜仍视为休市）+ 现有 NYSE 节假日表；日历必须保留，因为币安 7×24 出 bar，「休市」无法从数据推出（实测周末才塌到峰值量 1–2%，节假日仍有 40–50%）。
- 商品（XAU/XAG/XPT/XPD/COPPER/CL/BZ/NATGAS）**留在加密侧**，继续走币安 K 线、不做时段过滤（实测全天有量）。
- 热度（`heat`）池子 = 加密 + 指数 + 商品（加 `isScannable`，池外类别不计入 `closedCount`）。
- 元数据降级**必须可见**：`metadataUnavailable` + UI 提示（否则休市过滤静默失效，污染回归）。
- 股票侧**只提供** `shrink`（缩量/收敛），不提供 `heat`。
- 标的身份/排名/流动性门槛仍来自币安 ticker → 标签、龙头币、复制、下单符号全部不变。
- 内部标识 `ReviewMode = 'scan'` 与路由 `/api/scan` 不变（只改 UI 文案与术语）。

## Out of Scope

- 图表 K 线链路（`/api/candles`、FreeReplay、交割单复盘、个人交割单复盘）：与选品源解耦。
- 把 Yahoo bar 写入共享 `candles` 缓存或供图表复用。
- 股票侧的热度/温度读数；第三个子模块（商品单独成模块）。
- 收敛检测器参数标定（实测各周期命中率普遍偏高，属独立议题）。
- 引入新的选品数据源切换开关（`MARKET_DATA_SOURCE=okx` 保持原样）。

## Open Questions

（无。规划阶段的问题 Q1–Q5 均已收敛，落点见 Key Decisions。）
