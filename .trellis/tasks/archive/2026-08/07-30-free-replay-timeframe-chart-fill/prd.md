# Fix free replay timeframe chart fill

## Goal

When a reviewer switches the Free Replay review timeframe after zooming the chart out, the new timeframe should load enough historical candlesticks to fill the preserved chart viewport instead of leaving the chart partly blank and unable to backfill automatically.

User value: the reviewer can keep their chosen zoom level while moving between timeframes and still see enough past market structure for Free Replay.

## Confirmed Facts

- `CONTEXT.md` defines **Free Replay History** as past candlesticks before the Free Replay Cursor, and says it loads on demand like the normal Review Window while future candlesticks remain hidden until Free Replay Reveal exposes them.
- `CONTEXT.md` defines **Free Replay Reveal** as appending the next candlestick without automatically moving the visible chart range.
- `.trellis/tasks/archive/2026-07/07-29-chart-scale-visual-options/prd.md` R10 and R11 already established the product decision: timeframe switching must preserve visual candle zoom density, and Free Replay timeframe switching anchors on the replay cursor with right-side future padding.
- `.trellis/spec/frontend/component-guidelines.md` records the implementation rule: preserve candle visual density across timeframe switches by carrying forward the visible logical range span / visible candle count, then map the destination anchor with `timeToIndex(..., true)` and call `setVisibleLogicalRange(...)`.
- User confirmed this task should follow the existing preserve-zoom behavior and add historical candlestick backfill when the preserved viewport is wider than the initial Free Replay history load.
- `src/ui/App.tsx:210` maps Free Replay timeframe switches to a new cursor and sets `dataAnchorTime` from the current `progressTime`.
- `src/ui/App.tsx:718` reloads Free Replay candlesticks when instrument/start/data anchor/timeframe changes, using `/api/candles` with `mode=initial`.
- `src/ui/App.tsx:761` preserves the pre-switch visible bar count through `pendingSwitchVisibleBarsRef`, so switching after zooming out can request a much wider viewport than the default initial dataset covers.
- `src/ui/App.tsx:862` can load earlier Free Replay candlesticks, but only after the visible range change handler decides the visible range is near the loaded left edge.
- `src/server/app-plugin.ts:119` returns fixed `150` earlier and `150` later candlesticks for `mode=initial`; `src/server/app-plugin.ts:111` returns fixed `150` earlier candlesticks for `mode=earlier`.
- `tests/free-replay-chart.test.ts` covers Free Replay cursor/reveal helpers, but there is no current test covering viewport fill or earlier-history backfill after a timeframe switch.

## Requirements

- R1. Free Replay timeframe switching must preserve the reviewer's current zoom level when possible.
- R2. After the new timeframe data is applied, visible chart space to the left of the cursor must be backed by loaded historical candlesticks when that historical data exists.
- R3. The backfill behavior must not reveal future candlesticks beyond the Free Replay Cursor; future candlesticks remain controlled by reveal/prefetch rules.
- R4. Loading more earlier history after a timeframe switch must keep the chart navigation anchor stable and must not pull the reviewer away from the selected viewport.
- R5. The implementation should reuse the existing `/api/candles` earlier-loading path unless evidence shows the initial-load API needs an explicit limit parameter.

## Acceptance Criteria

- [ ] Given a Free Replay chart that was zoomed out before switching timeframes, when the reviewer switches to another timeframe, the chart preserves the wider visible bar count and loads enough earlier historical candlesticks to fill the left side of the viewport when available.
- [ ] Given the same switch, no candlestick later than the Free Replay Cursor is displayed merely to fill the viewport.
- [ ] Given earlier history is loaded after the switch, the visible range remains anchored to the same intended cursor/viewport instead of jumping as new candlesticks render.
- [ ] Automated coverage verifies the regression at the helper/component boundary that owns the loading decision.
- [ ] Existing Free Replay reveal, rewind, future prefetch, and Trade Review chart autoload behavior remain unchanged.

## Out of Scope

- Changing Free Replay Cursor mapping semantics across review timeframes.
- Revealing future candles automatically to fill blank space.
- Persisting Free Replay sessions between page visits.
- Reworking the chart library or replacing the existing on-demand candlestick API.
