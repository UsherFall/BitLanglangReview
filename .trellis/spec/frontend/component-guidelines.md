# Component Guidelines

## Components In This App

The UI is a dense local review tool, not a marketing site. Components should keep the first screen usable for reviewing trades or starting Free Replay. Match the existing two-pane structure in `src/ui/App.tsx`: a sidebar for mode, filters, queue, and replay setup; a workspace for chart, timeframe controls, metrics, drawings, and review editing.

## Props And Data Flow

Use typed inline props for small components and exported types when another file needs the shape. `ReviewEditor` accepts a `ReviewedTrade` and an `onSaved` callback. `FreeReplayPanel` exports `FreeReplayStart` because `App.tsx` stores that shape.

Prefer callbacks that report completed domain events instead of exposing component internals:

- `ReviewEditor` calls `onSaved(review)` after `/api/reviews` returns a `TradeReview`.
- `FreeReplayPanel` calls `onStart(start)` after it records the selected start time as exact Free Replay `progressTime` and derives the current timeframe cursor from that progress through no-future Free Replay helpers.

## Chart Components

`TradeChart` and `FreeReplayChart` inside `App.tsx` integrate with `lightweight-charts`. Keep imperative chart objects in refs (`chartApiRef`, `seriesRef`, marker refs, overlay refs) and keep React state for UI state that affects rendering or controls.

Important local patterns:

- Create and remove the chart in a mount-only `useEffect`.
- Use refs for loaded/rendered candlestick arrays when event handlers need current data without re-subscribing every render.
- Preserve the Chart Navigation Anchor when applying on-demand loaded candlesticks. See `visibleRangeForAnchor` and `visibleRangeForLatestAnchor` in `src/ui/chart-navigation-anchor.ts`.
- In Free Replay, show only candles through the Free Replay Cursor. The cursor is a derived display boundary: the latest complete candlestick whose end time is not after `replay.progressTime`. Use `visibleCandlesForFreeReplay` from `src/ui/free-replay-chart.ts`.

- `TradeChart` has an all open/close markers mode: a toolbar toggle fetches `/api/trades?instrument=...` (unfiltered), computes `allTradeMarkers` with the active Trade highlighted, and hides the single-trade Eye button while active. Keep the marker list in the pure helper `src/ui/trade-markers.ts` and update both series whitespace and markers when the all-trade set changes.

- Trade marker points are drawn as canvas dots by `TradeMarkerPrimitive` (not `createSeriesMarkers`), because the built-in shapes cannot express "icon only, no label, with a hover card", and a DOM/SVG overlay was already rejected for making dragging stutter. Each point must be anchored to a **loaded** candlestick: `tradeChartPoints` resolves the action's time with `containingCandleTimestamp` and **drops** the point when no loaded candle contains it, and the primitive looks that candle up by the point's chart time (`candleByChartTime`). Never floor an out-of-range time onto the timeframe grid — the x coordinate would come from one candle and the price anchor from another, drawing the dot in mid-air (this shipped once and read as "the dot drifted off the entry"). Rounds whose later actions fall outside the 150-bar initial window are covered by `extendCandlesForLateActions`, which pulls one extra window and must swallow its own failure so the primary load still renders.
- `OtherCoinChart` (其他币) marks the active trade's entry candle with a faint vertical reference line (`.other-coin-marker-overlay`, no label). It maps the entry event to a candle with `markerTimeForEvent(entryTime, timeframe, loadedCandles)` then to an x coordinate with `chart.timeScale().timeToCoordinate(...)`; the line only renders when that coordinate is non-null (entry candle loaded and on-scale). Because `autoSize` fires no logical-range event, the x must be recomputed on: initial load and `loadMore` (after `setVisibleRange`, in a `requestAnimationFrame`), the `subscribeVisibleLogicalRangeChange` handler (before the `suppressAutoLoadRef` early return, so programmatic range changes count), a `ResizeObserver` on the chart wrap, and a reset to `null` when `instrument`/`timeframe` change.

### Free Replay Cursor Follow

When the cursor advances in Free Replay, the chart viewport **must scroll to follow** so the user sees the new candle. Keep the current zoom level (visible span) by computing `span = visible.to - visible.from` before calling `setVisibleRange`:

