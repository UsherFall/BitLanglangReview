# 实测：休市 K 线 vs 收敛检测器（2026-09-16）

所有数字都是**本机真机实测**，不是估算。检测器用的是仓库自己的代码（`src/domain/coin-scan.ts` 的 `detectConvergence` + `defaultStructureParams`，窗口 = `SCAN_WINDOW` 100 根，anchor 逐根滚动）。

## 1. 币安现货确实有「股票现货」K 线：bStocks

`https://api.binance.com/api/v3/exchangeInfo`（3699 个现货 symbol，免 API key）里有 ~80 个 bStocks 代币化美股对（`baseAsset` 以 `B` 结尾）：

```
AAPLBUSDT AMZNBUSDT AVGOBUSDT COINBUSDT CRCLBUSDT DELLBUSDT GOOGLBUSDT HOODBUSDT
INTCBUSDT METABUSDT MSFTBUSDT MSTRBUSDT MUBUSDT NVDABUSDT ORCLBUSDT PLTRBUSDT
PYPLBUSDT SKHYBUSDT SNDKBUSDT TSLABUSDT ... QQQBUSDT SPYBUSDT SOXLBUSDT TQQQBUSDT
```

技术可用性：走标准 `/api/v3/klines`，**不需要 API key**，7×24 有 K 线。

但两处致命问题：

**(a) 休市时比永续更平**（5m 中位振幅，1000 根，09-12 09:50 → 09-15 21:05 ET）：

| 标的 | 开盘 09–16 ET | 休市（其余） | 周六 |
|---|---|---|---|
| MU 永续 | 0.357% | 0.13–0.19% | 0.032% |
| bStocks `MUBUSDT` | 0.138% | 0.109% | 0.024% |
| `NVDABUSDT` | 0.070% | 0.052% | 0.018% |
| `TSLABUSDT` | 0.077% | 0.046% | 0.019% |
| `PLTRBUSDT` | 0.024% | **0.000%** | **0.000%** |

休市时段振幅中位 0.000% = 完全不动。换到 bStocks 等于把休市污染放大。

**(b) 流动性过不了扫描门槛**（24h 成交额，默认 `minQuoteVolume24h` = 1000 万 U）：

```
MUBUSDT 4.14M | NVDABUSDT 5.60M | TSLABUSDT 2.48M | SKHYBUSDT 2.41M
AAPLBUSDT 0.67M | PLTRBUSDT 0.09M     ← 全部低于 1000 万，会被直接过滤掉
对照永续：MUUSDT 310M | MSTRUSDT 225M | NVDAUSDT 111M | TSLAUSDT 100M
```

**币安股票专用行情 API 也没有历史 K 线**：`/sapi/v1/equity/market/*` 只有 `exchangeInfo`（含 `tradability`/`extendedSession`/`overnightSupported`，但**没有交易时段字段，也没有日历**）、`tokenized-assets`、`quote`（最新买卖价）三个端点，全部需要 `X-MBX-APIKEY`，**没有 klines**。

## 2. 休市 K 线到底会不会造出假收敛？分周期结论不同

100 根窗口，逐 anchor 跑 `detectConvergence`，按「该 anchor 时刻美股是否开盘」分组。股票组 = MU/NVDA/TSLA/PLTR/MSTR/CRCL 永续；加密组 = BTC/ETH/SOL/DOGE/XRP/LINK。

```
[1h] EQUITY  开盘: n=1092  0分占比=65%  中位=0.000  均值=0.164
             休市: n=4314  0分占比=19%  中位=0.540  均值=0.472
[1h] CRYPTO  开盘: n=1092  0分占比=40%  中位=0.345  均值=0.257
             休市: n=4314  0分占比=15%  中位=0.480  均值=0.437
[5m] EQUITY  开盘: 0分占比=23% 中位=0.460 | 休市: 0分占比=28% 中位=0.421
[5m] CRYPTO  开盘: 0分占比=32% 中位=0.386 | 休市: 0分占比=22% 中位=0.458
```

**结论 A（1H 确认用户判断）**：美股合约在休市锚点 81% 出合格收敛（中位分 0.540），开盘锚点只有 35%（中位分 0.000）。休市时段确实大量产出收敛。
**结论 B（不是股票独有）**：加密在休市时段同样更高（85% vs 60%，中位 0.480 vs 0.345）。美国夜间/周末整体安静，缩量检测器在安静行情里最容易满足 —— 这是**时段效应**，不是股票合约独有。
**结论 C（5m 无此效应）**：5m 窗口只有 8.3 小时、滑窗有 ~90 个候选带，开盘/休市几乎一样（0.460 vs 0.421），噪声主导。

