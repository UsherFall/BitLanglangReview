# Port Chart Navigation Anchor stability to Free Replay

## What to build

Make Free Replay use the same Chart Navigation Anchor behavior as Trade Review while loading earlier history or applying newly loaded candlesticks. When the reviewer drags, scrolls, zooms, or rests the pointer on the chart, newly loaded candlesticks must not move the market time under the pointer or the chart-center anchor.

## Acceptance criteria

- [ ] Free Replay updates the Chart Navigation Anchor on every visible logical range change, matching Trade Review behavior.
- [ ] Free Replay schedules pending chart renders while the reviewer is navigating instead of applying loaded candlesticks immediately.
- [ ] When pending candlesticks are applied, Free Replay uses the current visible range span and the latest Chart Navigation Anchor to restore the chart position.
- [ ] Loading earlier Free Replay History does not move the market time under the pointer.
- [ ] Loading future hidden candlesticks does not change the visible chart range.
- [ ] The Free Replay implementation either reuses shared anchor utilities with Trade Review or has tests that prove both modes follow the same anchor semantics.
- [ ] Browser verification covers dragging and zooming while an earlier-history load is pending.

## Blocked by

- 08-load-earlier-free-replay-history-on-demand
