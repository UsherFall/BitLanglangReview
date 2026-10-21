# 选品: 距线修复 + 20 个上限 + 画线抽屉

> 状态：done（2026-10-21 创建并完成）。
> 提交：`16bbda4`。
> 上游：`10-20-level-alert-in-scan`（距线上线）、`10-20-anomaly-level-tracker`（粗筛实测结论）。

## 背景（用户 10/21 原话）

1. **「现在的选品扫描扫距你标的线不对」** —— 距线列的值不可信。
2. **「粗筛今天筛出了 151 个，有点太多了」** —— 但仍要**维持 20 个**（用户拍板）。
3. **「日线窗口 23 天是什么意思」** —— UI 没解释。
4. **「画线点开后里面并没有画线功能」** —— 画线抽屉是个只读图。

## 根因（已定位到代码）

| 现象 | 根因 |
| --- | --- |
| 距线恒为 -100% / 永远「不接近」 | `src/domain/level-alert.ts` 把**秒**（`ChartDrawing.points[].time`，来自 lightweight-charts `coordinateToTime`）与**毫秒**（`Candlestick.timestamp`）混用：`levelPriceAt` 的 `(at - t2)` 大了 1000 倍；`scaleStartIndex` 的 `findIndex` 恒为 0 |
| 画的线对扫描完全没影响 | 画的线存的是 OKX 名（`BTC-USDT-SWAP`），扫描池是 Bitget/Binance 名（`BTCUSDT`）→ `linesByTimeframe` 按 instrument 精确匹配，一根都匹配不上 |
| 跨交易所价位不同 | 线的价来自画线那个交易所，尺子/现价来自扫描那个交易所（默认 Bitget） |
| 画线抽屉没有画线功能 | 抽屉复用 `src/ui/OtherCoinChart.tsx`，而 drawing overlay + 工具条只存在于 `App.tsx` 的 `TradeChart` / `FreeReplayChart` |
| 151 个 | 粗筛是**故意放宽**的（池内分位 qR=0.737 / qN=0.485，设计放行 ≈44%）；实测 151/≈340 ≈ 44%，属预期 |

## Goal

- 距线**真的可信**：单位、交易所、命名三层都修好，标的线真正参与计算。
- 选品结果**默认只出 20 个**，可放开看全部（151 个还在后台，不丢召回）。
- 画线抽屉**能画线**。
- UI 解释清楚「日线窗口 23 天」。

## Requirements

### R1 · 距线的单位口径（domain，纯函数）

- **R1.1** `LevelLine` 的端点时间一律**毫秒**，与 `Candlestick.timestamp` 同单位。
- **R1.2** `linesFromDrawings` 负责把产品 `ChartDrawing.points[].time`（**秒**）转成毫秒；研究标注用的 `t` 字段**本来就是毫秒**，原样透传。
- **R1.3** `levelPriceAt` / `scaleStartIndex` / `levelAlert` 全部按毫秒计算，射线插值与「射线起点之后那段」的尺子必须真的生效。
- **R1.4** `at`（评估时刻）保持毫秒语义，与调用方 `completed.at(-1).timestamp` 一致。

### R2 · 跨交易所 / 跨命名匹配

- **R2.1** 新增 canonical instrument 口径：`BTC-USDT-SWAP` / `BTCUSDT` / `BTC-USDT` 归一到同一个 base（`BTCUSDT`），用于**匹配**，不改存储。
- **R2.2** 扫描服务按 canonical 名分组线，OKX 名标的线与 Bitget/Binance 名的扫描行**能对上**。
- **R2.3** **价格基准换算**：线记录它画在哪个交易所、画线那一刻该周期的收盘价（`refPrice` / `refTime`）；扫描侧用「同币同时刻的扫描源收盘价 ÷ `refPrice`」得到比例因子，线价整体缩放后再算距线。没有 ref 数据（旧数据）→ 因子 = 1（不缩放）。
- **R2.4** `ChartDrawing` 增补 `refPrice` / `refTime`（**可选**，旧数据兼容）；存储层加列并迁移。
- **R2.5** 比例因子只在「同一时刻两根 K 线都能找到」时生效；找不到就退回 1，不猜。

### R3 · 结果只出 20 个

- **R3.1** 粗筛的**分位阈值不动**（`COARSE_SCREEN_PCT_RANGE` / `COARSE_SCREEN_PCT_NET` / `COARSE_POS_RANGE_FLOOR` 全部保持）——实测收紧会砍掉已认可的标的。
- **R3.2** **展示层**截断：默认显示前 20 行（服务端排序「距你标的线最近在前」），配「显示更多」可展开全部（151 行仍可看）。
- **R3.3** 降权（手动沉底）语义不变，且在截断**之前**应用（沉底的币不占前 20）。
- **R3.4** 表头要能看出「共 N 个（粗筛 M 个），显示 20 个」。

