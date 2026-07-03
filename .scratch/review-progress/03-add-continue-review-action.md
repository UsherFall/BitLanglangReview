# Add a Continue Review action for the first unreviewed Trade

## What to build

Add a `继续复盘` action in the Trade Review sidebar. When clicked, it selects the first unreviewed Trade in the current filtered and sorted Review Queue. This makes the button a stable way to jump back to the current review breakpoint. It must not jump outside the current Review Queue.

## Acceptance criteria

- [ ] The Trade Review sidebar has a `继续复盘` action near Review Progress.
- [ ] Clicking `继续复盘` selects the first Trade in the current Review Queue whose Review Tags are empty.
- [ ] The action respects the current filters and sort order.
- [ ] If all Trades in the current Review Queue are reviewed, the action is disabled or shows a completed state.
- [ ] After saving Review Tags on the selected Trade, clicking `继续复盘` moves to the next first unreviewed Trade in the current Review Queue.
- [ ] Component tests cover a queue with unreviewed Trades, an all-reviewed queue, and save-then-continue behavior.

## Blocked by

- 01-define-review-progress
- 02-show-review-progress-in-sidebar
