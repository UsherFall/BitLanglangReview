# State Management

## State Categories

This project uses React local state only. There is no global store. Persistent state belongs to SQLite stores behind the Vite middleware; browser state is temporary unless explicitly saved through an API call.

`src/ui/App.tsx` owns page-level state:

- Review queue filters, fetched trades, known instruments, known tags, and selected trade ID.
- Active Review Timeframe.
- Review mode: `trade` or `freeReplay`.
- Free Replay session: selected instrument/start time/cursor and currently loaded candles.

`src/ui/ReviewEditor.tsx` owns draft tags, draft note, and save status until `/api/reviews` persists them. `src/ui/FreeReplayPanel.tsx` owns instrument search, selected instrument, start time, status text, and the `flatpickr` instance.

## Server State

Server data is fetched through these routes from `src/server/app-plugin.ts`:

- `/api/trades` returns reviewed trades, source workbook instruments, and saved review tags.
- `/api/reviews` saves a `TradeReview`.
- `/api/candles` returns cached/fetched candlesticks for initial, earlier, or later modes.
- `/api/drawings` lists, saves, and deletes instrument-level chart drawings.
- `/api/free-replay/instruments` returns OKX SWAP instruments.

After saving a review, update local `data` state in place like `handleReviewSaved` does: merge new tags into the tag list and replace only the matching trade review.

## Derived State

Keep derived state close to the consumer and prefer pure helpers:

- `selectedTrade`, `progress`, and `nextUnreviewedTrade` are derived in `App.tsx` from fetched queue data.
- `reviewProgress` and `firstUnreviewedTrade` live in `src/ui/review-progress.ts` and are covered by `tests/review-progress.test.ts`.
- Free Replay visibility and cursor movement live in `src/ui/free-replay-chart.ts` and are covered by `tests/free-replay-chart.test.ts`.

## Domain Rules

Review Progress counts a trade as reviewed only when it has at least one Review Tag. Review Notes alone do not mark a trade as reviewed. Free Replay session state is intentionally temporary; only chart drawings are saved across sessions.

## Common Mistakes

Do not duplicate queue filtering or sorting in the frontend. The authoritative queue comes from `buildReviewQueue` through `/api/trades`. Do not persist Free Replay cursor/session state unless the product requirement changes. Do not mutate candle arrays in place; merge by timestamp and sort before rendering.