```typescript
// Cursor follow: preserve zoom level, keep cursor 10 steps from right edge
const step = timeframeMs(timeframe) / 1000;
const span = visible.to - visible.from;
chart.timeScale().setVisibleRange({
  from: (replay.cursorTime - span + step * 10) as UTCTimestamp,
  to: (replay.cursorTime + step * 10) as UTCTimestamp,
});
```

Set `suppressAutoLoadRef.current = true` before `setVisibleRange` and reset it via `setTimeout(0)` to prevent the `visibleLogicalRangeChange` handler from firing during the range update. Use a range-key guard (`instrument:startTime:timeframe`) to skip the first cursor-follow pass for each newly initialized chart range; otherwise a timeframe switch can reuse the previous timeframe's visible span and overwrite the fresh initialization.

When switching Review Timeframes, preserve candle visual density rather than preserving the old time span. Prefer `chart.timeScale().getVisibleLogicalRange()` to derive the actual visible candle count; fall back to `chart.timeScale().options().barSpacing` and chart width only when logical range is unavailable. After the new timeframe data is rendered, use `timeToIndex(..., true)` for the anchor and `setVisibleLogicalRange(...)` for the destination viewport. Free Replay anchors this logical range on `replay.cursorTime` with about 10 future bars of right padding; Trade Review anchors it on the previous visible center time.

After a Free Replay timeframe switch, the preserved visible candle count can be wider than the fixed initial history load. Keep a switch-scoped backfill target for the captured visible candle count and evaluate it only after `loadedCandles` belongs to the destination timeframe. If `visibleCandlesForFreeReplay(loadedCandles, replay.cursorTime).length < visibleBars - rightPaddingBars`, call the existing earlier-candlestick loader until enough unique historical candles are loaded or the API returns no new data. Do not reveal future candles to fill blank space. Add both a pure helper test for the backfill decision and an App-level regression test that switches timeframe after a zoomed-out viewport and observes a `/api/candles?...mode=earlier` request.

Free Replay must keep `progressTime` separate from `cursorTime`. Switching Review Timeframes preserves `progressTime` and recomputes the derived cursor; it must not floor and store the old cursor as the new true progress. For example, `progressTime = 10:35` maps to `10:30` on `5m` and `04:00` on `4H` so the unfinished `08:00-12:00` candle is not shown.

## Instrument Scan Panel

`CoinScanPanel.tsx` owns the 选品 scan UI (parameter area + results table). Contract:

- The parameter area always sends every scan param (`topN`, `plateauMin`, `maxCompression`, `maxLatestTrend`, `trendWindow`, `minQuoteVolume24h`) as a number input, pre-filled with the current defaults (e.g. `plateauMin` prefills `2`, `maxCompression` prefills `0.8`, `maxLatestTrend` prefills `0.9`, `trendWindow` prefills `3`, step `0.05` for the ratio thresholds), and validates all inputs are non-empty finite numbers before scanning. There is no `时间周期` selector (one click scans all 5 timeframes — v6) and no `压缩窗口` input (the plateau scans `PLATEAU_BOX_WINDOWS` internally). Volume-related params (`ratioThreshold`, `consecutive`, `window`) are gone — the scan is pure price (v5). An optional `datetime-local` 扫描时间点 input sends `anchor` (epoch ms) when set, or omits it to scan "now"; a past anchor scans historical convergence on every timeframe (bars whose close time `<= anchor`).
- The results table renders one row per `ScanRow`. Columns are 币 | 最新价 | 24h 涨跌 | 成交额 | 收敛周期 | 状态 | 操作, where 收敛周期 = `convergenceTimeframes.join(', ')` (e.g. `1H`, `1H,4H`). There are no volume columns and no flat 压缩比/收窄趋势 columns — those live in the expandable per-timeframe detail. A 「详情」 button toggles an expandable row (`.coin-scan-detail-row`) containing a sub-table over `row.timeframes` with columns 周期 | 压缩比 | 收窄趋势 | score | 窗口 | plateau宽 | 状态; non-qualified timeframes are dimmed (`:not(.qualified)`), and every cell uses `formatCompression` / `formatLatestTrend` / `formatScore`, which show `—` for the `LARGE_RATIO` flat-window sentinel (>= 1e9) and otherwise `toFixed(2)`, so the user can calibrate `maxCompression` / `maxLatestTrend` by eye. The service already sorts rows (`qualifiedCount` desc then `bestScore` asc); the UI renders them as-is. Qualified rows get the `.qualified` class.
- Styles reuse the `.coin-scan-*` naming and color palette in `src/ui/styles.css`.
- 结果表支持**手动降权**:每行一个 toggle 按钮(`aria-pressed` 反映状态)。被降权的标的 —— 用户人工判断其日线结构不适合做多 —— 在表内**沉底 + 灰化**(`.demoted`),**不做自动判定**(口径由人看)。排序由纯函数 `orderScanRows`(`src/ui/coin-scan-rows.ts`)完成:它是**稳定分组**而非重新排序,服务端顺序在每个分组内部原样保留,且表头 `扫描/收敛` 计数不因降权变化。标记存 `localStorage`(key `scan-demoted`,读取走 `loadStoredStringList`),与龙头币标记(`leader-coins`)是两套独立的值,互不写入。

