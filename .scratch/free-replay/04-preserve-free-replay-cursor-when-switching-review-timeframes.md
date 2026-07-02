# Preserve Free Replay cursor when switching Review Timeframes

## What to build

When the reviewer switches Review Timeframes during Free Replay, preserve replay progress by using the previous Free Replay Cursor candlestick's open time as the anchor. The new cursor is the Candlestick in the new Review Timeframe whose time range contains that anchor time.

## Acceptance criteria

- [ ] Switching Review Timeframes in Free Replay does not reset to the original start time unless the cursor is still at the start.
- [ ] The new Free Replay Cursor is based on the previous cursor Candlestick open time.
- [ ] The revealed range in the new Review Timeframe includes history through the mapped cursor and hides future Candlesticks after it.
- [ ] Trade Review timeframe switching keeps its existing entry-centered behavior.
- [ ] Tests cover switching from a smaller Review Timeframe to a larger one and from a larger Review Timeframe to a smaller one.

## Blocked by

- 03-reveal-and-rewind-free-replay-candlesticks
