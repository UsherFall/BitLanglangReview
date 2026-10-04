# 回溯复盘改用币安行情源

## Goal

把回溯复盘（含新增的「其他币」面板）的行情源从 OKX 改为**币安 USDT-M 永续**，并把时间轴的 1D/1W/1M 网格从「上海零点」改为「UTC 零点」，与币安的日线边界一致。

起因：实测发现 OKX 的 `QNT-USDT-SWAP` 与币安 `QNTUSDT` 已经是两个独立价格体系 —— 币安 `QNTUSDT` 最新价 263.51、24h 成交额 4.67 亿 USDT；OKX `QNT-USDT-SWAP` 最新价 46.50、24h 成交额仅 4740 USDT（差 5.7 倍价格、约 10 万倍成交额；币安现货 QNT 同为 263，排除 1000x 面值换算）。回溯复盘当前拉的是 OKX 那条几乎静止的僵尸盘口，与用户在币安看盘的实盘认知完全脱节。

**补充查证（修正早期判断）**：

1. **三个现有会话的币在币安都有**，且都是 `TRADING`：`MUBARAKUSDT`、`ENAUSDT`、`QNTUSDT`。所以 R5（历史会话不可恢复）**不成立**，无需降级处理 —— 唯一变化是这三条会话的 K 线会从 OKX 切到币安。
2. **QNT 在币安有两个合约**：`QNTUSDT`（`PERPETUAL`，2022-10-18 上线，263.5，成交额 4.67 亿）与 `QNTXUSDT`（**`TRADIFI_PERPETUAL`**，2026-05-29 上线，**46.56**，与 OKX 的 46.5 同源）。`QNTX` 不是 1000x 面值换算，而是币安的「传统市场合约」通道。OKX 那个 QNT 与 `QNTXUSDT` 一样属于低流动性盘口。
3. 结论修正：**问题不是「OKX 数据错了」，而是「同一个 base 在币安有多个价格体系，用户按哪个复盘取决于他实盘在哪个上交易」**。切币安后 `QNT-USDT-SWAP → QNTUSDT` 映射到 263 那一档。


## Confirmed Decisions

1. **只绑币安，删除 OKX 回退腿** —— 用户明确选定。回溯复盘的 K 线不再走 `resolveCandleChain` 候选链，直接用 `BinanceCandleSource` + 币安原生符号。
2. **时间轴网格统一为 UTC 零点** —— 由「按源区分两套网格」简化而来。理由：只绑一个源后无需维护双网格，且 `binance-candles.ts` 的既有实现已经按 UTC 0 点写（其文档注释明说「NO OKX-style -8h offset is applied」），统一后与该实现自洽。
3. **不新增 1000x 面值换算** —— 沿用 `instrument-symbol.ts` 已确立的规则：不同面值的合约不做价格缩放（缩放会同时影响画线对价格的解释，见该文件注释）。

## Accepted Costs（用户已知并接受）

- **OKX 上 485 个 USDT 永续里有 224 个（46%）在币安无对应永续，从此无法回溯复盘**。主要是美股（AMZN / AMD / ARM / AVGO / AAPL…）与币安独有条（ANTHROPIC / AI / ALAB…）。
- **选品 → 复盘链路对 OKX 独有币会断**：选品模块扫币安，但历史会话若指向 OKX 独有币，恢复会失败。
- **1D / 1W / 1M 的 K 线相对现状位移 8 小时** —— 网格从上海零点改为 UTC 零点，这是预期变化而非缺陷。
- 回溯复盘从此受币安限频约束（实测 used-weight 370 / 2400，余量充足）。
- **同名不同价体系**：像 QNT 这样在币安存在多档价格的 base（`QNTUSDT` 263.5 / `QNTXUSDT` 46.56），切换后复盘的是 `QNTUSDT` 那一档。若用户实盘在 `QNTX` 上交易，仍会看到价差。

## Background

- 回溯复盘的合约列表来自 `/api/free-replay/instruments` → `OkxInstrumentService.listSwapInstruments()`（`free-replay-instruments.ts`、`okx-instrument-service.ts`）。
- 回溯复盘的 K 线走 `/api/candles` 且不传 `source`，服务端因此落到 `getCandlesForMode({ candleSource: candleService /* OKX */ })`（`app-plugin.ts:175`）；传 `source=binance` 才走候选链。
- 交易对命名：回溯复盘全程使用 OKX 风格 `BTC-USDT-SWAP`。候选链的 `resolveCandleChain` 负责映射到币安的 `base+USDT`。只绑币安后，**合约列表与请求参数都要改成币安原生符号**（`BTCUSDT`），否则 `BinanceCandleSource` 拿到 `BTC-USDT-SWAP` 查不到。
- `chart-time.ts:131-148` 的 `floorTimestamp` 把 `1D`/`1M` 对齐到上海零点（`Date.UTC(...) - 8h`），`1W` 对齐到 UTC 周日 0 点（`timestamp - timestamp % 7d`）。实测：OKX 1D 网格是 16:00Z（上海零点），币安 1D 网格是 00:00Z；我们的 `floorTimestamp` 对币安 1D 差 **-8 小时**。
- `candlestick-service.ts:99-107` 的 `boundaryAnchor` 同样有 `timeframe === '1D' ? -8h : 0` 的 OKX 专用偏移。
- 已查证**非本次问题**：QNT 的 1D/4H 缓存与 OKX 逐字段（OHLCV）比对**零不符**；1H 缓存存在 31 根缺口（`2026-09-30T09:00Z` 之后跳到 `2026-10-01T18:00Z`），但 `BinanceCandleSource` 的缓存完整性门（`coversAnchorBar`）已在币安侧覆盖同类问题。

