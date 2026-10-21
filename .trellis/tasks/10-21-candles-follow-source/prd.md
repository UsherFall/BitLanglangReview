# K 线按各自行情源走：选品 + 回溯复盘用 Bitget 源

> 状态：done（2026-10-21 创建并完成）。
> 提交：`011f147` / `0c35248` / `4ff3350`。
> 前置：`10-21-scan-level-fix-and-top20`（距线修复 —— 比例因子从"日常路径"退化为"兜底"）。

## 用户原话

> **「就是选品时候，我们不是先点 bitget 源再点扫描嘛，这时候用的就得是 bitget 源的 k 线，如果选的是币安就用币安的，然后我们的回溯复盘复的是 bitget 上的单子，也可以用 bitget 的 k 线，交割单复盘就原样」**
>
> **「面值这个应该不用管？因为如果我扫描选的是币安源，他名字就叫 1000pepe 了」**

## 核心判断（先确认，不做跨源对齐）

**每个环节的 K 线跟着它自己的源走，同源必然同名同尺度 —— 所以面值不用管。**

用户的判断是对的，实测支持它：

| 交易所 | PEPE 的符号 | 收盘价 |
| --- | --- | --- |
| 币安 | `1000PEPEUSDT` | 0.0045498 |
| Bitget | `PEPEUSDT` | 0.0000045479 |
| OKX | `PEPE-USDT-SWAP` | 0.000004561 |

- 币安确实叫 `1000PEPE`（面值 1000 倍），**这正说明「同名」不是跨源可比的条件，而是同源可比的条件**。
- Bitget 与 OKX **同尺度**（都是 0.0000045 量级），所以从 OKX 名（`PEPE-USDT-SWAP`）换到 Bitget 源只需要改名，**不需要乘 1000**。
- 实测：646 个同名符号（Binance ↔ Bitget）**价差全部 < 2%**；跨 scale 的只有 4 个（`1000PEPE` / `1000FLOKI` / `1000LUNC` / `1000SHIB`），它们在 Bitget 侧用的是普通名。

⇒ **本任务不做任何面值换算。** 每个场景只用它自己那个源的符号，源内自洽。

## 已验证的技术事实（2026-10-21 实测）

- **Bitget 源早就写好了**：`src/server/bitget-candles.ts`（`BitgetCandleSource`），翻页用 `/candles`（近段）+ `/history-candles`（老段）两级，已有 6 个翻页测试。
- **但它没接到 `/api/candles` 路由**：现在只有 `source=binance`（带 OKX 兜底）、`source=binance-only`、以及默认的 OKX 三条路。
- **所有周期都通**：`5m / 15m / 1H / 4H / 1D / 1W` 实测均有数据。
- **1D 历史比币安更深**：`/candles` 只能回到 ≈2023-10，`/history-candles` 能到 **2020-09-10**。
- **Bitget 的日线按 UTC+8 切日**（实测日线开盘在 `16:00Z`），币安是 UTC 切日，OKX 是 UTC+8 切日。**切日差异不需要统一** —— 同源自洽即可（与"不做跨源对齐"一致）。
- **回溯复盘（Bitget 单子）目前的 instrument 是 OKX 名**：`bitgetSymbolToOkxInstrument`（`src/domain/bitget-position.ts`）把 `BTCUSDT` 映射成 `BTC-USDT-SWAP`，K 线走 `FREE_REPLAY_CANDLE_SOURCE = 'binance-only'`（`src/ui/free-replay-chart.ts`）。要换成 Bitget 源，**这两处都要改**。

## Goal

三个场景，**各自的 K 线都来自它自己的源**：

| 场景 | 标的来自 | K 线用 | 状态 |
| --- | --- | --- | --- |
| 选品扫描（选 Bitget 源） | Bitget（`BTCUSDT`） | **Bitget** | 新增 |
| 选品扫描（选币安源） | 币安（`1000PEPEUSDT`） | **币安** | 新增 |
| 画线抽屉 | 跟随扫描时选的源 | **同扫描源** | 新增 |
| 回溯复盘（Bitget 单子） | Bitget（`BTCUSDT`） | **Bitget** | 改（现在是币安） |
| 交割单复盘 | OKX（`BTC-USDT-SWAP`） | OKX | **不动** |

