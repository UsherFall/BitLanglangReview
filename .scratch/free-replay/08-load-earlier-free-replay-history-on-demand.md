# Load earlier Free Replay history on demand

## What to build

Extend Free Replay History so the reviewer can navigate left before the initially loaded historical candlesticks and have earlier candlesticks load on demand. This should follow the existing Trade Review chart behavior: navigating near the left edge requests more earlier candlesticks, keeps the chart navigation anchor stable, and does not reveal future candlesticks.

## Acceptance criteria

- [ ] Free Replay initially shows historical candlesticks before the start cursor.
- [ ] Dragging or scrolling near the left edge requests earlier candlesticks for the selected Instrument and Review Timeframe.
- [ ] Loading earlier history does not change the Free Replay Cursor.
- [ ] Loading earlier history does not reveal future candlesticks after the cursor.
- [ ] The visible chart range stays stable when earlier history is applied.
- [ ] Tests cover loading earlier history without changing cursor or exposing future candlesticks.

## Blocked by

- 03-reveal-and-rewind-free-replay-candlesticks
