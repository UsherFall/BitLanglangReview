# Design · 选品: 距线修复 + 20 个上限 + 画线抽屉

> 依据：`prd.md`（2026-10-21）。本文只讲**技术设计**，执行清单在 `implement.md`。

## 1. 边界总览

```text
src/domain/level-alert.ts        纯算术：时间单位、线价、距线、尺子
src/domain/instrument-symbol.ts  canonical 名（匹配用）+ 交易所名归一
src/domain/drawing.ts            ChartDrawing 增补可选 ref 字段
src/server/drawing-store.ts      增列迁移（只增不改）
src/server/coin-scan-service.ts  按 canonical 名匹配线 + 比例因子 + 排序
src/ui/chart-drawing.tsx         【新】drawing overlay / 工具条 / 拖拽 / 磁吸
src/ui/OtherCoinChart.tsx        接入画线模块（可画线 + 显示已有线）
src/ui/CoinScanPanel.tsx         结果截断 20 + 「显示更多」+ 23 天说明
src/ui/App.tsx                    画线浮层传 timeframe；TradeChart/FreeReplayChart 改用新模块
```

跨层数据流（一次扫描）：

```text
drawing-store (按 instrument+timeframe)
        │  linesFromDrawings → LevelLine[]（端点时间毫秒）
        ▼
canonicalInstrument('BTC-USDT-SWAP') === canonicalInstrument('BTCUSDT')
        │  同一 canonical 的线归到同一组
        ▼
priceScaleFactor(refPrice/refTime, scanSource, timeframe)
        │  同一时刻两边的收盘价比 → 因子
        ▼
levelAlert(candles, scaledLines, at) → distancePct / scalePct / ratio / state
        ▼
ScanRow.levelAlerts[timeframe]  →  UI「距你标的线」列
```

## 2. 时间单位：统一到毫秒

**现状**：`ChartDrawing.points[].time` 是**秒**（`pointFromClient` 用 `chart.timeScale().coordinateToTime(x)`，lightweight-charts 返回秒）。`Candlestick.timestamp` 是**毫秒**。`level-alert.ts` 里两者直接相减。

**决策**：domain 层的 `LevelLine` 端点时间**一律毫秒**。理由：
- `Candlestick.timestamp`（毫秒）是 domain 的既有口径（`src/domain/candlestick.ts`），K 线、交易时间戳全用它；
- 研究侧的标注文件用 `t` 字段，本来就是毫秒（`research/pool/*.json` 里是 `1775232000000`），统一到毫秒后研究数据与产品数据**同单位**，`level-alert-parity` 测试可以直接用产品代码跑研究数据。

**转换点只有一个**：`linesFromDrawings`。它是 product `ChartDrawing` → domain `LevelLine` 的唯一入口，负责把秒转毫秒。

```ts
/** 端点时间 → 毫秒。产品存的是秒(`coordinateToTime`)，研究标注存的是毫秒。 */
function pointTimeMs(point: { time?: number; t?: number }): number {
  const raw = point.time ?? point.t;
  if (!Number.isFinite(raw)) return Number.NaN;
  // `t` 是研究口径 = 毫秒；`time` 是产品口径 = 秒。
  return point.t !== undefined ? raw : raw * 1000;
}
```

判别依据用**字段名**而不是数值大小（数值判别会在 1970 年附近的合法值上翻车）。为了不把两个字段混为一谈，`LevelLine` 的端点类型改成**分离**：

```ts
export type LevelPoint = { /** 毫秒 */ ms: number; price: number };
export type LevelLine =
  | { kind: 'horizontal'; price: number }
  | { kind: 'ray'; price: number; p1: LevelPoint; p2: LevelPoint };
```

`p1`/`p2` 从 `{time|t, price}` 换成 `{ms, price}`，让「单位」在**类型上**就是确定的，编译期能挡住新的混用。`levelPriceAt(line, at)` 的 `at` 也明确是毫秒（K 线 timestamp）。