### R4 · 画线抽屉能画线

- **R4.1** 把 drawing overlay / 工具条 / 拖拽 / 磁吸从 `App.tsx` 抽成可复用模块（`src/ui/chart-drawing.tsx`），`TradeChart` / `FreeReplayChart` / `OtherCoinChart` 共用。
- **R4.2** `OtherCoinChart` 支持画线：水平线 + 射线，保存/删除走 `/api/drawings`，按 instrument + timeframe 维度存取。
- **R4.3** 画线抽屉的图与扫描结果**同一交易所口径**（Bitget 名 = Binance 名，线画在 Binance 图上；扫描用 Bitget K 线，R2.3 的比例因子负责对齐价位）。
- **R4.4** 抽屉内切换周期时，线按周期各自存取（与扫描的「每周期各自的尺子」一致）。
- **R4.5** 已有的线在抽屉里**看得见**（`OtherCoinChart` 载入该 instrument 的 drawing 列表并渲染）。

### R5 · UI 说明

- **R5.1** 表头解释「日线窗口 23 天」：粗筛用**最近 23 根日线**算区间振幅与净漂移（盘得够久 / 收住了 / 不在趋势中）；**位置（位）算的是全部历史**，不是 23 天。
- **R5.2** 说明用 `title` 悬浮提示 + 一行可读的短说明，不新增占屏的面板。

### R6 · 不变的

- **R6.1** 粗筛的行入选条件不变（通过粗筛即候选）。
- **R6.2** `drawing-store` 的既有表结构与旧数据保持可读（只增列不重写）。
- **R6.3** 箱体蓄力（box-brace）扫描不动。

## Acceptance Criteria

- [x] AC1 距线在**真实画线数据**上可信：同一根线，用「画线时的交易所 + 价位」和「扫描时的交易所 + 价位」算出的距线差异 ≤ 0.2%（比例因子生效）。
- [x] AC2 射线插值正确：一条斜线在两个端点之间的价位 = 线性插值（现有 `levelPriceAt` 单测在**毫秒**语义下仍通过，且新增一条「秒/毫秒混用会被新单测抓住」的回归用例）。
- [x] AC3 尺子按「射线起点之后那段」计算（有射线时），旧数据的退化行为保持（找不到起点 → 最近 60 根）。
- [x] AC4 命名映射：canonical 口径下 OKX 名与 `base+USDT` 名归一（单测覆盖 `BTC-USDT-SWAP` / `BTCUSDT` / `BTC-USDT`）。
- [x] AC5 扫描服务：画过线的币（OKX 名存储）能在扫描结果里拿到距线（服务级单测：drawing store 存 OKX 名，扫描行是 `base+USDT` 名 → `levelAlerts` 非 null）。
- [x] AC6 比例因子：ref 数据齐全时线价被缩放；缺失时退回 1；单测覆盖三种情况。
- [x] AC7 结果默认**只显示 20 行**，并有「显示更多」；展开后是全部粗筛行（含降权沉底）；表头显示总数与截断口径。
- [x] AC8 降权沉底在截断之前生效（被降权的币不进前 20）。
- [x] AC9 粗筛分位常量**未变**（单测断言三个常量原值）。
- [x] AC10 画线抽屉可画线：选品页点「画线」→ 抽屉里能画水平线/射线 → 保存后刷新页面仍在 → 扫描结果出现该币的距线。
- [x] AC11 抽屉里能看到该币已有的线。
- [x] AC12 UI 有「日线窗口 23 天」的口径说明。
- [x] AC13 `npm test` 与 `npx tsc --noEmit` 干净。

## 风险

| 风险 | 应对 |
| --- | --- |
| `App.tsx` 抽 drawing 模块动到两个成熟图表 | 只做**搬迁**不改行为；`TradeChart` / `FreeReplayChart` 的画线行为由既有测试 + 新增回归测试守住 |
| 比例因子算错反而更糟 | 因子缺数据就退 1；`refPrice` 记录的是画线图表的收盘价，同一时刻同一 base，比例接近 1，出错时距线不会离谱 |
| 20 个截断把用户想看的币挡在外面 | 「显示更多」一键放开；截断只发生在展示层，后台候选集不变 |
| 旧 drawing 无 ref 字段 | 可选字段 + 迁移只增列；旧数据按因子 1 处理 |
| `level-alert` 单测的语义从「混用」变「统一」 | 单测要按新口径重写，不是删断言；parity 测试同步迁到 archive 路径 |

## Out of Scope

- 自动找线（永远由用户标）
- 收敛 / 股性 / 结构判断（已证伪，见 `10-20-anomaly-level-tracker/research/screen-redo.md`）
- 粗筛召回优化（已证伪：收紧到 20 会砍掉已认可的标的）
- 选品页自有图表（仍用浮层里的图）