## 3. 「把休市 K 线从窗口里剔掉」（会话序列）：5m 零差别，1H 改变窗口语义

同一批开盘锚点做配对比较（A = 原始 7×24 序列；B = 只保留交易时段 K 线的序列）：

```
[5m] 配对窗口 n=342   A: 0分占比=23% 中位=0.492 | B: 0分占比=22% 中位=0.492
                     两者都无=76  仅A有=0  仅B有=1        → 5m 完全无差别
[1h] 配对窗口 n=450   A: 0分占比=70% 中位=0.000 | B: 0分占比=28% 中位=0.389
                     两者都无=105 仅A有=23 仅B有=209      → B 触发多得多
```

**解读（勿误读为「更糟」）**：剔掉休市 K 线后 1H 命中率从 30% 升到 72%，不是变假，而是**换了窗口语义** —— 原始序列里休市死 K 线把「近段」和「前段」同时压平 → 比值≈1 → 被拒，同时也把真实信号的对比度稀释了。详见 §5 的 04:00–20:00 口径实测与分解（仅A有 / 仅B有）。

## 4. 币安官方时段模型（权威依据）

`Perpetual Futures on Traditional Assets`（binance.com/support/faq/detail/fe7dcdf24f1943d98b368f5f9f744398）：

> "Equities operate on a **24/5 cycle across distinct sessions, including pre-market, regular, after-hours, and overnight**, while XAU typically trades on a 24/5 basis with a daily one-hour maintenance break. Both markets are also subject to scheduled and unscheduled holidays that interrupt price formation."

价格指数按 session 切换模式（**这就是「K 线是否真实」的官方定义**）：

| session | 指数模式 | 是否来自真实标的行情 |
|---|---|---|
| 常规时段 regular | Standard：每秒对全体成分加权 | 是（第三方数据商） |
| 盘前 / 盘后 pre-market & after-hours | Fast-Decay EWMA（因流动性低、波动大而平滑） | 是（平滑后） |
| 隔夜 overnight | Slow-Decay EWMA（更强平滑，保连续） | 是（强平滑后） |
| 每日维护 / 节假日 / 周末 | Fixed → **2026-05-16 00:00 UTC 起换成 Orderbook EWMA**（用盘口冲击中间价，不用供应商价） | **否** |

配套事实：
- 大宗商品 TradFi 永续自 2026-09-15 21:00 UTC 起改 24/5，取消每日一小时维护；常规定义为「周日 18:00 ET → 周五 17:00 ET」，周末用 Orderbook EWMA。
- `fapi/v1/exchangeInfo` **没有任何时段/日历字段**（symbol 全部字段实测只有 `timeInForce` 带 "time"），`status` 恒为 `TRADING`；股票类 `underlyingSubType = ["TradFi"]`，Pre-IPO 为 `["Pre-IPO","TradFi"]`（`OPENAIUSDT` / `ANTHROPICUSDT`，**当前未被 gating**）。
- 商品类 8 个：`XAUUSDT XAGUSDT XPTUSDT XPDUSDT COPPERUSDT CLUSDT BZUSDT NATGASUSDT`；指数类 3 个：`DEFIUSDT BTCDOMUSDT ALLUSDT`。

→ 可扫/不可扫的分界线应该按**指数模式**划：有真实标的行情的时段（盘前/常规/盘后/隔夜）vs 完全没有的时段（周末/节假日/每日维护）。

## 5. 时段口径是决定性旋钮，K 线重组影响小

配对比较（同一批「窗口内开盘」锚点，A = 原始 7×24 序列，B = 只保留窗口内 K 线的会话序列）：

```
[5m] 窗口 09:30-16:00  n=342   A: 0分=23% 中位=0.492 | B: 0分=22% 中位=0.492  仅A=0    仅B=1
[5m] 窗口 04:00-20:00  n=1710  A: 0分=21% 中位=0.460 | B: 0分=21% 中位=0.467  仅A=17   仅B=22
[1h] 窗口 09:30-16:00  n=486   A: 0分=67% 中位=0.000 | B: 0分=28% 中位=0.417  仅A=26   仅B=217
[1h] 窗口 04:00-20:00  n=2274  A: 0分=40% 中位=0.382 | B: 0分=25% 中位=0.458  仅A=96   仅B=437
```