**兼容**：`level-alert-parity.test.ts`（在 archive 里）用研究数据构造 `LevelLine`，改字段名后该测试需要同步迁移路径（`10-20-anomaly-level-tracker` → archive 目录）并改构造写法。

## 3. canonical 名：只用于匹配

**现状**：扫描池是 Bitget/Binance 名（`BTCUSDT`），画线存的是 OKX 名（`BTC-USDT-SWAP`），`linesByTimeframe` 按 `drawing.instrument === ticker.instrument` 精确匹配 → 一根线都匹配不上。

**决策**：新增 `src/domain/instrument-symbol.ts` 的 canonical 函数（该文件已有 OKX↔Binance 映射的先例）：

```ts
/** 归一到 `BASE+USDT`，用于【匹配】。不改存储、不改展示。 */
export function canonicalInstrument(instrument: string): string;
/** 展示用：OKX 名去后缀，其它原样。 */
export function shortInstrument(instrument: string): string;
```

规则：
- `BTC-USDT-SWAP` → `BTCUSDT`
- `BTC-USDT` → `BTCUSDT`
- `BTCUSDT` → `BTCUSDT`（原样）
- `BTCUSDT_PERP` / `BTCUSDTM` 等 Bitget 变体 → 剥后缀
- 无法识别 → 原样（小写比较）

**边界**：canonical 只用于**匹配**。展示名、API 路径、存储键都保持原样——改存储键会让历史 drawing 全部失联。

## 4. 跨交易所价格基准换算（比例因子）

**问题**：线画在 Binance 图上（价 = Binance 价），扫描跑在 Bitget（价 = Bitget 价）。同一 base 的两个交易所价格有小差异（Binance 溢价 0.1%~2%），对「距线 ≤ 0.5×尺子」这种窄判据，1% 的错位就能把 alert 变成 far。

**决策**：在 `ChartDrawing` 上记两个**可选**字段：

```ts
export type ChartDrawing = {
  ...
  /** 画线那张图的**同一周期**收盘价（画线时刻）。跨交易所对齐用；缺省=1。 */
  refPrice?: number;
  /** `refPrice` 对应的时刻（毫秒）。 */
  refTime?: number;
};
```

画线保存时（UI 侧）写入当前图表该币**当前周期最后一根已收盘 K 线的 close** 与其时间戳。存量数据没有这两个字段 → 因子 = 1（不缩放，行为等于今天）。

**因子计算**（server 侧，扫描源）：

```ts
scale = scanSourceClose(at refTime) / refPrice
scaledLinePrice = linePrice * scale
```

要求：
- 找的是**同一时刻**（`refTime`）在**扫描源**、**同一周期**的收盘价；
- 找不到（该币在该源没有这一根 K 线 / 时间超界）→ 因子 = 1，并在响应里记一笔（不静默）；
- 只对**非水平线**和水平线都适用（水平线也需要换算，因为价是绝对价格）。

**为什么不做「同一 base 同一时刻的比价缓存」**：那要引入跨源 K 线对齐的缓存与失效策略，而 ref 方案是**画线时冻结**的一次性快照，语义更清楚：一个线永远对应它画出来那一刻的价格坐标系。

**风险与兜底**：若某交易所的同一 base 价格体系差异巨大（历史上出现过 `SHIB`→`1000SHIBUSDT` 这类面值改名，`instrument-symbol.ts` 已明确禁止这类跨 scale 映射），因子会离谱。**兜底**：因子超出 `[0.5, 2]` 视为不可信 → 退回 1，并在响应里标记。`instrument-symbol.ts` 的 `BINANCE_SYMBOL_ALIASES` 规则继续适用。

## 5. 扫描服务：匹配 + 换算 + 排序

`CoinScanService.scanShrink` 的 stage-2 改：

```ts
// 1) 按 canonical 分组（而不是精确 instrument）
const byCanonical = new Map<string, Map<string, LevelLine[]>>();  // canonical -> timeframe -> lines
// 2) 对每个 (ticker, timeframe) 取线：canonical(ticker.instrument) 命中
// 3) 换算：scanClose(refTime) / refPrice
// 4) levelAlert(candles, scaledLines, at, scaleStartIndex(...))
```

