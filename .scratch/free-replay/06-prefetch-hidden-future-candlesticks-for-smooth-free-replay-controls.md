# Prefetch hidden future candlesticks for smooth Free Replay controls

## What to build

Prefetch future Candlestick data for Free Replay while keeping it hidden until the reviewer reveals it. Start Free Replay with enough hidden future Candlesticks for smooth stepping, then fetch more before the hidden buffer runs out.

## Acceptance criteria

- [ ] Free Replay may load future Candlesticks into memory before they are visible.
- [ ] Prefetched future Candlesticks are not rendered until Free Replay Reveal exposes them.
- [ ] Repeated right-arrow reveals are smooth and do not require a network request for every keypress.
- [ ] More future Candlesticks are fetched before the hidden buffer is exhausted.
- [ ] Fetch failures do not expose future Candlesticks incorrectly and show a recoverable status.
- [ ] Tests cover hidden prefetch data remaining hidden until reveal.

## Blocked by

- 03-reveal-and-rewind-free-replay-candlesticks
