# Design — 画线磁吸

## 改动边界

| 文件 | 改动 |
| --- | --- |
| `src/ui/drawing-snap.ts`（新增） | 吸附数学，纯函数，无 React / 无 DOM |
| `src/ui/chart-time.ts` | 导出 `containingCandleTimestamp()`（现在是文件私有） |
| `src/ui/App.tsx` | 磁吸模式 state + 工具栏按钮；`pointFromClient` 接吸附；两个面板的 8 处调用点传参；`dragRef` 改存原始点 |
| `tests/drawing-snap.test.ts`（新增） | AC1-AC7 |
| `tests/app-drawing-snap.test.tsx`（新增） | AC8、AC9 |
| `tests/app-drawings.test.tsx` | 按 AC10 更新预览用例的 x 期望 |

不动 `src/domain/drawing.ts`、`src/server/*`、不改依赖。

## 纯模块契约

```ts
export type MagnetMode = 'off' | 'weak' | 'strong';

export type SnapDrawingPointInput = {
  /** 原始指针点（`coordinateToTime` / `coordinateToPrice` 的结果），time 单位为秒。 */
  point: ChartPoint;
  /** 指针在 overlay 内的像素 y，用于算"离哪个 OHLC 更近"。 */
  pointerY: number;
  candles: Candlestick[];
  timeframe: ReviewTimeframe;
  mode: MagnetMode;
  /** 像素阈值，默认 8（klinecharts `modeSensitivity` 默认值）。 */
  sensitivity?: number;
  /** 价格 → 像素 y；返回 null 表示该候选不可换算，剔除。 */
  priceToY: (price: number) => number | null;
};

export function snapDrawingPoint(input: SnapDrawingPointInput): ChartPoint;
```

`priceToY` 由调用方用 `series.priceToCoordinate` 传入 —— 这是把"与 lightweight-charts 的耦合"挡在纯模块外的最小代价：模块自己不 import `lightweight-charts`，测试直接传 `p => (someBase - p) * scale` 这种线性假函数。

## 算法

```
if (mode === 'off') return point

candle = containingCandleTimestamp(point.time * 1000, timeframe, candles)   // 毫秒进
if (candle === null) return point                    // R2 归属失败 → 两维都不吸

time = Math.floor(candle.timestamp / 1000)           // 秒，与 timeframeTimeForPoint 的输出口径一致

candidates = [candle.open, candle.high, candle.low, candle.close]
             .map(price => ({ price, y: priceToY(price) }))
             .filter(c => c.y !== null)
if (candidates.length === 0) return { time, price: point.price }

nearest = candidates 中 |c.y - pointerY| 最小的那个

inside = candle.low <= point.price && point.price <= candle.high
if (mode === 'strong' || inside) return { time, price: nearest.price }
return Math.abs(nearest.y - pointerY) <= sensitivity ? { time, price: nearest.price } : { time, price: point.price }
```

对照 klinecharts（`research/klinecharts-magnet.md`）：区间外用阈值、区间内无条件吸、候选就是四个 OHLC、按像素距离取最近 —— 四条一致。唯一差别是 klinecharts 的区间内分支会细分到"比 max(open,close) 大就取 max 或 high 里更近的"，但那只影响**哪个候选更近**，本质仍是"四个 OHLC 里取像素最近"，所以这里直接用最近候选表达，语义等价且少一半分支。

`inside` 用 `point.price`（未吸附价格）判断，不是 `pointerY` —— 两者等价（价格刻度单调），但用价格更直观，也避免 `priceToCoordinate` 拿不到时的歧义。

## 接线方式

`pointFromClient` 现在只做两件事：屏幕坐标 → `{time, price}`。改成：

```
pointFromClient(clientX, clientY, chart, series, overlay, snapOptions): ChartPoint | null
  → 先算原始点（保持现有实现）
  → snapOptions 存在则 return snapDrawingPoint({ point, pointerY: y, ...snapOptions })
```

`pointerY` 就是同一个 `y = clientY - rect.top`，已有，不额外算。

**吸附必须分两种调用语义**（对应 R4）：