**排序**（保持现状语义，不引入新轴）：
- 现在的排序是「距线最近在前（ratio 最小）」，无线线的沉底 —— 这正是用户要的「贴近我的线」。
- 20 个截断**在排序之后**，所以前 20 = 最贴近你标的线的 20 个。

**改动的响应字段**：`CoarseSummary` 不变；新增（可选）`levelScaleNotes?: string[]`，记录「因子不可信已退回 1」等，供 UI 提示。**默认不出现**（无异常时响应与今天同形）。

## 6. 展示层截断 20

**决策**：截断**只发生在 UI**，服务端返回全部行。

理由：
- 粗筛分位阈值是召回的核心（收紧会砍掉已认可的标的，实测见 `screen-redo.md`），**服务端不能动**；
- 服务端截断会让「已降权沉底」和「排序」耦合在两个地方；
- UI 截断可随时放开，后台候选集完整。

实现（`CoinScanPanel.tsx`）：

```tsx
const COLLAPSED_ROWS = 20;
const [showAllRows, setShowAllRows] = useState(false);
const visibleRows = showAllRows ? rows : rows.slice(0, COLLAPSED_ROWS);
```

- `rows` = `orderScanRows(result.scanned, demotedCoins)`（**降权沉底在截断之前**，PRD R3.3）；
- 表头：`粗筛 151 个 · 显示 20 个` + 「显示更多」按钮（还有 N 个）；
- 「显示更多」点击后按钮变成「收起」。

**降权沉底与截断的交互**：降权是用户对**已看到的**行的判断，所以沉底在截断前应用；被降权的币不占前 20 的位置（用户明确降权过的不该再占名额）。

## 7. 画线能力抽成可复用模块

**现状**：`App.tsx` 里 `DrawingOverlay` / `DrawingShape` / `pointFromMouse` / `pointFromPointer` / `pointFromClient` / `moveDrawing` / `rayEndPoint` / `drawingStyleForTimeframe` / `handleOverlayClick` / `selectDrawingTool` / `saveDrawing` / `deleteSelectedDrawing` / drawing-toolbar JSX 都**内嵌在 `TradeChart` 和 `FreeReplayChart` 两个组件里**（几乎重复实现），而 `OtherCoinChart` 完全没有。

**决策**：新建 `src/ui/chart-drawing.tsx`，导出：

```ts
export function useChartDrawings(opts: {
  instrument: string;
  timeframe: ReviewTimeframe;
  tradeId?: string | null;
  /** 画线用的 K 线（磁吸与 ref 价都取自它） */
  candles: Candlestick[];
}): {
  drawingTool, setDrawingTool,
  drawings, selectedDrawingId, setSelectedDrawingId,
  draftPoint, draftEndPoint,
  overlayRef,
  toolbar: ReactNode,        // 水平线 / 射线 / 删除
  overlay: ReactNode,        // <svg> overlay
};
```

`TradeChart` / `FreeReplayChart` 改成调用这个 hook，行为**逐字保持**（只是搬迁）。

**`OtherCoinChart` 接入**：
- 新增 prop `drawable?: boolean`（默认 false，`TradeChart` 场景的「其他币」面板不画线，避免行为变更）；
- 抽屉场景传 `drawable`；
- 载入 `GET /api/drawings?instrument=…`，**按 timeframe 过滤**（`/api/drawings` 现在只按 instrument 返回全部，需要按 timeframe 过滤——UI 侧过滤即可，或服务端加 `timeframe` 查询参数；**UI 侧过滤**更小改动，但服务端加参数更省流量 → **两者都做**：服务端支持可选 `timeframe` 参数，UI 传它）；
- 画线保存时带 `refPrice` / `refTime`（当前图表该周期最后一根已收盘 K 线的 close + timestamp）。