- **5m 完全不受影响**（窗口只有 8.3 小时，极少跨周末）。
- **把窗口从 09:30–16:00 放宽到 04:00–20:00**，原始序列 1H 命中率 33% → 60%（覆盖到盘前这段最有活力的时间：MU 永续 04:00 ET 中位振幅 0.222%，是盘后 17:00–19:00 的 0.055–0.077% 的 3–4 倍）。
- **会话序列不是「更糟」而是「换语义」**：1H 上它消掉 96 个疑似「窗口里的周末死 K 线」造成的假信号，同时找回 437 个「被死 K 线稀释掉」的真信号；净命中率升高。不能把「命中更多」等同于「更假」。
- **1D / 4H 的陷阱**：币安 1D bar 开于 UTC 00:00 = **20:00 ET**，`04:00–20:00 ET` 的会话过滤会把**每一根 1D bar 都剔掉**（4H 同理，开于 20:00/00:00 ET 的 bar 也在窗口外）。会话序列若要覆盖 4H/1D，必须另行定义「会话日」规则，不能照搬 5m/1H 的逐 bar 过滤。

## 6. 净结论

1. 换数据源（现货/bStocks）**解决不了**，两个维度都更差：休市振幅 0.000%、成交量过不了门槛。
2. 剔休市 K 线**不是解药也不是毒药**：5m 零差别；1H 上改变的是窗口语义（消 96 / 找 437），不是单纯减少假信号。
3. **时段口径（什么时刻算「开盘」）才是用户能直接感知、影响最大的旋钮**：现有 09:30–16:00 ET 太窄，漏掉盘前这条最有活力的时间；按币安官方模型应放宽到含盘前/盘后（04:00–20:00 ET），并继续剔除周末/节假日（这些时段的指数根本不用标的行情）。
4. 真正有效的机制仍然是**已经实现的 Session Gating**（`c10394c`）：休市锚点整只标的直接不进扫描池。
5. 唯一未验证的失效路径：`binance-instrument-metadata.ts` 拉 `exchangeInfo` 失败时**静默降级为空 map（=不过滤）**，此时休市美股会全量涌进结果且无任何提示。另 `PREMARKET`（Pre-IPO 2 个）**当前不在 gating 范围**，而它也是 24/7 薄盘。

## 7. 外部美股 K 线源取证（Q3 后转向：不扫交易所 TradFi，改外部源）

### 7.1 TradingView：**没有官方免费 K 线 API**

实测本机：
```
scanner.tradingview.com/america/scan           → 200（筛选器，非 K 线）
symbol-search.tradingview.com/symbol_search/   → 403（需鉴权/风控拦截）
```
TradingView 官方只提供 Charting Library / Data Feed（**由你自己供数据**），其自有行情需付费且不可经 API 转售。非官方方案（tvdatafeed 等）走它们未公开的 websocket，属于未授权使用、随时失效，且无法支撑本地长期缓存。→ **不建议作为扫描数据源。**

### 7.2 东方财富：本机不可达

```
push2his.eastmoney.com/api/qt/stock/kline/get  → http=000（连接被重置），带 Referer/UA 重试同样失败
```

### 7.3 Yahoo Finance：**可用，且形态正是要的**

`https://query1.finance.yahoo.com/v8/finance/chart/<ticker>?interval=5m&range=5d&includePrePost=<bool>`
**免 API key、免鉴权**，本机 200。

| 观测 | 值 |
|---|---|
| `AAPL` `includePrePost=false` | 391 bars，09-09 09:30 → 09-15 16:00 ET，**只有 4 个跳空**（全是隔夜/周末），**休市时段一根 bar 都没有** |
| `AAPL` `includePrePost=true` | **961 bars，04:00 → 19:59 ET 连续**，每小时 60 根，无隔夜、无周末 |
| `005930.KS`（三星，韩股） | 200，bars 在 `Asia/Seoul` 09:00–15:30 本地时段 |
| `meta` 字段 | `exchangeTimezoneName` / `regularMarketTime` / `hasPrePostMarketData` / `currentTradingPeriod{pre,regular,post 的 epoch 起止}` / `tradingPeriods` / `validRanges` / `instrumentType=EQUITY` |

→ 一个 `includePrePost` 开关就同时拿到「盘前+常规+盘后」和「真实 K 线」：**不需要任何日历维护**。
→ 休市无新 bar，所以「是否休市」可用**新鲜度**判定（最后一根 5m bar 距 anchor 超过 N 分钟 → 跳过），周末/节假日/停牌自动覆盖，且 `meta.regularMarketTime` 可直接用。
→ 已知限制：**无 4H 周期**（需由 1h 聚合）；分钟级历史有窗口限制（5m 约 60 天，扫描只需 100 根，够用）；非官方 SLA，存在日后加鉴权的风险。

