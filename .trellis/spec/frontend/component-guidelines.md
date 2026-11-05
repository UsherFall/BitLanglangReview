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

- Trade marker points are drawn as canvas dots by `TradeMarkerPrimitive` (not `createSeriesMarkers`), because the built-in shapes cannot express "icon only, no label, with a hover card", and a DOM/SVG overlay was already rejected for making dragging stutter. Each point must be anchored to a **loaded** candlestick: `tradeChartPoints` resolves the action's time with `containingCandleTimestamp` and **drops** the point when no loaded candle contains it, and the primitive looks that candle up by the point's chart time (`candleByChartTime`). Never floor an out-of-range time onto the timeframe grid — the x coordinate would come from one candle and the price anchor from another, drawing the dot in mid-air (this shipped once and read as "the dot drifted off the entry"). Rounds whose later actions fall outside the 150-bar initial window are covered by `extendCandlesForLateActions`, which pulls one extra window and must swallow its own failure so the primary load still renders. Dots sharing one candle and side fan out by their **order in the point list** with a fixed pixel step — never by measured pixel distance, which changes with the zoom level and made dots visibly drift up and down while zooming. `updateAllViews()` must recompute the pixel layout (not just refresh the data) or the dots freeze in place while the candles scroll. For the same reason, do not feed marker times into `chartDataWithWhitespace`: a raw fill timestamp is not one of the candles' times, so it lands in the series as an extra slot between candles and displaces the later candle.
- **Free Replay paper-fill points use the SAME primitive pipeline (11/02)** — `paperTradeChartPoints` in `src/ui/free-replay-paper-trading.ts` maps each completed paper fill to `MarkerPoint[]` (open deduped per position round, close per fill, detail on the domain `TradePoint` shape so the shared hover card renders price/qty/time/leverage/pnl; `paperTooltipDataFor` passes `fee: null`/`source: ''` to omit those rows). Two rules are NOT negotiable:
  - **Anchor to the candle containing the fill instant (`eventTime - 1`), never the progress→cursor mapping.** A paper fill records its event as the candle's COMPLETION time. The old `freeReplayCursorTimeForProgress` mapping (`floor(floor(T, tf) - 1, tf)`) is only correct when the fill was made on the CURRENT chart timeframe; a fill made on a finer timeframe (user replayed 15m/5m mid-session, then viewed 1H) shifted the marker one whole coarse bar left, onto a candle whose price had nothing to do with the fill — this read as "wrong candles / misplaced points" on the 2023.3 BTC replay. `containing(T - 1)` is correct in every direction: same timeframe → the cursor candle; finer source on coarser view → the containing coarse candle; coarser source on finer view → the last fine bar inside the coarse candle (whose close IS the fill's own close time).
  - **The future stays hidden at the point-set level**: a fill whose containing candle is later than the reveal cursor yields no point. On a coarse chart, a fine-timeframe fill can sit inside a still-forming coarse candle — the point must wait until that candle is revealed (the 15m-switch regression test pins this).
  The「隐藏开平仓标记」eye button hides all but the FOCUSED order (`focusedPaperTradePoints`: the focus fill's own close + its round's open — the same semantics as 交割单复盘's default single-trade view); with no focus it hides everything. The App hands the chart TWO point sets (`paperPoints`, `focusPoints`); the chart never computes them.
- **`PaperRoundReviewEditor` (`src/ui/PaperRoundReviewEditor.tsx`, 11/04)** is the ONE annotation editor for paper rounds, rendered by both `FreeReplayPaperTradingPanel`'s 单子 rows and `FreeReplayPanel`'s 模拟单库 rows. It reuses the exported `TagsCombobox` from `ReviewEditor` (exported for exactly this reason — a look-alike picker would drift from the real one, and tag rename/delete must look identical in both modules) and posts to `/api/reviews` with `module: 'paper'`. Callers must not nest it inside a row BUTTON: the row body stays the 跳到开仓点 button, and the annotation strip (star / tags / 批注) is a sibling inside a `.paper-trade-row-wrap` / `.paper-round-row-wrap`.
- `FreeReplayPaperTradingPanel` is remounted per session (`key={`${instrument}:${startTime}`}`, 11/02): the orders/position lists are prop-driven, but panel-LOCAL state (active tab, direction, limit inputs, close ratio) must not leak across sessions — the 11/02 complaint "切换会话后单子 Tab 没跟着变" is the regression this pins.
- `OtherCoinChart` (其他币) marks the active trade's entry candle with a faint vertical reference line (`.other-coin-marker-overlay`, no label). It maps the entry event to a candle with `markerTimeForEvent(entryTime, timeframe, loadedCandles)` then to an x coordinate with `chart.timeScale().timeToCoordinate(...)`; the line only renders when that coordinate is non-null (entry candle loaded and on-scale). Because `autoSize` fires no logical-range event, the x must be recomputed on: initial load and `loadMore` (after `setVisibleRange`, in a `requestAnimationFrame`), the `subscribeVisibleLogicalRangeChange` handler (before the `suppressAutoLoadRef` early return, so programmatic range changes count), a `ResizeObserver` on the chart wrap, and a reset to `null` when `instrument`/`timeframe` change.

### Every screen reads its candles from its own venue (10/21 / 11/05)

#### 1. Scope / Trigger

Use this contract whenever adding or changing a chart source, a Free Replay Session source, or an Other Coin Panel.

`CandleSourceId` is `'okx' | 'binance' | 'bitget'`, and the venue decides the day boundary (`CandleGrid`): Binance opens a day at 00:00Z (`utc`), OKX and Bitget at 00:00 Beijing (`shanghai`). A request sent to one venue while flooring times on the other's grid lands between candlesticks, so **venue and grid always travel together**.

#### 2. Signatures

**One mapping owns venue / requestSource / grid (11/05).** `chartMarketContext(source: ChartCandleSource): ChartMarketContext` in `src/ui/chart-market-context.ts` is the ONLY source → (`venue`, `requestSource`, `grid`) table. `venue` is the instrument-list vocabulary; `requestSource` is the `/api/candles?source=` policy; `grid` is the candle day boundary. Never re-derive any of the three with a local ternary.

#### 3. Contracts

| source | venue | requestSource | grid |
| --- | --- | --- | --- |
| `binance` | `binance` | `binance` | `utc` |
| `binance-only` | `binance` | `binance-only` | `utc` |
| `okx` | `okx` | `okx` | `shanghai` |
| `bitget` | `bitget` | `bitget` | `shanghai` |

- **`binance` and `binance-only` are NOT interchangeable.** Same venue and grid, different request policies (candidate chain vs. strict Binance). Only a Session that recorded `binance-only` sends it; non-Replay `candleSource="binance"` callers keep the candidate chain, and `/api/free-replay/instruments` must always receive the `venue`, never `binance-only`.
- The 选品 scan's level drawer draws on a chart of the **same venue the scan used** (`App` owns `scanSource`; the panel reports its venue through `onSourceChange`). The line's price and the scan's candles then share one basis, and the cross-venue rescale stays a fallback.
- The Bitget-sourced review modes (回溯复盘, 个人交割单复盘) read Bitget candles. The Bitget positions' entry prices come from Bitget, so the candles must too.
- **A replay session records its own venue** (`free_replay_sessions.candle_source`, optional). A session recorded before the move has none and keeps replaying against Binance — the venue is a property of the SESSION, not a global setting, and a session the user already has progress in must not be moved under their feet.
- **`OtherCoinChart` reads the source it is TOLD, and the App must tell it the active Session's source (11/05).** The replay's 其他币 panel used to call `replayCandleSource(null)` and silently fall back to the default Bitget, so an OKX or legacy-Binance session rendered two different venues' prices and day grids on one screen. `App` now passes `candleSource={replayCandleSource(freeReplay)}`; the panel only defaults on its own for standalone usage (replay → current default source, non-Replay → OKX). It derives venue/requestSource/grid exclusively from `chartMarketContext`.
- **The panel's data identity is `requestSource`, not `venue`.** Its initial-load `anchorKey` starts with `requestSource` (11/05): `binance` and `binance-only` share the Binance venue but are different `/api/candles` policies, so a policy change under the same instrument/timeframe must discard the loaded window. `venue` remains only the Instrument List vocabulary.

#### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Session has no source (legacy) | Restore as `binance-only` + `utc`; never switch it to the current default. |
| Panel source is `binance-only` | Candle requests keep `binance-only`; Instrument List uses `binance`. |
| Same venue but requestSource changes | Start a new initial Candlestick window; do not refetch the unchanged Instrument List. |
| Standalone panel has no source | Replay → current default source; non-Replay → OKX. App's active Replay must pass the Session source explicitly. |
| Source outside `ChartCandleSource` | Type error and an incomplete exhaustive mapping; do not invent a runtime venue fallback. |

#### 5. Good / Base / Bad Cases

- **Good:** an OKX Session's main chart and Other Coin Panel both request `source=okx` and use `shanghai`.
- **Base:** the current default Replay is Bitget + `shanghai`; standalone Trade Review defaults to OKX.
- **Bad:** calling `replayCandleSource(null)` for an active Session or keying candles only by `venue`, allowing default-Bitget data or the previous Binance policy to survive.

#### 6. Tests Required

- `tests/chart-market-context.test.ts`: the complete four-source matrix and the `binance` / `binance-only` non-collapse assertion.
- `tests/app-free-replay.test.tsx`: restored OKX / Bitget / explicit and implicit legacy Sessions, checking main/panel requests and panel Instrument List sources separately.
- `tests/other-coin-chart.test.tsx`: independent literal UTC 1D Review Window assertions, plus a `binance` → `binance-only` rerender proving a second initial Candlestick load and no Instrument List reload.
- Run focused chart tests, full `npm test`, `npx tsc --noEmit`, and `git diff --check`. On CRLF checkouts, configure Git to recognize `cr-at-eol` rather than normalizing whole files or skipping the check.

#### 7. Wrong vs Correct

**Wrong** — guesses a Session and keys only by venue:

```tsx
const venue = replayCandleSource(null);
const anchorKey = `${venue}:${instrument}:${timeframe}`;
```

**Correct** — App supplies the Session source and the data identity includes its request policy:

```tsx
<OtherCoinChart candleSource={replayCandleSource(freeReplay)} {...props} />
const anchorKey = `${requestSource}:${instrument}:${timeframe}`;
```

### Free Replay's candle source is USER-selectable (11/02)

- The start panel offers the same three sources as 选品 (币安/OKX/Bitget, default Bitget); the selected source is recorded into the new session's `candleSource` in the ROUTE vocabulary (`binance-only` = the strict no-fallback Binance Free Replay has always used; `okx`; `bitget`). The instrument list follows the source (`/api/free-replay/instruments?source=…` — each venue has its own symbol vocabulary).
- The source is chosen ONCE at session creation (11/03: the in-session header select was removed — the two pickers read as one duplicated control). An active session keeps its recorded source for its whole life; replaying another venue means starting a new session. The "never move a session's venue silently" contract now holds structurally, not just by convention.
- The session's `instrument` keeps its creation-time vocabulary (the `(instrument, startTime)` session key must stay stable); every candle request translates instead via `replayRequestInstrument(instrument, routeSource)` (`usdtSymbolToOkxInstrument` / `okxInstrumentToBitgetSymbol`). A venue that does not know the translated instrument answers an empty window — a visible failure, never a silent venue switch.
- `replayCandleGrid` delegates to the SAME `chartMarketContext` mapping, and `FREE_REPLAY_*` / `LEGACY_REPLAY_*` grid constants are derived from it — the Session grid and the panel grid cannot drift. The grid follows the source's VALUE (`binance-only`/absent → `utc`, `okx`/`bitget` → `shanghai`), never the field's PRESENCE: restore rewrites `null` to `binance-only`, and a presence-based mapping anchored restored legacy sessions to the wrong day boundary.
- The auto-save PUT payload MUST carry `candleSource` (11/02 fix): the payload used to drop it, so a post-10/21 Bitget session lost its venue on the first save and restored as `binance-only`.
- The chart's `rangeKey` includes `candleSource` — a different source is a new data view, and all per-rangeKey dedupe (initialization, cursor-follow, backfill) restarts. The request source and day grid come from `chartMarketContext(replayCandleSource(replay))`; effects depend on the primitive Session keys / `rangeKey`, never on that freshly derived object.

### Middle-gap healing (11/02)

Historical paging and focus-window merges can leave a gap INSIDE the loaded candle array. The `earlier` loader only fires at the viewport's left edge and `later` only at the right edge/cursor+20, so a middle gap was never fetched by anything — it read as "一段 K 线空缺", and the reveal cursor JUMPED the gap (skipping candles). FreeReplayChart now detects the first in-range gap (`firstGapInRange`, same 1.5×step rule as `contiguousCandles`) over「visible range ∪ cursor+20 bars」and heals it with ONE `mode=initial` window centered on the gap (the exchange serves contiguous windows). `tools/backfill-candles.ts` is the one-time repair for existing cache holes (bounded at 20k bars per gap; wider spans are never-loaded history and stay to on-demand loading).

### The drawing layer lives in `src/ui/chart-drawing.tsx` (10/21)

The tool row, the SVG overlay, the drag handling, the magnet and the persistence of a chart's levels are one reusable HOOK: `useChartDrawings({ instrument, board, timeframe, tradeId, chartApiRef, seriesRef, candles, snapCandles?, enabled?, toolbarExtra? })`. It returns `{ drawingTool, selectDrawingTool, drawings, selectedDrawingId, setSelectedDrawingId, toolbar, overlay, overlayRef, overlayVersion, bumpOverlay, magnetMode, setMagnetMode }`.

- **Why a hook and not a component**: the chart owns `chartApiRef` / `seriesRef` / its candles; the hook only owns the drawings. The chart renders `{drawings.toolbar}` and `{drawings.overlay}` where its own `<svg>` used to live, and calls `drawings.bumpOverlay()` when the viewport moves (the shapes are positioned in pixels).
- **Three consumers**: `TradeChart` (review), `FreeReplayChart` (replay) and `OtherCoinChart` (the 选品 level drawer, via `drawable`). The first two were duplicates of the same code inside `App.tsx`; the third had NO way to draw at all, which is what the user reported ("画线点开后里面并没有画线功能"). `OtherCoinChart` is read-only by default (`enabled: false`) so the trade review's comparison panel does not grow a second set of levels.
- **`board` is required and stamped by the CHART (10/26)**: the 选品 level drawer passes `'scan'` (its lines feed the 距线 scan); `TradeChart` and `FreeReplayChart` pass `'review'`. The hook refuses to guess which workflow it sits in. `OtherCoinChart` takes a `board?` prop (default `'review'`); the drawer sets `board="scan"`.
- **`candles` may be an array or a ref.** The trade-review chart keeps its rendered candles in a ref (it re-renders for other reasons); reading the ref lazily keeps the drawing layer from forcing a re-render on every candle update. `snapCandles` is for the magnet when it must differ from the geometry candles — Free Replay snaps to the REVEALED candles only, or a point drawn in the blank right padding would snap to a future candle's OHLC and leak its levels.
- **The unit trap.** A drawing's points carry **seconds**; a candlestick's `timestamp` is **milliseconds**. The domain layer converts exactly once (`pointTimeMs` in `src/domain/level-alert.ts`); `LevelLine`'s endpoints are `{ ms, price }` so the unit is fixed in the type. Never compare a point's `time` with a candle's `timestamp` directly.
- **A new level records its price basis.** The hook writes the last completed bar's close and timestamp into `refPrice` / `refTime` — the 选品 scan measures the level on ANOTHER venue's candles and rescales it with that reference (see `server/coin-scan.md`).
- Levels are **stamped** with the timeframe they were drawn on, but VISIBILITY is instrument-level WITHIN THE BOARD (10/22 regression fix restored the cross-timeframe rule; 10/26 added the board scope): `GET /api/drawings?instrument=…&board=…` — no `timeframe` filter, ALWAYS a `board` filter — so a level drawn on one timeframe shows on every timeframe of the same instrument **on that board**, and never leaks into the other board. The 10/26 split: before it, the scan's canonical matching measured REVIEW lines too, so the 距线 column showed numbers whose lines were invisible in the drawer (they lived on the review charts under OKX names) and read as algorithm-made. The `timeframe` field is the 距线 scan's MEASUREMENT granularity (`listDrawingsByTimeframe(timeframe, board)`, "only the timeframes the user drew on are measured, and only the scan board's"), not a visibility rule — keep the two concerns separate. The optional `timeframe` query param stays for targeted queries. Within a board the instrument match is CANONICAL (`canonicalInstrument`), so a scan-source switch (Bitget ↔ Binance, or OKX-era drawer lines) does not hide the coin's lines.
- **Out-of-range anchors must EXTRAPOLATE, not hide (10/28).** Cross-timeframe visibility also breaks at RENDER time: `timeScale().timeToCoordinate(t)` returns null for any time that is not in the loaded data's index, and a small timeframe's initial window (±150 bars around the anchor) usually does not cover a big timeframe's anchors — a 4H ray switched to 5m vanished even though it was loaded. The x for such a time comes from `coordinateForTime(time, { chart, timeframe, candles })` in `chart-drawing.tsx`: direct index hit → `timeToCoordinate`; outside the loaded window → boundary candle ± grid slots (`deltaTime / timeframeMs(timeframe)`) × `barSpacing`; inside a data gap → neighbor interpolation. `pointToScreen` must go through it — never bare `timeToCoordinate` — and horizontal lines never need it (price-only, `priceToCoordinate` works for any price). Panning left until the history backfill covers the anchor returns the coordinate to the exact direct path.
- **One shot per tool activation (10/28).** Completing a drawing saves AND exits the tool (`setDrawingTool(null)` right after `saveDrawing`): one click for `horizontal`, the second click for `ray`. The user asked for no extra "click the toolbar again to close" step. The saved line itself stays selected (handles ready). Draft-discard on tool switch (`selectDrawingTool`) is unchanged and still required.

### Free Replay Cursor Follow

The viewport must keep the reveal cursor VISIBLE — and do nothing else. 10/28: the follow used to re-anchor on EVERY cursor change, which yanked a viewport the user had panned or zoomed (点下一根/上一根时画面被来回拉). Now stepping next/previous while the cursor stays inside a comfort zone — at least 10 steps from EITHER edge — leaves the viewport (position AND zoom) untouched; crossing the zone scrolls by the minimum amount, preserving the zoom (`span = visible.to - visible.from`):

```typescript
const step = timeframeMs(timeframe) / 1000;
const pad = step * 10;
if (cursor + pad <= visible.to && cursor - pad >= visible.from) return; // comfort zone — no scroll
const followsForward = cursor + pad > visible.to;
chart.timeScale().setVisibleRange(
  followsForward
    ? { from: cursor - span + pad, to: cursor + pad }   // old invariant: cursor 10 steps from the right edge
    : { from: cursor - pad, to: cursor - pad + span },  // mirror on the left edge (rewind)
);
```

`series.setData` itself never moves this viewport: `chartDataWithWhitespace` pads a CONSTANT 200 bars at both ends, so the time scale's base index is stable between steps — the follow effect is the only code that scrolls on a step. Set `suppressAutoLoadRef.current = true` before `setVisibleRange` and reset it via `setTimeout(0)` to prevent the `visibleLogicalRangeChange` handler from firing during the range update. Use a range-key guard (`instrument:startTime:timeframe`) to skip the first cursor-follow pass for each newly initialized chart range; otherwise a timeframe switch can reuse the previous timeframe's visible span and overwrite the fresh initialization.

When switching Review Timeframes, preserve candle visual density rather than preserving the old time span. Prefer `chart.timeScale().getVisibleLogicalRange()` to derive the actual visible candle count; fall back to `chart.timeScale().options().barSpacing` and chart width only when logical range is unavailable. After the new timeframe data is rendered, use `timeToIndex(..., true)` for the anchor and `setVisibleLogicalRange(...)` for the destination viewport. Free Replay anchors this logical range on `replay.cursorTime` with about 10 future bars of right padding; Trade Review anchors it on the previous visible center time.

After a Free Replay timeframe switch, the preserved visible candle count can be wider than the fixed initial history load. Keep a switch-scoped backfill target for the captured visible candle count and evaluate it only after `loadedCandles` belongs to the destination timeframe. If `visibleCandlesForFreeReplay(loadedCandles, replay.cursorTime).length < visibleBars - rightPaddingBars`, call the existing earlier-candlestick loader until enough unique historical candles are loaded or the API returns no new data. Do not reveal future candles to fill blank space. Add both a pure helper test for the backfill decision and an App-level regression test that switches timeframe after a zoomed-out viewport and observes a `/api/candles?...mode=earlier` request.

Free Replay must keep `progressTime` separate from `cursorTime`. Switching Review Timeframes preserves `progressTime` and recomputes the derived cursor; it must not floor and store the old cursor as the new true progress. For example, `progressTime = 10:35` maps to `10:30` on `5m` and `04:00` on `4H` so the unfinished `08:00-12:00` candle is not shown.

## Instrument Scan Panel

`CoinScanPanel.tsx` owns the 选品 scan UI (parameter area + results table). Contract:

- The parameter area is a 品种 toggle (加密/股票) + a 行情源 toggle (币安/OKX/Bitget, 10/12) + 方法 select (收敛结构/热度; 热度 is offered only in the crypto scope) + the shrink params as number inputs — `扫描数量` (`topN`), `最低成交额` (`minQuoteVolume24h`), `结构强度阈值` (`minScore`, 0..1 step 0.05, **default 0.6**) — plus an optional `datetime-local` 扫描时间点 that sends `anchor` (epoch ms) or omits it to scan "now". `扫描数量` is an **upper cap** since 10/13 (上限保护, placeholder 全池): **empty = no cap = the whole scope universe**, and an empty box sends NO `topN` parameter at all. It is therefore NOT validated as non-empty; a filled value must be a finite number `>= 1` (a `0` cap would silently scan nothing). The other two number inputs are validated as non-empty finite before scanning. The source toggle seeds from `GET /api/scan/config` (the server's startup source; a failed fetch keeps the shared default) and sends `source` on every scan; switching source OR scope resets `topN`/`minQuoteVolume24h` to `defaultScanParams(source, scope)` (`src/domain/scan-scope.ts` — the floor is per source × scope, see `server/coin-scan.md`) and drops 热度 when moving to equities. There is no `时间周期` selector — one click scans all 5 timeframes. The minScore field is the SINGLE strength knob; its per-timeframe offsets (4H/1D are more lenient) are internal, not extra inputs.
- The results table renders one row per `ScanRow`. Columns are 币 | 最新价 | 24h 涨跌 | 成交额 | 结构 | 收敛结构 | 强度分 | 操作, where 结构 = the row's 1D coarse-screen measures (`${windowDays}天 区间x% 净y% 位z%` from `row.coarse`, with the two pool-relative cuts AND the absolute position floor (`COARSE_POS_RANGE_FLOOR`, 10/13) in the cell's `title`; `—` for a pre-10/13 payload), 收敛结构 = each `row.convergedTimeframes` entry with its structure label (e.g. `1D收敛`), and 强度分 = `row.bestScore`. 位 is the row's position inside its whole 1D series (0% = hugging the absolute bottom, which the screen no longer admits) — it is displayed because the user's manual 判读 cares about WHERE in the box a coin sits, not because the UI judges it. Rows are the coarse-screen survivors, so 收敛结构 can legitimately be empty (a survivor that converges nowhere); the header line reports 粗筛 N 个 · 候选 M 个 · 收敛 K 个 · 日线窗口 T 天 instead of the old 扫描/收敛 pair (which had become the same number). A 「详情」 button toggles an expandable row (`.coin-scan-detail-row`, `colSpan` 8) containing a sub-table over `row.structures` with columns 周期 | 结构类型 | 位置 | 强度分 | 触碰次数 | 状态; non-qualified timeframes are dimmed (`:not(.qualified)`). The service sorts rows (highest converged level desc → `qualifiedCount` desc → `bestScore` desc; a survivor with no convergence reads as level −1 and sinks); the UI renders them as-is. Qualified rows get the `.qualified` class.
- Styles reuse the `.coin-scan-*` naming and color palette in `src/ui/styles.css` (`.coin-scan-coarse` is the dimmed style of the 结构 cell).
- 结果表支持**手动降权**:每行一个 toggle 按钮(`aria-pressed` 反映状态)。被降权的标的 —— 用户人工判断其日线结构不适合做多 —— 在表内**沉底 + 灰化**(`.demoted`),**不做自动判定**(口径由人看)。排序由纯函数 `orderScanRows`(`src/ui/coin-scan-rows.ts`)完成:它是**稳定分组**而非重新排序,服务端顺序在每个分组内部原样保留,且表头 `扫描/收敛` 计数不因降权变化。标记存 `localStorage`(key `scan-demoted`,读取走 `loadStoredStringList`),与龙头币标记(`leader-coins`)是两套独立的值,互不写入。
- **列表只显示 20 行**(10/21):粗筛故意放行 ≈44% 的池子(一次实扫 151 行),所以截断放在**展示层**(`COLLAPSED_ROW_COUNT = 20`),粗筛分位阈值一律不动 —— 实测收紧到 20 的条件都会砍掉用户已认可的标的(见 `server/coin-scan.md`)。服务端仍返回全部行。降权沉底**先于**截断(被降权的币不占前 20 的名额)。表头报「粗筛 N 个 · 显示 20 个」,并给出「显示更多 / 收起」。
- **口径说明常驻表头**(10/21):「日线窗口 23 天」下面写明粗筛用**最近 23 根日线**算区间振幅与净漂移(盘得够久 / 收住了 / 不在趋势中),而「位」算的是该币在**全部历史**里的位置。说明行用 `.coin-scan-note`(.coin-scan-skip-hint 是本次扫描的异常清单,两者语义不同,不要混用同一个 class)。

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

Use existing class names and extend `src/ui/styles.css`. Buttons that contain icons should use `lucide-react`, as shown by `Save`, `ChevronDown`, `ChevronUp`, `Minus`, `MoveUpRight`, and `Eraser`.

**Top overlay panels anchor RIGHT, never to a fixed toolbar width (11/03).** `.hover-price-percentage` (回溯复盘 hover 百分比) and `.candlestick-readout` (交割单复盘 OHLC) both used to hard-code `left: 252px` — the width the drawing toolbar had at the time. The toolbar since grew to ~270px (回溯, 7 buttons) / ~332px (复盘, 9 buttons), and the panels sat ON TOP of its tail buttons (readout paints later in DOM). Right-align (`right: 10px`) is immune to toolbar width changes; `pointer-events: none` + the translucent panel language stay. Any new top-of-chart readout follows the same rule.

Inputs that do not have visible English text still need accessible labels. Existing examples include `aria-label` on review tag/note fields in `src/ui/ReviewEditor.tsx` and the Free Replay start input in `src/ui/FreeReplayPanel.tsx`.

## Common Mistakes

Do not put pure chart or queue math directly into JSX when it can be tested as a helper. Do not show historical TRADE entry/exit markers during Free Replay (`Free Replay Chart Context` in `CONTEXT.md` excludes them) — the paper-trading fills the reviewer makes during the replay are the exception and render through `paperTradeChartPoints` (see the marker pipeline contract above). Do not make Review Notes count as reviewed; Review Progress is driven by tags.

### Free Replay Paper Trading Orders

Free Replay paper trading state lives in `src/ui/free-replay-paper-trading.ts`; keep order execution rules there and cover them with unit tests before wiring UI controls in `App.tsx`.

- **Rewind locks once paper trading starts (11/03)**: `paperTrading.active === true` makes rewinding (按钮 + 键盘 ←) a no-op — pulling the cursor back before already-filled orders corrupts the fill timeline with no warning. The guard lives at the FUNCTION entry (`rewindFreeReplayCandle` early-returns), the button greys out via `FreeReplayPanel`'s `canRewind` prop (`!paperTrading.active`, with an explanatory `title`), and the keyboard effect's deps MUST include `paperTrading.active` — its closure goes stale otherwise and re-enables the key after the subscription (same class as the reveal-boundary mirror).「下一根」stays enabled; 重置 re-enables rewind.

Order execution contracts:

- **Available margin is EQUITY-based (compounding, 11/02)**: `availableMargin = 1000 + realized PnL − used margin`. Realized profit rolls into the next open's sizing, realized loss shrinks it; `100%` position = the whole CURRENT equity, not the fixed 1000 base. Floating PnL of an open position does NOT count (unrealized); closing applies immediately. Existing sessions compound retroactively — realized PnL lives in `session.trades`, no migration. The panel header shows 本金 + 当前权益.
- Market open/close uses the current Free Replay cursor candlestick close.
- Entry and exit limit orders trigger only when a newly revealed candlestick contains the limit price: `low <= price <= high`.
- Stop-loss orders are valid only on the loss side of the open position: long stop loss below entry price, short stop loss above entry price.
- Stop-loss orders trigger on newly revealed candlesticks with direction-specific checks: long uses `low <= stopPrice`, short uses `high >= stopPrice`.
- If one newly revealed candlestick touches both an exit limit and a stop-loss price, execute the stop loss first because OHLC data does not contain the intrabar touch order.

Required tests when changing this area:

- Unit tests for the order state transition in `tests/free-replay-paper-trading.test.ts`.
- App-level tests in `tests/app-free-replay.test.tsx` for any visible control or workflow change.

### Free Replay Order Focus Anchor (焦点单锚定, 10/29)

The paper trading panel is split into two tabs — 操作 (parameters and open/add/close/stop-loss controls) and 单子 (open position, pending orders, completed trades) — under a always-visible header + stats row. `.paper-trading-panel` is a flex column with `overflow: hidden`; `.paper-tab-body` is the ONLY scroll region (small screens land the panel under the chart at `max-height: 32vh`, so the 单子 tab must reach orders without scrolling past the operation sections).

Clicking a completed trade row anchors the chart viewport on that position round's open (`positionOpenTime`, the same anchor as the「开」marker), using the SAME `entryVisibleRange` ±150-bar window as 交割单复盘 trade selection:

- The focus lives in `App` as `orderFocus: { id, timeMs, token } | null` and reaches `FreeReplayChart` as the `focusRequest` prop. The token increments per click so re-clicking the same row re-anchors after the user panned away.
- The chart applies a focus ONCE per `rangeKey:token` — afterwards the user pans/zooms freely. **11/04: a timeframe switch CLEARS the focus** (`switchFreeReplayTimeframe` calls `setOrderFocus(null)`; before 11/04 the focus survived and re-anchored on the new period). The replay mode's default view contract is 「光标右缘」: keeping the focus would leave a row highlighted while the viewport sits elsewhere, and 看单子跳开仓点 is the 交割单复盘 language, not the replay one. Re-reading an order is one more row click (token increments → re-anchor). While a focus is active the render effect's initial cursor anchor stays skipped (10/29).
- **首锚只认本 rangeKey 的数据（11/04）**：the render effect's first-anchor guard is `visibleCandles.length && initializedRangeKeyRef.current !== rangeKey && renderedRangeKeyRef.current === rangeKey`. `renderedRangeKeyRef` is stamped in `publishActive(..., { render: true })` (the only entry that hands fetched data to rendering). Rationale: `renderedCandles` is NOT cleared on a rangeKey change (clearing it would flash a blank chart while loading), so the first commit after a timeframe/session switch still renders the OLD period's candles — anchoring then consumes the first anchor with the wrong period's `timeToIndex` index (5m→1h is a 12× offset, worse the more history was paged). The new data's landing commit anchors instead. `render: 'defer'` (deferred append render) does not restamp — same rangeKey data growth.
- **游标数据集带 rangeKey 标记（11/04）**：`cursorCandlesRangeKeyRef` is stamped wherever `cursorCandlesRef` is written (initial load = fetch rangeKey, `installIntoDataset('cursor')` = current rangeKey, focus entry backup = current rangeKey). Leaving the focus publishes the backed-up cursor dataset only when that stamp equals the current rangeKey; otherwise it re-loads the cursor window (deduped by `cursorInitialKeyRef`). A same-timeframe different-session dataset would otherwise be published under the new rangeKey, restamping `renderedRangeKeyRef` with stale data and anchoring the first view on it.
- **整窗替换 / 双数据集（10-30，对齐交割单复盘语义）**：点单取 ONE `mode=initial` window centered on the open point（`entryTime` = open-point ISO）并【替换】活动数据集，**永不与游标窗口 merge**。`FreeReplayChart` 持有两份数据集：`cursorCandlesRef`（游标窗口，锚在 cursorTime）与 `focusCandlesRef`（焦点窗口），`activeCandlesRef` 指向当前活动的那份；任何一份内部都连续。不变式：
  - **同一渲染数据里永远只有一个连续窗口** —— 索引型时间轴不为缺失时间留空白，把两段不相邻数据拼进同一数组就会把缝两侧画成相邻（用户现场 11/03：15m 下 9-7 → 9-30 直接跨越，洞内成交经 `containingCandleTimestamp` 全锚到缝左缘那根，开平仓点挤成一团）。
  - **`onCandlesLoaded`（App 的 `freeReplayCandles`）只喂游标数据集**（R2）：它服务 `currentCursorCandle`/浮盈/开平仓可用性；焦点取窗与焦点态翻页一律 `publishToApp: false`。
  - **开平仓点锚定走活动数据集**：图表另经 `onActiveCandlesLoaded`（renderedCandles 驱动）把活动数据集喂给 App 的 `freeReplayActiveCandles`，`paperTradeChartPoints` 用它锚定 —— 焦点态下焦点单的开仓点在游标窗口之外，点集锚游标数据集会让最老的单子丢开/平仓点（11/03 回归）。统计/步进/浮盈与标记各吃一份，互不串。
  - 焦点取窗【一律重取】，不再判断「开仓点是否已在已加载窗口内」——活动数据集恒定为一个连续窗口，不依赖游标窗口边界。取窗失败/空：贴游标数据集最早边缘，不循环重试。NEVER page-chase with `mode=earlier` — a real session's open can sit weeks before the cursor and paging serially reads as "点单子不行了". The focus-window fetch, like the earlier/later loaders and the future prefetch, must send `market.requestSource` (`chartMarketContext(replayCandleSource(replay))`) — a legacy session (`candleSource: null`) stays on `binance-only`; hardcoding the current default mixes venues' prices on one chart.
  - **过期响应丢弃**：异步取数落地时比对 `rangeKeyRef.current`，切周期/会话后的迟到响应直接丢弃（焦点取窗与游标初始加载同一守卫）；游标初始加载另有 `cursorInitialKeyRef` 同键在飞去重。
  - **历史回填与中段洞自愈在焦点态不追错目标**：回填在焦点态跳过（它追游标）；洞自愈与回填都有「活动数据集 timeframe 必须等于当前 timeframe」的过渡闸 —— 切周期的过渡 commit 里跨周期间距会被误判成洞。
  - **焦点态翻页（R4）**：向左 = 从焦点窗口左缘 `mode=earlier` 续取；向右 = 视口右缘贴近焦点窗口右缘（`shouldLoadLaterByLogicalRange`）时 `mode=later` 续取。两者只写焦点数据集。游标预取（`shouldPrefetchFutureCandles`）在焦点态跳过 —— 它追游标，会把焦点窗口逐页拽向游标。
  - **揭示边界闸（11/03，乱飘/请求风暴修复）**：焦点窗口右缘已触及/越过 cursorTime 时，右缘翻页必须停发（`shouldLoadLaterFocusCandles`，严格小于）：追加的蜡烛全是未揭示未来，`visibleCandlesForFreeReplay` 全部过滤 → 渲染数组永不增长 → `barsAfter` 恒 < 阈值 → 每个拖动帧都再发一次 `mode=later`（请求风暴）。揭示边界本来就是回放的右墙；游标步进前进后右缘落后于游标时闸自动重新放行。闸读 `cursorTimeRef` 镜像，不读闭包里的 `replay.cursorTime`（自动加载 handler 的订阅 effect deps 不含 cursorTime，闭包值会陈旧）。
  - **右端追加不移动视口（11/03，边界见 11/04）**：`FreeReplayChart` 的 `createChart` 必须带 `timeScale.shiftVisibleRangeOnNewBar: false`。LWC 默认的 shift-on-new-bar（给实时行情设计）在「旧最后一根可见」时对新加在数据右端的蜡烛不做视口补偿，视口前移整页。关掉后一切右端追加（焦点翻页/中段洞自愈）都走 LWC 的补偿分支（视口时间范围保持不变）；揭示步进跟随不变 —— 舒适区 effect 在跟随方向每步都重锚 +1 根，行为逐帧等价（10/28 契约）。前插（earlier 翻页）本就由 baseIndex+rightOffset 语义天然保视口。**这条不变式只覆盖「指针未按下」的落地** —— 拖动进行中追加见下一条。
  - **追加型 setData 不得在拖动进行中发生（11/04，LWC 拖动快照缺陷）**：LWC 5.2.0 在 `_internal_startScroll` 时给 `rightOffset` 拍快照（`commonTransitionStartState`），每个拖动 move 都从**快照**重导出 rightOffset；`_internal_updateTimeScale` 对右端追加的补偿 `setRightOffset(-Δ)` 不更新快照 —— 于是拖动进行中 `setData` 追加一页，下一次 mousemove 就把补偿撤销，视口向前甩整页（实证 +151.8 根 / 150 根页；`research/findings.md`）。契约：
    - 指针按住期间（`pointerDownRef`，`.chart-wrap` onPointerDown 置位、window 级 pointerup/pointercancel/blur 清除）`FreeReplayChart` 不得对追加型数据集变化调用 `series.setData`。
    - 追加型 = **焦点右缘翻页**（`loadLaterActiveCandles`）与 **中段洞自愈**（`loadWindowCandles`）：两处都传 `installIntoDataset(..., { render: 'defer' })`。推迟发生在渲染层 —— 数据层（属主 ref、`activeCandlesRef`、loaded 状态、翻页闸、游标 App 供给）永远立即，翻页闸/去重语义不变（连续拖仍可继续预载下一页，无请求风暴）。
    - 推迟的渲染在 pointerup 后由 `flushPendingInstallRender()`（`setTimeout(0)` 错开 LWC 同 tick 的 `endScroll`）一次性 flush：连续拖多页只渲染最终合并结果，一次补偿生效、无中间跳动。`window blur` 与卸载清理 pending，防止浏览器打断后永久滞后。
    - **前插（earlier 翻页）不受影响**：走 `isLeftBarShiftToLeft` 分支不动 rightOffset，快照与 live 一致（实证安全）。**释放后的追加也不受影响**（11/03 语义，S1 实证）。不引入 anchor 恢复 —— 释放后 LWC 补偿已保视口。
- **开仓点前视图（11/03）**：焦点单存在时工具栏出现剪刀按钮（无焦点不渲染），开启后揭示边界【临时换轨】到开仓点 —— 复盘入场决策的无未来视图。两条边界、两个不变式：
  - **渲染/磁吸边界 = 严格小于 `positionOpenTime`**（`Math.floor((cutoffMs-1)/1000)`，取整秒防浮点噪声）：同周期成交时开仓 candle 完成于 `positionOpenTime`，其下一根恰从该时刻开档、整根是未来 —— `<= cutoff` 会泄漏这一根；粗周期视图下包含 candle 开档时间恒 < `positionOpenTime`，「开仓点及之前」跨周期成立。开平仓点零新代码：post-cutoff 点的包含 candle 不在 series 数据里，`timeToCoordinate` null → primitive 自动不画。
  - **右缘翻页闸边界 = 渲染边界早一个 step**：焦点窗口/数据集最后一根已到开仓 candle 时右缘翻页必停 —— 更晚的蜡烛全被隐藏，渲染数组永不增长，重演 11/03 请求风暴。游标态两边界在网格上等价（闸语义不变）。闸读镜像 ref（订阅 effect 闭包陈旧问题与 cursorTimeRef 同款）。
  - 状态是图表本地 ephemeral（不进会话保存）：退出焦点（步进/开平仓/点持仓行/切会话/离开模式）**或换焦点单（11/04）**都即复位关闭 —— 剪刀是单笔单子的审读工具，非跨单粘性模式（用户报障「点亮剪刀切单，新单也被隐藏」，反转了 11/03 的「连续审单」决策）；同单重复点击（token 递增重定位）不清；残留 true 无害（`focusRequest` 为 null 时 cutoff 派生即 null）。开启瞬间把开仓 candle 锚到右缘右畱 10 根（声明在渲染 effect 后：同 commit 先 setData 再锚定）；关闭不移动视口。
- Return-to-cursor (10/30)：a market/limit open or close submission or clicking the open-position row clears the focus AND jumps the viewport back to the cursor (the same `anchorViewportToCursor` as initialization, 10 right-padding bars). Each cursor-return token is consumed ONCE — a later rangeKey change must not re-consume it (11/04: a timeframe switch already cleared the focus, so a re-consumed token would fight the new period's first anchor). Stepping does NOT jump: the 10/28 comfort-zone contract still governs steps. The focus is ephemeral UI state — it is NOT part of the session save payload.
  - **回光标锚定的时序守卫（10-30）**：退出焦点恢复游标数据集是异步的（退出 effect → `publishActive` → 渲染 effect 重挂 series 跨越多个 commit），回光标 effect 必须等 `candlestickAtTime(renderedCandles, cursorTime)` 成立再锚（守卫不过不消费令牌，`renderedCandles` 依赖驱动下一次 commit 重试）——否则拿焦点窗口的 `timeToIndex` 锚到错误的逻辑索引。
- The focus is cleared on: step next/previous (buttons and ArrowLeft/Right — no forced jump, the step's own comfort-zone follow governs the viewport), **a timeframe switch (11/04 — the viewport then returns to the cursor right edge)**, switching/restoring/deleting the session, and leaving Free Replay mode (open/close submissions and the position-row click clear it via the return-to-cursor jump above). The focus is ephemeral UI state — it is NOT part of the session save payload.

Required tests (`tests/app-free-replay.test.tsx`)：`renders one contiguous window after focusing a distant order, never a stitched seam`（相邻两根时间差恒等于一个 step —— 核心回归）、`keeps market-open available while an order is focused`（R2）、`restores the cursor window with cursor candles on screen after stepping out of focus`（R3 回光标）、`clears order focus and anchors to cursor on timeframe switch`（11/04 切周期清焦点回右缘）、`waits for the new timeframe data before anchoring the viewport`（11/04 首锚时机：旧周期数据帧不锚，新数据落地才锚）、`clears the focused order on a timeframe switch and returns to the cursor window`（11/04 焦点不跨周期：不取开仓窗、渲染数据仍是单一游标窗口）、`disables shiftVisibleRangeOnNewBar on the Free Replay chart`（右端追加不移动视口）、`defers the focused later page render while the pointer is down, then flushes on release` + `renders the focused later page immediately when the pointer is not down` + `defers the gap-heal window render while the pointer is down, then flushes on release`（11/04 拖动中追加型渲染推迟：推迟/flush/非拖动对照，含推迟期间闸读数据层可继续翻页）、`does not page later while the focus window already reaches the reveal boundary (no request storm)` + `still pages later when the focus window right edge falls behind the cursor`（揭示边界闸两端）、`disables rewind once paper trading starts and re-enables after reset`（回退锁，含键盘 ← 的正/负对照）、`hides candles after the focused order open point and restores them` + `does not page later in the pre-entry view (no request storm)` + `resets the pre-entry view when leaving the order focus` + `resets the pre-entry view when switching to a different order`（开仓点前视图四面：隐藏/恢复、翻页闸、退出复位、11/04 换单复位，含同单重复点击不清）；纯函数层 `tests/free-replay-chart.test.ts` 的 `gates focus-mode later paging on the reveal boundary`。

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

### Drawing Ray (画线射线, 09/23)

工具栏的第二个工具由「线段」换成「射线」：`ChartDrawingKind` 增加 `'ray'`，`'segment'` 仅存量保留（见 domain 契约）。实现要点：

- **数据语义**：`points[0]` 是端点（固定），`points[1]` 是方向点。线从端点沿「端点 → 方向点」方向无限延伸，因此倒着画就会向左延伸——这是刻意的标准射线语义，不是 bug。
- **渲染**：复用 `DrawingShape` 已有的两点屏幕坐标换算（`timeframeTimeForPoint` 投影 + `pointToScreen`），把方向向量归一化后外推 `RAY_LENGTH = 20000` 像素常量。**不做精确矩形求交**：overlay 是铺满 `.chart-wrap` 的根 `<svg>`，根 SVG 视口与 `.chart-wrap` 的 `overflow: hidden` 都会裁剪超出部分，视觉上正好止于视口边缘。这样就不需要 overlay 尺寸 props 或 `ResizeObserver`，也不依赖 `timeScale().width()` / `paneSize()` —— 测试里的 chart mock 并不提供这两者，精确求交会波及多个测试文件的共用 mock。
- **零向量保护**：两次点击落在同一根柱的同一价位时方向为零，必须退化为不加长，绝不能产出 `NaN` 坐标。
- **手柄语义**：两个手柄仍落在真实点上 —— `'start'` 是端点、`'end'` 是方向点；只有画出的线越过 `'end'`。拖拽复用 `moveDrawing` 的默认分支，不需要新分支。
- **裁剪一致性**：`horizontal` 用 `x1="0"/x2="100%"` 横穿整个 overlay（含右侧价格轴区域），射线同样延伸到 overlay 边界。
- **面板一致性**：`TradeChart` 与 `FreeReplayChart` 各有一份同构画线接线（工具栏按钮、落点分支、草稿预览判断、`DrawingOverlay` 传参），改一处必须改另一处。测试按 `toolbarButtons[1]` 取第二个工具，所以这个工具只能**替换**、不能新增成第三个按钮。

**不变量：草稿预览必须按「当前激活的工具」渲染**，因此切换工具时必须清掉未完成的草稿（`setDraftPoint(null)` + `setDraftEndPoint(null)`，统一走 `selectDrawingTool`）。否则残留草稿会以新工具的形状重新渲染 —— 例如射线落了第一点后切到 `horizontal`，会冒出一条通栏水平线，而它点不掉（`horizontal` 分支直接 return，不重置 `draftPoint`），只能切回原工具或刷新页面。

Required tests: `tests/app-drawings.test.tsx` 必须覆盖「草稿预览已是射线而非线段」「端点来自第一次点击、方向点来自第二次点击」「零向量预览塌缩且无 NaN」「切换工具丢弃半途草稿」「存量 `segment` 仍渲染为有限两点线、持久化 `ray` 仍延伸」。

> **Warning**: `tests/app-drawing-snap.test.tsx` 里画线拖拽的用例依赖 jsdom 没有的 `Element.prototype.setPointerCapture` / `releasePointerCapture`，setup 里必须 stub，否则拖拽路径直接 `TypeError` —— 这正是该路径长期零测试覆盖的原因。

### Common Mistake: Cursor advance without viewport scroll

In `FreeReplayChart`, the render effect's `setVisibleRange` only runs on first initialization (guarded by `initializedRangeKeyRef`). After the user zooms or pans, subsequent cursor advances update data via `series.setData()` but leave the viewport unchanged. The cursor state advances correctly, but if the cursor reaches an edge the user sees no visual change and thinks the button/keyboard doesn't work.

**Fix**: Add a separate `useEffect` watching `replay.cursorTime` that scrolls only when the cursor exits the comfort zone (skip first mount) — see the "Free Replay Cursor Follow" section above. Do NOT swing back to scrolling on every cursor change: that yanks a viewport the user positioned (the 10/28 complaint this rule came from).

### Common Mistake: Preserving old time span across timeframe switches

Switching from a short Review Timeframe to a long one while reusing the old visible time span makes candles appear suddenly huge; switching back can make the chart look compressed or misplaced. Preserve visual candle density instead: carry forward the visible logical range span / visible candle count, map the anchor time to the destination series with `timeToIndex(..., true)`, call `setVisibleLogicalRange(...)`, and reset the price scale to autoscale so manual right-axis drags do not leak across timeframes. Do not rely on `barSpacing` alone as the primary signal; it can be less representative than the current logical range after chart initialization or library-internal scaling. Do not use `setVisibleRange(...)` as the primary timeframe-switch mechanism when the goal is preserving candle width; it preserves time ranges and can reintroduce timeframe-duration scaling.

### Common Mistake: Strict equality in timestamp matching

`shouldPrefetchFutureCandles` and similar helpers must use `>=` rather than `===` when matching `cursorTime * 1000` against candle timestamps. If the cursor timestamp has rounding deviation (e.g., from timeframe switch), strict equality silently returns `false` and future candle prefetch never triggers.