| 调用点 | 传吸附？ | 原因 |
| --- | --- | --- |
| `handleOverlayClick`（线段第 1/2 点、水平直线落点） | 是 | 这是"画在哪" |
| `handleOverlayPointerMove` 里的草稿预览 | 是 | 预览必须显示最终会落到的位置，否则松手会跳 |
| `handleDrawingPointerDown` 存入 `dragRef.startPoint` | **否**（存原始点） | 该点只用于 `moveDrawing` 的增量（`'body'` 与水平线平移分支），量化后会让平移按台阶跳 |
| `handleOverlayPointerMove` / `Up` 的 `'body'` 分支 | 否（用原始点） | 同上 |
| `handleOverlayPointerMove` / `Up` 的端点分支 | 是 | `moveDrawing` 对 `'start'/'end'` 直接用 `currentPoint`，正是要吸的量 |

实现上最简单：`pointFromPointer(...)` 加一个可选 `snap` 参数，同一个函数在两处分别以"吸/不吸"调用；`dragRef` 只存不吸的那个点。

Hmm 落地细节（供实现参考，可自行选更简写法）：`handleOverlayPointerMove` 一次事件里需要两个点（吸附点给端点分支、原始点给 body 分支），因此该函数里调两次 `pointFromClient`（一次带吸附、一次不带）比事后反推更直白；指针每次移动调两次纯函数没有性能问题。

## 与既有行为的关系

- **画线是 instrument 级共享的**：`GET /api/drawings` 只按 instrument 过滤（`app-plugin.ts:188`），`drawing.timeframe` 字段不参与过滤也不参与渲染（App.tsx 不读它），渲染时由 `timeframeTimeForPoint` 把绝对时间投影到当前周期包含它的那根柱。本次不改这个机制。
- **吸附是"画的那一刻结算一次"**（PRD R9）：存的是绝对价格 + 绝对时间。所以在画它的周期上精确贴 OHLC；切到别的周期后线照旧显示、价格不变，但不会再对齐那个周期的 OHLC。与 TradingView 的语义一致。**不**引入"吸附锚点"（把"哪根柱的哪个字段"存起来、切周期重新解析），那会改 `ChartPoint` 与 `chart_drawings` 表结构。
- **已保存的画线数据不受影响**：吸附只影响新落点与拖拽结果。老数据仍按 `{time, price}` 渲染，`time` 不在 K 线柱上时 `timeframeTimeForPoint` 仍会把它映射到包含它的那根柱，视觉不变。
- **时间吸附对线段渲染几乎是"提前做了渲染时已经做的事"**：已保存的线段在 `App.tsx:2012` 会先 `timeframeTimeForPoint` 再 `timeToCoordinate`。所以时间吸附带来的可见差异主要在**草稿预览**（原来跟着指针像素走，现在按柱跳）与拖拽增量。
- **两个面板各接一遍**：`App.tsx` 里自由复盘与交割单复盘各有一份 `pointFromClient` 调用与 `dragRef`，本次两处都改，但两份实现的合并留给独立重构（PRD Out of Scope）。

## 已知的测试影响（AC10）

`tests/app-drawings.test.tsx::previews a segment...` 断言草稿 `x1 === '10'`。其 mock：

```
coordinateToTime: x => 1716256800 + x      // 秒
timeToCoordinate: t => t - 1716256800
candles: 只有一根 5m，timestamp = 1716256800000ms = 1716256800s
```

时间吸附后第一个点归属到该柱 → `time = 1716256800` → `timeToCoordinate = 0`，于是 `x1` 从 `10` 变成 `0`。这是时间吸附的必然结果，用例要改成断言新值（并保留"x2 仍跟随指针"的原意）。**不允许**为了保住旧断言而关掉草稿的时间吸附。

## 权衡

- **时间恒定吸附** → 草稿预览按柱跳，与 TradingView/klinecharts 一致；代价是"点放在两根 K 线之间"不再可能。这是用户明确选定的口径（PRD R2）。
- **区间内无条件吸** → 指针落在 K 线实体附近时几乎总是吸住；代价是在实体内部无法自由落点。同样照搬 klinecharts，用户已确认。
- **平移不吸** → 与 klinecharts 不一致（它连平移都吸），换来的是平移仍然连续可拖。已在 `research/klinecharts-magnet.md` 末尾记录这处有意偏离。
- **纯模块 + 注入 `priceToY`** → 换取了完全可测的几何逻辑，代价是多一层函数参数传递。

## 回滚

改动集中在 3 个源文件 + 3 个测试文件，且默认模式是 `weak`：把默认值改成 `off` 就等价于关闭整个特性（但按钮与纯模块仍在）。彻底回滚 = revert 全部 hunk。
