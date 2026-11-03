# 回溯复盘行情源可选 + K 线缓存洞回填与读侧自愈

## 背景（2026-11-02 调查结论）

用户报告两个问题，均已查实根因：

1. **偶发一段 K 线空缺**：`review.sqlite` 蜡烛缓存里存在真实空洞，且落在用户两个 BTC 会话的复盘区间内：
   - Binance 命名空间 5m：2023-03-20→03-21（缺453）、03-23→03-26（缺775）、03-28→03-30（缺622）——在 2023.3 会话（3/18–4/11）区间内；
   - Binance 15m：2023-06-20→07-03（缺1239）、07-06→07-10；1H：06-25→07-01——在 2023.5 会话（5/17–7/19）区间内；
   - Bitget 命名空间 1H：03-25→03-29、04-05→04-08——也在 2023.3 会话区间内。
   成因：历史翻页取数留下的空窗（10/21–10/30 期间旧会话翻页硬编码 Bitget 等）。**客户端已加载数组中段的洞永远不会被现有 earlier/later 加载器填补**（earlier 只在视口左缘触发、later 只在右缘/光标前 20 根触发），揭示光标也会直接跳过洞（少揭示蜡烛）。另外服务端 `contiguousCandles` 在洞处截断返回窗口，但请求锚点永远来自已加载边缘，洞夹在中间时无请求会锚定到洞里。
2. **「4-9 1:00 蜡烛显示不对」**：缓存与币安逐根一致，非数据错。该会话是 10/21 前建的（`candle_source` 空 → 锁 Binance 价），与用户对照的参考图（OKX/Bitget）同一根蜡烛 OHLC 本来就不同（实测三所 4-9 1:00 的 15m 蜡烛各不相同）。用户要求把行情源做成**像选品一样可选**。

附带发现的真实 bug：**回溯复盘自动保存的 PUT payload 漏掉 `candleSource`**（App 自动保存 effect 构造的对象不含该字段，服务端按 `?? null` 落盘）——10/21 后新建的 Bitget 会话第一次落盘就丢源，恢复时被当成旧会话静默切回 Binance（`restoreFreeReplaySession` 的 `?? LEGACY` 兜底）。这也解释了库里所有会话 `candle_source` 均为 null。

## 需求

### R1 回溯复盘行情源可选（同选品模式：币安/OKX/Bitget）

- 开始面板（FreeReplayPanel）加「行情源」三选一（复用 `MarketDataSource` 的 `币安/OKX/Bitget` 文案），默认 Bitget（现 `FREE_REPLAY_CANDLE_SOURCE`）。
- 交易对列表按所选源拉取（`/api/free-replay/instruments?source=`，服务端三源已支持；切换源重拉列表、重置选中项）。
- 新会话把所选源写进 `candleSource`（现有字段），落盘不丢（见 R3）。
- **进行中的会话也能切换行情源**：工作区头部（detail-header）加一个源切换控件；切换 = 显式重取窗口（`dataAnchorTime` 从当前 progressTime 重算、`cursorTime` 按新源网格重算、清空已加载蜡烛、图表按新源重取），进度/单子保留。图表初始加载 effect 与 rangeKey 必须把 `candleSource` 纳入依赖，切换即重载。
- 源 → 取数契约映射：币安 → `binance-only`（严格 Binance 无兜底，现契约）；Bitget → `bitget`；OKX → `okx`（现有路由默认分支）。四条取数路径（initial/earlier/later/focus 窗）全部用会话源（现状已满足，勿回退）。
- 源 → 日界网格：`binance-only` → `utc`；`okx`/`bitget` → `shanghai`（扩展 `replayCandleGrid` 按源映射，旧空值仍当 binance）。
- **交易对词汇表跨源翻译**：Binance/Bitget 用 `XXXUSDT`，OKX 用 `XXX-USDT-SWAP`。会话的 `instrument` 保持创建时的写法存盘（会话键 `(instrument, startTime)` 不变），向蜡烛路由发请求时按当前源翻译（新增领域助手 `usdtSymbolToOkxInstrument`；已有 `okxInstrumentToBitgetSymbol` 反向）。翻译失败（目标所无此标的）时图表显示空窗口（错误可见），不静默换所。
- 「不悄悄换源」契约保持：只有用户显式操作才改会话源。

### R2 K 线缓存洞：一次性回填 + 客户端中段洞自愈

- **一次性回填脚本** `tools/backfill-candles.ts`：扫描 store 全部 `(instrument, timeframe)` 相邻蜡烛间 gap > 1.5×step 的洞，从对应交易所补齐并 upsert。命名空间 → 源：`bitget:` 前缀 → Bitget；`-USDT-SWAP` 后缀 → OKX；裸 `XXXUSDT` → Binance（补不到再试 Bitget 历史，仍失败记日志跳过）。分块请求（Binance 1500/次，OKX/Bitget 100/90 次分页），只写洞区间。跑在用户库 `data/review.sqlite`（WAL，可与 dev server 并存）。
- **客户端中段洞自愈（FreeReplayChart）**：已加载数组在「可见范围 ∪ 光标前方 20 根」内出现 gap 时，对洞中心发一次 `mode=initial` 窗口请求（±150 根，交易所侧本身连续），合并即填洞。去重：一次只补一个洞（loading ref），补不到（交易所无此段）不重试直到范围变化。earlier/later 现有触发条件不动（视口边缘契约不变）。

### R3 自动保存丢 candleSource 修复

- 自动保存 payload 补上 `candleSource: freeReplay.candleSource`；回归测试：带源会话保存/恢复后源不丢。

## 验收标准

- [ ] 开始回溯复盘前可选行情源；列表、网格、落盘源、请求 source 全部一致；OKX 源下选 `BTC-USDT-SWAP`、Binance/Bitget 源下选 `BTCUSDT` 均能正常出图。
- [ ] 进行中会话在头部切换行情源后：图表按新源重取（请求 `source=` 可见），进度/单子/焦点行为不乱，自动保存落盘新源；恢复该会话源正确。
- [ ] 回填脚本执行后：两个 BTC 会话区间内（含 5m 的三月三个洞、15m/1H 的六月洞、bitget 1H 的三月底洞）扫描为 0 洞；脚本对交易所无数据的洞安全跳过。
- [ ] 人为在已加载数组中间造洞（或用回填前的库），滚动/揭示到该范围时洞被自动补上，不再有持续空白；光标跨越洞区时不再跳蜡烛（洞先被补上）。
- [ ] 自动保存不再丢 `candleSource`（回归测试覆盖）。
- [ ] `npm test` 全绿；`npx tsc --noEmit` 通过。交割单复盘（TradeChart）行为不变。

## 范围外

- 交割单复盘/个人交割单复盘的行情源（它们各有契约，不动）。
- 选品模块（它是参照物，不修改）。
- 服务端三源取数内部的重构（`contiguousCandles` 截断行为保持——回填后洞不存在，截断不再触发）。
- 洞的「预防」：新取数路径不再产生洞由现有连续性契约保证（交易所窗口本身连续）。