## Market Heat Panel

`MarketHeatPanel.tsx` is the floating review-detail panel opened by the 热度 button in the trade/bitget detail header. Contract:

- Props `{ instrument, entryTime, onClose }`; the heat anchor is the trade's entry time (no entry/exit toggle), and the request is `GET /api/market-heat?anchor=<epochMs>&instrument=<symbol>`, guarded against stale responses. Switching to a different trade CLOSES the panel (App effect on `selectedId`) — a whole-pool candle fetch happens per new anchor, so a reading is computed only when the reviewer clicks 热度 for the current trade; the server's per-anchor memo still makes reopening the same trade a zero-request hit.
- Renders the 5-tier verdict (热市/偏热/中性/偏冷/冷市), the number row (中位涨跌 / 涨/跌家数 / 异动家数 / 覆盖数), the 涨幅榜/跌幅榜 boards, and the 休市/无行情/无法归一 skip summary plus rate-limit warnings. The reviewed coin's row is highlighted and suffixed `· 复盘币`.
- Styles live under the `.market-heat-*` naming in `src/ui/styles.css`.
- The panel appears only in the trade/bitget detail branch (it never shows in scan or free replay), and the App closes it whenever the selected trade changes (see the entry-anchor bullet above).

## Right-Docked Floating Panels

The three review-detail floaters (其他币 `OtherCoinChart`, 龙头 `LeaderCoinPanel`, 热度 `MarketHeatPanel`) share ONE stacking column, `.chart-float-stack`, rendered by `App.tsx` in the trade/bitget detail branch. Contract:

- The App renders the stack only when at least one panel is open, and always in the fixed order 其他币 → 龙头 → 热度; each panel keeps its own independent toggle state.
- `.chart-float-stack` is `position: absolute` (right/top docked), so it stays out of `.workspace`'s `grid-template-rows` — the chart and review panel keep their rows.
- It is `display: flex; flex-direction: column; align-items: flex-end` with a bounded `max-height`. Overflow is absorbed by **shrinkable children with their own internal scroll areas**, NOT by a container-level `overflow: auto` (a scroll container cannot be click-through).
- The container is `pointer-events: none` with `.chart-float-stack > * { pointer-events: auto }`, so the container's empty left strip does not block clicks on the chart behind it. jsdom does not simulate `pointer-events`, so verify this pass-through manually with `npm run dev`.
- Individual panels must NOT set their own `position/top/right/left/z-index`; they are `position: relative` flex children (`width: 100%` + `max-width` for the narrower leader/heat panels) so the dock position has a single owner.

## Embedded Scan Results vs Floating Panels

`HeatScanResults` (选品「热度」) reuses `MarketHeatView` inside the workspace, NOT as a floating panel. Two contracts keep the two surfaces from drifting:

