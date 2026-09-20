# 缓存写入未收盘K线导致K线不连续

## Goal

K 线缓存里混进了"抓取当时还在走、尚未收盘"的半成品 bar。读取侧的 `isCacheFresh` 把历史锚点判定为永久新鲜，于是这根半成品再也不会被覆盖，图表上表现为 high/low/close 全错、并与相邻 K 线断裂。

修复目标：让「Candlestick Cache 只保存已收盘的 bar」成为硬不变量，并清掉已产生的脏数据。

## Background / Evidence

BTCUSDT，2026-09-17（本地 UTC+8），用细周期聚合出的真值对比缓存值：

| 周期 | 时间(本地) | 缓存值 | 真值 |
| --- | --- | --- | --- |
| 15m | 09-17 20:00 | close 76478 / high 76538.8 | close 76789.9 / high 76790 |
| 1H | 09-17 20:00 | close 76402.2 / high 76538.8 | close 76698.6 / high 77149.8 |
| 1H | 09-17 09:00 | close 76522.6 | close 76334.8 |
| 4H | 09-17 08:00 | low 76147.2 / close 76522.6 | low 76015 / close 76401.8 |
| 1D | 09-17 08:00 | 同一份快照 | low 75975 / close 76385.9 |

全库交叉校验（粗周期 vs 细周期聚合）只有 BTCUSDT 命中，共 5 根，全部落在 2026-09-17。

触发链：`earlier` + 锚点=当前时刻 → Binance `klines` 把正在走的那根一并返回 → 原样 `store.save` → 锚点成为历史后 `isCacheFresh` 直接返回"新鲜" → 永不刷新。

## Requirements

- R1 两个 K 线源（`BinanceCandleSource`、`CandlestickService`）都不得把**未收盘**的 bar 写入 `CandlestickStore`。方向不区分（`earlier` / `later` 都要挡），因为两者都可能命中正在走的 bar。
- R2 读取路径也不得返回未收盘的 bar：缓存与返回值口径统一，"缓存命中"与"回源拉取"两条路返回的窗口都只含已收盘 bar。
- R3 判定"已收盘"必须使用交易所自己给出的收盘/完结标记——Binance 用 kline 行的 `closeTime`（row[6]），OKX 用 candlestick 行的 `confirm`（row[8]）。**不得**用 `timestamp + timeframeMs(timeframe)` 推算：`1M` 的名义步长是 30 天，31 天的月份会把仍在走的 bar 判成已收盘，28 天的月份又会把已收盘的 bar 多压 2 天。
- R4 OKX 的 `confirm` 字段缺失或取值非 `'0'`/`'1'` 时，按"已收盘"处理（即保持修复前的行为）。宁可漏挡也不能误删：误挡会让该源彻底没有 K 线，漏挡只是保留原有的小概率缺陷。
- R5 缓存命中判定必须同步适配：未收盘 bar 不再入库后，"锚点所在 bar"在一次 live 读取中是**合法缺失**的，不能因此每次请求都回源。
- R6 清理已产生的 5 根脏数据（`BTCUSDT` 2026-09-17 的 15m / 1H×2 / 4H / 1D）。清理后读取窗口在空洞处被 `contiguousCandles` 截断、长度不足 `limit`，从而自动触发重新拉取，无需额外迁移逻辑。
- R7 不改变既有语义：
  - `earlier` 仍包含"锚点所在的那根 bar"——前提是它已收盘（历史锚点必然满足）。只有锚点落在**正在走的那根**上时才会少一根，这是本次刻意接受的行为变化。
  - `contiguousCandles` 的连续性/截断规则、`isCacheFresh` 的两步容差、以及按 `(instrument, timeframe, timestamp)` 隔离的缓存命名空间规则都不动。
  - coin-scan / market-heat 已有的 `timestamp + step <= anchor` 过滤保留（成为冗余防线，不是必需）。

## Acceptance Criteria

- [ ] AC1 未收盘 bar 不入库：`BinanceCandleSource` 收到 `closeTime >= now` 的行时，`CandlestickStore` 中查不到该 `(instrument, timeframe, timestamp)`。
- [ ] AC2 OKX 同款：`confirm === '0'` 的行不入库；`confirm === '1'` 或不带该字段的行照常入库。
- [ ] AC3 `1M` / `1W` 不被名义步长误判：构造一根 `timestamp + 30 天` 已过、但 `closeTime` 仍在未来的 1M 行，断言其未入库。
- [ ] AC4 已收盘 bar 仍正常入库并复用（回归：现有 `binance-candles.test.ts` / `candlestick-cache.test.ts` 全绿）。
- [ ] AC5 live 锚点下缓存仍然有效：连续两次 `anchor = now` 的 `earlier` 读取只回源一次（`coversAnchorBar` 不因缺少未收盘 bar 而永远判定为不完整）。
- [ ] AC6 历史锚点 + 锚点所在 bar 已收盘时，`earlier` 依然返回该 bar（不因本次修复而回退 09/10 的决策）。
- [ ] AC7 数据清理后重跑全库交叉校验：粗周期与细周期聚合不一致的 K 线数为 0；BTCUSDT 9-17 那 5 根重新拉取后与真值一致。

## Constraints

- 缓存是本地 SQLite（`data/review.sqlite`），删行属于对用户本地数据的操作，执行前需停止 dev server 并取得确认。
- 不改动 `CandleSource` / `Candlestick` 领域契约的形状（不新增 `closed` 字段）。
- 不引入"启动时全库修复"之类的常驻逻辑：脏数据可检测性有限（最细周期的半成品没有更细的参照），一次性精确删行 + 代码层堵住写入即可。

## Out of Scope

- 收紧 `isCacheFresh` 的两步容差。
- 为已存在的、无法检测的半成品行做通用迁移。
- 图表右端是否要保留"正在走的那根"的实时回显（已定：完全不返回）。

## Notes

- 相关背景见 `.trellis/spec/server/market-data.md` 的 "Binance Candles" 与 "Candlestick Service" 两节；本次修复后需要在该 spec 补一条最终态不变量。