## Requirements

### R1. 行情源切换

- 回溯复盘的主图与其他币面板，K 线一律取自 `BinanceCandleSource`。
- `/api/candles` 需明确区分「回溯复盘要币安」与「交割单复盘保持现状（OKX）」两类调用方。
- 币安请求失败（429 / 418）时**不得**静默回退 OKX —— 沿用 `review-candle-source.ts:43-48` 已确立的规则：限频必须让用户看见，不能用另一个场所的行情冒充。

### R2. 合约列表与命名

- `/api/free-replay/instruments` 改用币安 `exchangeInfo`，返回 `quoteAsset=USDT` + `status=TRADING` 的**全部**合约类型（`PERPETUAL` / `TRADIFI_PERPETUAL` / 1000x 面值），**不限 `contractType`**。
- 列表项命名必须与 K 线请求参数一致（币安原生符号，如 `QNTUSDT`、`QNTXUSDT`），避免「列表选得到、请求查不到」。
- 币安 `exchangeInfo` 读取失败时，接口应返回可辨识的错误（与 `MarketHeatPool` 的 `metadataUnavailable` 同类思路），而不是返回空列表让用户以为没有币可复盘。
- 列表沿用 OKX 风格展示（`BTC-USDT-SWAP`）还是币安原生（`BTCUSDT`）需与 R2 的请求参数保持一致；由于回溯复盘全程走币安原生符号，建议列表也直接显示币安原生符号，避免二次映射。

### R3. 时间轴网格

**基准**：本项目的日线体系以**北京 08:00（= UTC 0 点）**为分界 —— 用户实盘习惯如此，币安亦如此（实测日/周/月三个周期都落在北京 08:00）。OKX 的北京 00:00 边界比该基准早 8 小时，属 OKX 侧偏差，不是对齐目标。

- `1D` / `1W` / `1M` 的 K 线边界改为 UTC 零点，与币安一致。
- `floorTimestamp`（`chart-time.ts`）与 `boundaryAnchor`（`candlestick-service.ts`）的偏移需同步调整，且两处必须一致 —— 它们分别服务前端定位与服务端请求窗口，不一致会出现「标记落不到 K 线上」或「窗口切错根」。
- `1W` 需改为按**真实日历周**的周一 00:00 UTC 计算（现状按名义 7 天 + UTC 周日 0 点，实测偏 80 小时）。
- `1m`–`4H` 短周期不受影响（UTC 对齐在两个源上一致）。

### R4. 揭示语义不回退

- 未来 K 线在揭示前保持隐藏；「上一根 / 下一根 K 线」、左滚补历史、游标跟随等既有行为不变。
- 预取与重试逻辑不变（含预取失败可重试）。

### R5. 历史会话

- 现有 3 个会话（MUBARAK / ENA / QNT）的币在币安均为 `TRADING`（已查证），**无需降级或隐藏处理**。
- 这三条会话恢复后 K 线源从 OKX 切到币安：`MUBARAKUSDT`（0.0664）、`ENAUSDT`（0.2382）、`QNTUSDT`（263.5）。会话的 `instrument` 字段仍存 OKX 风格名，恢复时需按同一映射规则换成币安符号。
- OKX 旧缓存在切换后成为死数据（币安符号与 `-USDT-SWAP` 符号在缓存主键上不冲突，可留存不清理）。

### R6. 币安合约列表的纳入口径

- 用户决定：**全部显示**，包括 `1000x` 面值合约（`1000SHIBUSDT`）与 `TRADIFI_PERPETUAL`（如 `QNTXUSDT`）。
- 因此列表筛选条件为 `quoteAsset=USDT` + `status=TRADING`，**不限 `contractType`**（否则会漏掉 `TRADIFI_PERPETUAL` 与 `1000x`）。
- 不做价格缩放、不加别名映射（沿用 `instrument-symbol.ts` 既有规则），因此这类合约的 K 线价格与现货差 1000 倍 / 与同名 OKX 合约不同源，属已知且被接受的行为。

## Acceptance Criteria

- [ ] 回溯复盘中选择 QNT，K 线价格与币安 `QNTUSDT` 一致（当前 263 附近），不再是 OKX 的 46.5。
- [ ] 回溯复盘合约列表来自币安 `exchangeInfo`，选中的合约能真正拉到 K 线（不存在「列表有、请求 404」）。
- [ ] 1D 图上每一根 K 线的日期与币安一致（UTC 0 点边界）。
- [ ] 1W 图的 K 线边界为周一 00:00 UTC，与币安一致。
- [ ] 1m / 5m / 15m / 1H / 4H 图与改动前一致（短周期网格不变）。
- [ ] 未来 K 线仍在揭示前隐藏；连续点「下一根 K 线」可越过初始窗口继续加载。
- [ ] 币安限频（429 / 418）时界面显示限频信息，不静默切到 OKX 行情。
- [ ] OKX 独有的币在列表中不再出现，且不会导致选品 → 复盘链路报错崩溃。
- [ ] 3 个现有会话（MUBARAK / ENA / QNT）恢复后能正常加载，K 线为币安数据（QNT 显示 263.5 一档，非 OKX 的 46.5）。
- [ ] 交割单复盘 / 个人交割单复盘两个模式的行情源与行为**不受影响**。
- [ ] `npx tsc --noEmit` 无新增错误；`npx vitest run` 全绿；受影响的既有测试按新网格更新断言。

## Out of Scope

- 不为 1000x 面值合约实现价格缩放。
- 不恢复 OKX 回退腿。
- 不改选品模块的数据源（本来就是币安）。
- 不修 QNT 1H 缓存的历史缺口（旧数据，新写入不受影响）。