### 7.4 集成面很小：选币结果列表不渲染图表

`CoinScanPanel.tsx` 的行操作只有 **详情 / 记龙头 / 复制**（无图表组件、无 candle 请求）；`OtherCoinChart` / `LeaderCoinPanel` 只在 App.tsx 的**交割单复盘分支**（`selectedTrade`）使用，与选币分支无关。
→ 新增的美股 CandleSource **只需服务 `CoinScanService`**，不必接 `/api/candles` 与图表链路。

## 8. 【执行期阻断】Yahoo 限频实测 —— 原方案不可行

实现到第 3 步（Yahoo 数据源）时实测发现，**Yahoo chart API 的免费额度撑不住一次选币扫描**。

### 8.1 证据

```
连续 10 次 GET /v8/finance/chart/MU?interval=5m&range=1d  → 10/10 全部 429
同步镜像 query2.finance.yahoo.com                        → 429
假符号 ZZZZNOPE（区分「限频」与「符号错误」）              → 429（证明是 IP 级封锁，与符号无关）
等待 120s 后重试                                          → 429
等待累计约 15 分钟后重试                                   → 429
响应体：`Edge: Too Many Requests`
```

累计调用量仅约 **40 次请求 / 40 分钟**（全部是规划期的取证请求），就被 IP 级封锁，且封锁持续 **>15 分钟**未恢复。
而一次选币扫描按原设计需要：股票候选探针（≤45 次）+ topN×5 个周期（最多 150 次）≈ **60–270 次请求/次点击**。

结论：**Yahoo 不能作为选币的数据源**。用 `includePrePost=true` 拿盘前盘后 + 真实时段 K 线的设想在额度层面不成立；且因为被封，实现期也无法联调验证。

### 8.2 备用源横向实测

| 源 | 美股分钟 | 美股日线 | 盘前盘后 | 韩股 | 备注 |
|---|---|---|---|---|---|
| Yahoo `query1/query2` | ✅ 形态完美（含盘前盘后、真实时段无死 bar） | ✅ | ✅ | ✅ `005930.KS` | **额度极严：~40 次即封 >15min** |
| 新浪财经 `US_MinKService` | ✅ 5m/15m/…（`type=5`） | ✅ 1984 年至今 | ❌ **只有常规时段** | ❌ `var x(null)` | 实测 1023 根/14 个交易日、**78 根/日 = 正好 09:30–16:00**、跳空仅隔夜与假日（Labor Day 09-07 正确跳过）；默认约 60 天保留 |
| 腾讯 `usfqkline` | ❌ `UsMinuteKlineController` 不存在 | ✅ `usAAPL,day` | 未知 | ❌ `type error` | 美股只有日线 |
| 东方财富 `push2his` | ❌ 本机连接被重置（`http=000`，带 Referer/UA 亦然） | ❌ | — | — | 不可达 |
| TradingView | ❌ 无官方免费 K 线 API（`symbol-search` 403） | ❌ | — | — | 不可用 |

**没有任何一个免费源同时满足「美股+韩股」+「盘前盘后」**：能满足的是 Yahoo（被封）；能跑的是新浪（牺牲盘前盘后与韩股）。

### 8.3 对方案的影响

原 `design.md` 的两个关键决策同时失效：
1. 「数据源 = Yahoo chart API」→ 额度不可行。
2. 「休市判定 = 新鲜度（零日历）」→ **新鲜度依赖「源在休市时不出 bar」**，而币安 7×24 出 bar，所以只要留在币安数据上，新鲜度规则必然恒真、退化为「永不剔除」；**留在币安就必须保留日历**。

可重新组合的选项（含各自的实测代价）见任务 `prd.md` 的 Open Questions 与父任务 Key Decisions 的待更新项。

## 9. 复现方式

实验脚本（临时、未入库、`gitignored`）：`.scratch/session-pollution.probe.ts`、`.scratch/session-paired.probe.ts`、`.scratch/session-window.probe.ts`。它们跑真实网络并用仓库自己的 `detectConvergence`，因此**刻意不叫 `*.test.ts`**，避免被主测试套件收集（主套件基线：51 文件 / 308 测试）。执行：

```bash
npx vitest run --config .scratch/vitest.probes.config.ts
```

原始 K 线快照（Binance/Yahoo 响应）在同目录 `.scratch/*.json`。
