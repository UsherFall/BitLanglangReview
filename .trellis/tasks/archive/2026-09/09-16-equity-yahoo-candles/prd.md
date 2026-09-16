# 股票类标的：保留交易时段表 + 会话序列

> 目录名仍是 `09-16-equity-yahoo-candles`（创建时按 Yahoo 方案命名）。**实际落地方案已改为「币安数据 + 时段表 + 会话序列」** —— Yahoo 方案在实现第 3 步被实测否掉（见 Background 3）。

## Goal

选币扫描对**美股与韩股**按「真实交易时段」判定与取数：休市标的在 `topN` 切片前剔除（Session Gating，美股窗口放宽到 **04:00–20:00 ET**，含盘前与盘后），且送入收敛检测器的 K 线序列**只保留真实时段的 bar**（会话序列）。数据源保持币安 USDT-M，不引入任何外部依赖。

## Background

1. 币安对 TradFi 合约 7×24 出 K 线；实测「休市时无波动 → 被扫成收敛」在 `[1h]` 成立：股票永续休市锚点 **81%** 出合格收敛（中位分 0.540），开盘锚点只有 35%（中位分 0.000）。
2. **休市不能从数据里推**：股票永续实际是 ~24/5 活着 —— 周末量能才塌到峰值 1–2%，节假日（Labor Day）仍有正常日 40–50%，隔夜 10–35%，最静的是盘后 16–19 ET（3–9%）。现货 bStocks 更糟（PLTR 休市 5m 振幅 **0.000%**、7×24 零跳空、成交额 0.09–5.6M 低于 1000 万门槛）。
3. **外部源全部试过并否掉**：Yahoo 免费 chart API（唯一同时覆盖美股+韩股+盘前盘后）**约 40 次请求即被 IP 级封禁、>15 分钟未恢复**，而一次扫描要 60–270 次请求；Binance Stocks（真 24/5、含夜盘）的 K 线**只有公开 WebSocket 实时流、无 REST 历史、无 15m/4h，且只有美股**；TradingView 无官方免费 K 线 API；腾讯只有日线；东财本机不通。→ 零日历 + 全覆盖 + 历史 K 线，在免费渠道里不存在。
4. 结论：**留在币安就必须保留时段表**，而「K 线要真实」由**会话序列**满足（不把休市 bar 送进检测器）。

## Requirements

### R1. 扫描池范围

- `src/domain/scan-pool.ts` 的 `isScannable(marketClass)`：`CRYPTO` / `COMMODITY` / `US_EQUITY` / `KR_EQUITY` 入池；`HK_EQUITY` / `CN_EQUITY` / `PRE_IPO` 不入池；`undefined`（无分类，含元数据降级）入池。
- 不入池的类别**静默**排除，不进 `skippedInstruments`（池子定义，不是本次跳过）。

### R2. 时段表

- 美股窗口由 09:30–16:00 放宽为 **04:00–20:00 ET**（盘前+常规+盘后；20:00–04:00 ET 的隔夜 session 仍视为休市），NYSE 节假日/提前收盘表不变（测试断言覆盖年份）；HK/KR/CN 时段不变。
- `MarketClass` 类型从 `market-session.ts` 迁到 `src/domain/market-class.ts`（时段与会话判定留在 `market-session.ts`）。

### R3. 会话序列

- 新增 `isCandleInSession(marketClass, openMs, barMs)`：bar 的跨度与任何 session 窗口有交集才保留；未 gated 类别恒真。
- 用**跨度判定**而不是「开盘时间在窗口内」：币安 1D bar 开于 20:00 ET，开盘时间判定会把**每一根**日线都剔掉。
- 扫描对 session-gated 标的请求 `2 × SCAN_WINDOW`（200）根原始 K 线，保证过滤后仍有 100 根可交易 bar；未 gated 保持 100。

### R4. 元数据降级可见

- `TickerSource.metadataAvailable?()`；`BinanceTickerSource` 在元数据不可读时返回 `false`。
- `ScanResponse.metadataUnavailable`（仅在降级时出现）+ 选币面板提示「休市过滤未生效」。

### R5. 热度池同步

- `MarketHeatService` 池子加同一层 `isScannable`（不进池也不计入 `closedCount`）。

### R6. 文档

- `CONTEXT.md`：`Market Session` / `Session Gating` 改写，新增 `Session-only Series`、`Scan Pool Policy` 术语；`TradFi Instrument`、`Coin Scan` / `Shrink Method` / `Market Heat Pool` 同步。
- `spec/server/{coin-scan,market-data,market-heat}.md` 同步契约、流水线与实测依据。

## Acceptance Criteria

1. 实时锚点在休市时段（周末/节假日/北京白天）扫描：美股与韩股不出现在结果、出现在 `skippedInstruments`；加密/指数/商品结果与改动前一致。
2. 锚点落在 04:00–20:00 ET 内（含盘前 04:00–09:30、盘后 16:00–20:00）时，美股正常进池并参与排序。
3. 同一份 K 线数据下：加密收敛，而同一份数据里只落在休市窗口的美股不收敛（会话序列生效）。
4. session-gated 标的的取数 `limit` = 200，未 gated = 100。
5. 港/A 股、Pre-IPO 既不出现在结果，也不出现在 `skippedInstruments`。
6. 元数据不可读时：响应带 `metadataUnavailable`，面板显示「休市过滤未生效」提示。
7. 历史 anchor 与实时 anchor 判定一致（会话表 + 会话序列都对历史生效）。
8. `npx vitest run` 全绿；`npx tsc --noEmit` 干净。

## Out of Scope

- 外部数据源（Yahoo / 新浪 / Binance Stocks WebSocket 采集）—— 已实测否掉，见 Background 3。
- 隔夜 session（20:00–04:00 ET）纳入扫描。
- 图表 K 线链路（`/api/candles`、FreeReplay、两种交割单复盘）：与选币源解耦。
- 选币 → 选品更名与双子模块拆分：兄弟子任务 `09-16-scan-module-split`。

## Open Questions

（无。）