## Requirements

### R1 · 选品扫描的 K 线跟着扫描源走

- **R1.1** 扫描服务的 stage-1（1D 粗筛）与 stage-2（距线）**已经**用的是扫描源自己的 K 线（`marketSources[source].candleSource`）—— 这一条**已满足**，需补测试固化。
- **R1.2** **画线抽屉的图**必须跟着**扫描时选的源**走：选 Bitget 就用 Bitget 的 K 线，选币安就用币安的。
  - 抽屉目前在 `App.tsx` 里写死 `candleSource="binance"`（`OtherCoinChart` 的 prop）→ 改成跟随扫描面板的 `source`。
  - 抽屉的 instrument 也要用**该源的符号**：扫描行的 instrument 就是该源的符号（`PEPEUSDT` for Bitget / `1000PEPEUSDT` for 币安），直接传。
- **R1.3** 选品结果行要带上**它来自哪个源**，抽屉才知道该画在哪张图上（扫描响应已有 `params.source`；行本身用 `instrument` 即可定位）。
- **R1.4** 跨源画线的**兜底**保留：10/21 做的比例因子（`refPrice`/`refTime`）在**同源**时因子 = 1（自然），跨源时才生效。**不改**这段逻辑。

### R2 · `/api/candles` 支持 `source=bitget`

- **R2.1** `CandleSourceId` 加 `'bitget'`（`src/domain/candlestick.ts`）。
- **R2.2** `/api/candles` 路由加 `source=bitget` 分支，走 `BitgetCandleSource`。
- **R2.3** **翻页**：`BitgetCandleSource` 的 `allowPaging` 是 opt-in，图表要**开**，否则 1D 只有 90 根（`/candles` 硬上限），回溯复盘往回翻会缺历史。
- **R2.4** **`later` 方向**：Bitget 的 `later` 走单次请求（`startTime`/`endTime` 夹在 90 天跨度内），与 OKX 的 `after` 语义要对齐 —— 需要验证。
- **R2.5** **切日**：`OtherCoinChart` 的 `CandleGrid` 目前按 venue 选（`binance` → `utc`，其它 → `shanghai`）。Bitget 是 **UTC+8 切日**，所以 `bitget` → `shanghai`。
- **R2.6** **缓存命名空间**：`BitgetCandleSource` 已经用 `bitget:` 前缀（`BITGET_KEY_PREFIX`），与币安/OKX 不冲突 —— 不用额外做。

### R3 · 回溯复盘改用 Bitget 源

- **R3.1** `FREE_REPLAY_CANDLE_SOURCE` 从 `'binance-only'` 改成 `'bitget'`。
- **R3.2** `FREE_REPLAY_CANDLE_GRID` 从 `'utc'` 改成 `'shanghai'`（Bitget 是 UTC+8 切日）。
- **R3.3** **instrument 命名**：`bitgetSymbolToOkxInstrument` 把 Bitget 单子映射成 OKX 名（`BTC-USDT-SWAP`）—— 回溯复盘要改成**保留 Bitget 名**（`BTCUSDT`），否则 Bitget 源查不到。
  - ⚠️ 这会**改变回溯复盘会话的存储**（`instrument` 是主键的一部分）。旧会话怎么办要定：**旧会话保持 OKX 名并继续走币安**（向后兼容），新会话用 Bitget 名？
  - 或者：会话里存**两种源**（`candleSource` 字段），旧会话没有这个字段 → 默认币安。
- **R3.4** `/api/free-replay/instruments` 要能列 **Bitget** 符号（现在只有 okx / binance）。
- **R3.5** **回放的光标/进度**逻辑依赖 candle grid 与 step，`CandleGrid` 从 `utc` 变 `shanghai` 会影响 `freeReplayCursorTimeForProgress` 等 —— 要逐个核对。
- **R3.6** **纸面交易**的成交价、标记价都来自 Bitget 单子本身，与 K 线源无关 —— 不动。

### R4 · 交割单复盘原样

- **R4.1** OKX 名、OKX 源、`shanghai` 网格 —— **一行都不改**。
- **R4.2** 「其他币」面板在交割单复盘里仍读 OKX —— 不动。

