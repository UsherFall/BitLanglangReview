# Free Replay no-future progress model design

## Current model

Free Replay currently stores one time value, `cursorTime`, in seconds. That value is used for all of these meanings:

- true replay progress
- current timeframe visible candle boundary
- `/api/candles?mode=initial` anchor during timeframe switch
- paper trading order creation/start time
- marker future filtering

This collapses distinct concepts. Switching from `5m` at `10:35` to `4H` floors `cursorTime` to `08:00`; switching back to `5m` then loses the original `10:35` progress. It also allows showing the `08:00-12:00` 4H candle before `progressTime = 12:00`.

## Target model

`FreeReplayStart` should carry both:

- `progressTime`: true replay progress in seconds. It starts from the user's selected timestamp and changes only when the user starts, reveals, or rewinds replay.
- `cursorTime`: current timeframe visible boundary in seconds. It is derived from `progressTime` and the active Review Timeframe.

The visible boundary represents the latest complete candle whose end time is not after `progressTime`.

Examples:

- `progressTime = 2024-05-21 10:35`, `5m` -> `cursorTime = 10:30`, visible through `10:30-10:35`.
- `progressTime = 2024-05-21 10:35`, `4H` -> `cursorTime = 04:00`, visible through `04:00-08:00`.
- `progressTime = 2024-05-21 12:00`, `4H` -> `cursorTime = 08:00`, visible through `08:00-12:00`.

## Helper ownership

Keep deterministic time math in existing pure helper files:

- `src/ui/chart-time.ts`
  - parse Free Replay start progress from user input
  - map `progressTime` to no-future display cursor for a Review Timeframe
  - compute the completion time for a cursor candle
- `src/ui/free-replay-chart.ts`
  - visible candle filtering by display cursor
  - next/previous progress transitions based on loaded current-timeframe candles

Avoid adding a second timeframe duration map. Continue using `timeframeMs`.

## Data flow

Start Free Replay:

1. `FreeReplayPanel` parses the selected start input into `progressTime` without flooring.
2. It computes `cursorTime = freeReplayCursorTimeForProgress(progressTime, timeframe)`.
3. It emits `FreeReplayStart` with `startTime`, `dataAnchorTime`, `startCursorTime`, `progressTime`, and `cursorTime`.

Switch Review Timeframe:

1. Do not change `progressTime`.
2. Set `dataAnchorTime` to `new Date(progressTime * 1000).toISOString()`.
3. Recompute `startCursorTime` and `cursorTime` with the target timeframe's no-future mapping.

Next candle:

1. Use current loaded candles and current `cursorTime` to find the next visible candle for the active timeframe.
2. Set `progressTime` to that next candle's completion time.
3. Set `cursorTime` to that next candle's timestamp.
4. Process paper order triggers on that next candle, using the completion time as the event time.

Previous candle:

1. If no replay exists, no-op.
2. Set `progressTime` to the current visible candle's start time, clamped not earlier than the start progress.
3. Recompute `cursorTime` from that progress and current timeframe.
4. Do not mutate paper trading state, matching existing rewind behavior.

## Paper trading time semantics

Price rules stay unchanged:

- market open/close uses the currently visible complete candle close
- limit fills use `limitPrice`
- limit trigger checks `low <= limitPrice <= high`

Time rules change:

- paper trading start and pending order creation record current `progressTime`
- market fills record current `progressTime`
- limit fills record the completion time of the candle that triggered them

For a large timeframe candle, do not infer the internal event path. If the revealed candle's high/low touches a limit, fill at `limitPrice` and timestamp the fill at candle completion time.

## Compatibility

This intentionally supersedes old specs/tests that said Free Replay timeframe switching maps cursor to the containing candlestick. Trade Review marker placement and drawing placement still use containing-candle semantics.

## Tests

Add focused coverage for:

- no-future cursor mapping from progress time
- start preserving true progress while displaying only completed candles
- switching `5m -> 4H -> 5m` without losing `10:35`
- `4H` next/previous progress transitions
- `/api/candles?mode=initial` anchor from `progressTime`
- paper market and limit event times/prices under no-future semantics