**抽屉里的图用哪个交易所？**：扫描默认源是 Bitget，但 `OtherCoinChart` 只支持 `okx` / `binance`。**决策**：抽屉用 **Binance**（`candleSource="binance"`，`initialInstrument` 需要从 `BTCUSDT` 换回 `BTC-USDT-SWAP` 风格的 OKX 名或直接用 Binance 名）。
- Binance 名与 Bitget 名**相同**（`BTCUSDT`）→ 抽屉用 Binance 图，画线存 `BTCUSDT`，扫描池也是 `BTCUSDT` → **canonical 天然对上**；
- 但产品里「其他币」面板用的是 OKX 名（`BTC-USDT-SWAP`）→ canonical 也对上；
- 两条路都靠 canonical 匹配，**这正是加 canonical 的价值**。

**价位对齐**：抽屉图是 Binance 价，扫描是 Bitget 价 → 由 §4 的比例因子处理。

**周期切换**：抽屉头的周期按钮切换时，`timeframe` 变 → 重新载入该周期的线（`GET /api/drawings?instrument&timeframe`）并重画。切换时 K 线也重载（`OtherCoinChart` 已支持）。

## 8. UI：解释「日线窗口 23 天」

表头一行：

```tsx
<p title="粗筛用最近 23 根日线算区间振幅与净漂移（盘得够久 / 收住了 / 不在趋势中）；「位」算的是该币全部历史里的位置，不是 23 天。">
  粗筛 151 个 · 显示 20 个 · 日线窗口 23 天
</p>
```

再加一行短的常驻说明（`.coin-scan-skip-hint` 样式的小字，或同 `title`）：

> 日线窗口 23 天 = 最近 23 根日线算「区间 / 净漂移」；「位」= 该币在**全部历史**里的位置。

## 9. 数据迁移

`chart_drawings` 表增两列（`ref_price REAL`, `ref_time INTEGER`），迁移方式**照抄现有 `allowNullableTradeId` 的模式**（建新表 → copy → drop old → 重建索引）。旧行两列为 NULL → 因子 1。

**不做**数据回填：旧线没有 ref 就按因子 1 处理（与今天行为一致），用户重画一次就有了。

## 10. 测试计划

| 文件 | 覆盖 |
| --- | --- |
| `tests/level-alert.test.ts`（改） | 毫秒语义下的 `levelPriceAt` / `scaleStartIndex` / `levelAlert`；**新增**：秒/毫秒混用的回归用例（用 `t` 毫秒 + `time` 秒混搭，断言不产生天文数字） |
| `tests/instrument-symbol.test.ts`（新/扩） | canonical：`BTC-USDT-SWAP` / `BTCUSDT` / `BTC-USDT` / 大小写 → 同一 canonical |
| `tests/coin-scan-service.test.ts`（扩） | OKX 名 drawing ↔ `base+USDT` 扫描行 → `levelAlerts` 非 null；比例因子三种情况（齐全/缺失/不可信） |
| `tests/coin-scan-results.test.tsx`（扩） | 默认只渲染 20 行；「显示更多」展开全部；降权沉底不占前 20；表头文案 |
| `tests/level-alert-parity.test.ts` | 迁移到 archive 路径 + 改 `LevelLine` 构造（`{ms, price}`） |
| `tests/app-drawings.test.tsx`（扩） | 画线抽屉：能画线、保存、刷新后仍在 |
| `tests/drawing-store.test.ts`（扩） | `refPrice` / `refTime` 的存取 + 旧行兼容 |

## 11. 风险与回滚

- 每个改动点独立提交，任意一步可回滚。
- §4 的比例因子是**唯一有语义风险**的部分：默认退回 1（等于今天），最坏情况是「距线略有偏差」，不会崩。
- §7 是**纯搬迁**，`TradeChart` / `FreeReplayChart` 行为由既有测试守住。

## 12. 不做什么

- 不动粗筛分位常量（实测收紧会砍掉已认可的标的）。
- 不做「自动找线」「收敛」「结构判断」。
- 不改 `drawing-store` 的存储键。
- 不给选品页做自有图表。
