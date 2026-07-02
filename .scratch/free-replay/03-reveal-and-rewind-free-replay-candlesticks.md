# Reveal and rewind Free Replay candlesticks

## What to build

Implement Free Replay controls so the reviewer can reveal the next Candlestick or rewind the latest revealed Candlestick. The right arrow key and a visible button reveal the next Candlestick; the left arrow key and a visible button rewind one Candlestick. Revealing advances the Free Replay Cursor but does not automatically move the visible chart range.

## Acceptance criteria

- [ ] Starting Free Replay shows Free Replay History before the start cursor using the existing on-demand loading behavior.
- [ ] Right arrow reveals exactly one future Candlestick when available.
- [ ] A visible reveal button performs the same action as the right arrow key.
- [ ] Left arrow hides the latest revealed Candlestick when more than the starting Candlestick is revealed.
- [ ] A visible rewind button performs the same action as the left arrow key.
- [ ] Rewind cannot move before the starting Candlestick.
- [ ] Revealing or rewinding does not automatically move the visible chart range.
- [ ] Tests cover reveal, rewind, and the no-auto-follow visible-range behavior.

## Blocked by

- 02-start-free-replay-from-picked-local-minute
