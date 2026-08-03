# Design

## Scope

This task is scoped to Free Replay chart loading in `src/ui/App.tsx` and focused tests. Trade Review behavior, Free Replay cursor mapping, paper trading, drawing storage, and server candlestick semantics should remain unchanged unless a test proves a shared helper needs a small adjustment.

## Problem

Free Replay timeframe switching now preserves visual candle density by carrying the visible candle count into the destination timeframe. When the user has zoomed far out, the destination viewport can require more historical candlesticks than the fixed initial `150` earlier candles. The initial render can therefore contain left-side blank space, and the existing earlier-history autoload may not run because the range was set under `suppressAutoLoadRef` during initialization.

## Design

- Keep the existing product behavior from the prior chart-scale task: preserve visible candle count and anchor Free Replay near `replay.cursorTime` with right-side padding.
- After initial Free Replay data is loaded and the destination logical range is initialized, evaluate whether the loaded historical candle count is enough for the desired visible candle count.
- If the first visible slot needs more history than the currently loaded first candlestick provides, trigger `loadEarlierFreeReplayCandles()` through the existing earlier-loading path.
- Repeat earlier loading until the left side of the preserved viewport is backed by loaded history, the API returns no more candles, or an in-flight load is already active.
- Keep future candles hidden by rendering through `visibleCandlesForFreeReplay(renderedCandles, replay.cursorTime)` only. Do not use later candles to fill the viewport.
- Preserve the existing navigation-anchor behavior when applying newly loaded candles. Deviation (recorded 2026-08-03): the original plan called for delayed render through `applyFreeReplayPendingCandles()`, which captures and restores the visible *time* range. The implementation instead renders earlier candles immediately and relies on lightweight-charts' native `rightOffset` preservation on `setData` prepend — restoring an old time range would keep backfilled candles off-screen left and defeat the fill goal. The cursor stays at the same screen x-position while left whitespace is replaced by real candles; locked in by the "loads earlier history on left scroll without restoring an old visible time range" test.

## Boundaries

- Preferred change location: `FreeReplayChart` initialization/autoload effects in `src/ui/App.tsx`.
- Preferred test location: `tests/app-free-replay.test.tsx` if the regression depends on chart mock behavior; otherwise a pure helper can be added only if it avoids duplicating chart-library state in tests.
- No server API limit parameter unless frontend repeated earlier loads proves insufficient or unstable.

## Risks

- A naive loop can cascade earlier requests indefinitely if the API keeps returning overlapping data. The implementation should only continue when new unique earlier candles are added and should respect `loadingEarlierRef`.
- Triggering autoload while `suppressAutoLoadRef` is true can fight the initial viewport setup. Prefer an explicit post-render/history-fill check over relying on chart event callbacks during initialization.
- Tests must preserve existing Free Replay future-hiding behavior and timeframe-switch zoom preservation expectations.
