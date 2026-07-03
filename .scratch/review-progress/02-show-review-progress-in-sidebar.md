# Show Review Progress in the Trade Review sidebar

## What to build

Show Review Progress in the Trade Review sidebar between the filters and the Trade list. The reviewer should see the selected Trade's position in the current Review Queue and how many Trades in that queue have been reviewed. Progress should update after filters change, after selecting another Trade, and after saving Review Tags.

## Acceptance criteria

- [ ] Trade Review shows the selected Trade position, such as `当前 12 / 420`.
- [ ] Trade Review shows the reviewed count, such as `已复盘 31 / 420`.
- [ ] The displayed totals are based on the current filtered and sorted Review Queue.
- [ ] Saving Review Tags updates the reviewed count without a page refresh.
- [ ] Switching filters recalculates the progress from the new Review Queue.
- [ ] Free Replay does not show Trade Review progress.
- [ ] Component tests cover initial rendering, filter-based queue changes, and tag-save updates.

## Blocked by

- 01-define-review-progress