- `MarketHeatView` takes `layout?: 'stack' | 'columns'` (default `'stack'`). `'stack'` is the floating review panel; `'columns'` wraps the 涨幅榜/跌幅榜 boards in `.market-heat-boards.columns` (two-column grid) for the wide embedded card. The board markup stays single-source.
- The embedded card (`<section className="market-heat-panel heat-scan-results">`) MUST reset every floating-positioning property it inherits from `.market-heat-panel`: `position: static; width: auto; max-width: none; max-height: none; align-self: stretch`. Missing `max-width`/`align-self` silently caps the card at the floating panel's `420px` and bottom-aligns it inside the `minmax(360px, 1fr)` grid row instead of filling it.

## Common Mistake: Extra top-level element steals the workspace grid row

**Symptom**: A results view shows a huge vertical gap where a one-line hint should be, or the main table is squeezed.

**Cause**: `.workspace` is `display: grid; grid-template-rows: auto minmax(360px, 1fr) auto`. A results component returns a Fragment, so every top-level element becomes a grid row. Adding a third element (e.g. a standalone skip-hint `<p>`) pushes the intended `1fr` content into row 3 (`auto`) and lets the hint take the `1fr` row.

**Fix**: Keep the results component's top-level element count stable (header + main region). Fold secondary lines such as 选品's 「已跳过 N 个休市标的」 hint into the `.detail-header` title column instead of rendering it as a sibling.

**Prevention**: When adding a top-level element to a Fragment rendered directly under `.workspace`, check how it maps onto the three grid rows.

## Styling And Accessibility

Use existing class names and extend `src/ui/styles.css`. Buttons that contain icons should use `lucide-react`, as shown by `Save`, `ChevronDown`, `ChevronUp`, `Minus`, `Slash`, and `Eraser`.

Inputs that do not have visible English text still need accessible labels. Existing examples include `aria-label` on review tag/note fields in `src/ui/ReviewEditor.tsx` and the Free Replay start input in `src/ui/FreeReplayPanel.tsx`.

## Common Mistakes

Do not put pure chart or queue math directly into JSX when it can be tested as a helper. Do not show trade entry or exit markers during Free Replay; `Free Replay Chart Context` in `CONTEXT.md` explicitly excludes them. Do not make Review Notes count as reviewed; Review Progress is driven by tags.

### Free Replay Paper Trading Orders

Free Replay paper trading state lives in `src/ui/free-replay-paper-trading.ts`; keep order execution rules there and cover them with unit tests before wiring UI controls in `App.tsx`.

Order execution contracts:

- Market open/close uses the current Free Replay cursor candlestick close.
- Entry and exit limit orders trigger only when a newly revealed candlestick contains the limit price: `low <= price <= high`.
- Stop-loss orders are valid only on the loss side of the open position: long stop loss below entry price, short stop loss above entry price.
- Stop-loss orders trigger on newly revealed candlesticks with direction-specific checks: long uses `low <= stopPrice`, short uses `high >= stopPrice`.
- If one newly revealed candlestick touches both an exit limit and a stop-loss price, execute the stop loss first because OHLC data does not contain the intrabar touch order.

Required tests when changing this area:

- Unit tests for the order state transition in `tests/free-replay-paper-trading.test.ts`.
- App-level tests in `tests/app-free-replay.test.tsx` for any visible control or workflow change.

When changing chart drawing overlays, remember that SVG background clicks and drawing shape clicks share the same overlay surface. Shape and handle click handlers must stop propagation when they represent selecting or dragging a drawing; overlay blank-click handlers can then safely clear `selectedDrawingId`. Add or update an app-level regression test that asserts both sides: clicking a drawing selects/keeps it selected, and clicking blank chart overlay clears selection.

### Drawing Magnet Snap (画线磁吸, 09/20)

画线端点可吸附到 K 线的 `open/high/low/close`。语义照搬 klinecharts 的 magnet（考证：`09-20-drawing-magnet-snap/research/klinecharts-magnet.md`）：