### R5 · 选品画线抽屉的源跟随

- **R5.1** 选品面板的 `source` 选择器（币安 / OKX / Bitget）当前**只影响扫描请求**；画线抽屉要跟着它。
- **R5.2** 抽屉打开时带上当前 `source`；用户可以在抽屉里**改源**（更实用：扫完发现某个币想在币安上看形态）—— **可选**，先做"跟随"，改动量小。
- **R5.3** OKX 源也要支持（选品有 OKX 选项）→ `source=okx` 走现有 OKX 路径。

### R6 · 不做的

- **R6.1** **不做面值换算**（用户已拍板：同源同名同尺度）。前提是**每个场景只用自己源的符号**。
- **R6.2** **不做跨源的日线切日对齐**（同源自洽即可）。
- **R6.3** **不改**选品扫描的粗筛口径、不改距线的阈值。
- **R6.4** **不删** 10/21 的比例因子（它是跨源兜底，比如用户在交割单复盘（OKX）标的线、然后在选品（Bitget）里看）。

## Acceptance Criteria

- [x] AC1 选品扫描选 Bitget 源 → 画线抽屉的图是 **Bitget** 的 K 线，instrument 是 Bitget 符号（`PEPEUSDT`）
- [x] AC2 选品扫描选币安源 → 抽屉是**币安**的 K 线，instrument 是 `1000PEPEUSDT`
- [x] AC3 选品扫描选 OKX 源 → 抽屉是 OKX 的 K 线
- [x] AC4 画线抽屉往回翻历史能翻到 ≥ 200 根（Bitget 1D 走 `/history-candles`，实测可到 2020-09）
- [x] AC5 回溯复盘的 K 线来自 **Bitget**，且切日是 **UTC+8**（Bitget 的日线在 16:00Z 开）
- [x] AC6 回溯复盘的标的显示为 **Bitget 名**（`BTCUSDT`），且能加载出 K 线
- [x] AC7 **旧的回溯复盘会话**（OKX 名 / 币安源）仍能正常回放 —— 向后兼容
- [x] AC8 交割单复盘**完全不变**：OKX 名、OKX K 线、UTC+8 切日
- [x] AC9 `PEPE` 在选品（Bitget 源）里画的线，与回溯复盘（Bitget 源）里的 K 线**同一坐标系**（同源同尺度，无需换算）
- [x] AC10 `npm test` 与 `npx tsc --noEmit` 干净
- [x] AC11 新增测试：Bitget 源的 `earlier` 翻页、`later` 单次请求、切日网格、抽屉的源跟随

## 风险

| 风险 | 应对 |
| --- | --- |
| 回溯复盘换源后**旧会话失联**（instrument 命名变了） | 会话里记录 `candleSource`；没有该字段的旧会话 → 按旧行为（OKX 名 + 币安源）走 |
| Bitget 的 `later` 语义与 OKX 不同 → 回放往右翻错乱 | 单独测 `later`；必要时用 `allowPaging` 的对称实现 |
| 切日从 `utc` 变 `shanghai` 影响光标/进度计算 | 逐个核对 `freeReplayCursorTimeForProgress` / `markerTimeForEvent` / `timeframeTimeForPoint` |
| Bitget 1D 单次只有 90 根 → 粗筛的 `posRange` 变化 | 选品扫描**已经**用 `allowPaging`（box-brace 用）；扫描服务要确认 1D 走的是 100 根还是 90 根（见 `server/coin-scan.md` 的实测：Bitget 1D 上限 90，**已知**，`posRange` 本来就按 ≤90 算） |
| Bitget 限频（~20 req/s） | 图表是用户手动操作，量小；扫描已共用 `bitgetMarketRatePacer` |
| 画线抽屉换源后，旧的 OKX 名线读不到 | 10/21 的 **canonical 名匹配**正好覆盖：线按 canonical 归组，扫描行也按 canonical 匹配 —— 跨源也能对上 |

## Out of Scope

- 面值换算（用户已拍板不做）
- 跨源日线切日对齐
- 选品粗筛口径 / 距线阈值
- 交割单复盘的任何改动
- 自动找线、收敛/结构判断（早已证伪）