- 三态 `MagnetMode = 'off' | 'weak' | 'strong'`，**默认 `weak`**。工具栏按钮 `aria-label="磁吸模式"`、`aria-pressed` 表示是否非 off，点击按 `weak → strong → off` 循环（`nextMagnetMode`）。会话内 state，不持久化。
- 几何逻辑独占 `src/ui/drawing-snap.ts`：**纯函数、不 import `lightweight-charts`**，像素换算通过注入的 `priceToY` 传入，所以可以在 Node 环境直接测。
- 判定链：指针时间经 `containingCandleTimestamp` 归属到包含它的那根 K 线（**注意该函数毫秒进毫秒出，而画线点 `time` 是秒，必须 ×1000**）；价格在该柱四个 OHLC 里取**像素距离**最近的一个。`weak` 只在价格落在 `[low, high]` **外**时才要求距离 ≤ `DEFAULT_MAGNET_SENSITIVITY`（8px，klinecharts `modeSensitivity` 默认值）；落在区间**内无条件**吸。`strong` 无条件吸。`off`、时间归属失败、候选换算不全 → 一律返回输入原样（不得产出 `NaN`）。
- 接线口径：落点、草稿预览、端点拖拽（`'start'`/`'end'`）吸；`dragRef` 必须存**吸附前**的原始点，`'body'` 整体平移用原始点算增量 —— 增量被量化后整条线会按 K 线柱/OHLC 台阶跳。两个面板（`TradeChart` / `FreeReplayChart`）各有一份画线逻辑，都要接。
- **Free Replay 只能喂已揭示的 K 线**：`magnetCandles = visibleCandlesForFreeReplay(renderedCandles, replay.cursorTime)`。`renderedCandles` 含为下次揭示预取的未来柱，直接喂会让游标右侧留白处的画线吸到**未来价位**（信息泄漏）。`TradeChart` 则用 `renderedCandlesRef.current`（该图更新数据不触发重渲染，用 ref 才拿得到当前值）。
- 跨周期语义：吸附结果是**绝对价格 + 绝对时间**，只在落点/拖拽那一刻结算一次。画线仍按 instrument 共享（见下），切周期后照旧出现、价格不变，但**不重新对齐**当前周期的 OHLC（与 TradingView 一致）。不要把吸附目标（哪根柱、哪个字段）写进 `ChartPoint` 或服务端存储。

Required tests: 纯函数用例 `tests/drawing-snap.test.ts`（必须覆盖"区间内无条件吸"，这是最容易被实现成统一阈值而漏掉的分支）；app 级用例 `tests/app-drawing-snap.test.tsx`（落点吸附、三态循环、以及 Free Replay 未来柱不得被吸的回归）。

### Common Mistake: Cursor advance without viewport scroll

In `FreeReplayChart`, the render effect's `setVisibleRange` only runs on first initialization (guarded by `initializedRangeKeyRef`). After the user zooms or pans, subsequent cursor advances update data via `series.setData()` but leave the viewport unchanged. The cursor state advances correctly, but the user sees no visual change and thinks the button/keyboard doesn't work.

**Fix**: Add a separate `useEffect` watching `replay.cursorTime` that calls `setVisibleRange` on every cursor change (skip first mount). See the "Free Replay Cursor Follow" section above.

### Common Mistake: Preserving old time span across timeframe switches

Switching from a short Review Timeframe to a long one while reusing the old visible time span makes candles appear suddenly huge; switching back can make the chart look compressed or misplaced. Preserve visual candle density instead: carry forward the visible logical range span / visible candle count, map the anchor time to the destination series with `timeToIndex(..., true)`, call `setVisibleLogicalRange(...)`, and reset the price scale to autoscale so manual right-axis drags do not leak across timeframes. Do not rely on `barSpacing` alone as the primary signal; it can be less representative than the current logical range after chart initialization or library-internal scaling. Do not use `setVisibleRange(...)` as the primary timeframe-switch mechanism when the goal is preserving candle width; it preserves time ranges and can reintroduce timeframe-duration scaling.

### Common Mistake: Strict equality in timestamp matching

`shouldPrefetchFutureCandles` and similar helpers must use `>=` rather than `===` when matching `cursorTime * 1000` against candle timestamps. If the cursor timestamp has rounding deviation (e.g., from timeframe switch), strict equality silently returns `false` and future candle prefetch never triggers.
