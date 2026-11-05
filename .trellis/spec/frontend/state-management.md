# State Management

## State Categories

This project uses React local state only. There is no global store. Persistent state belongs to SQLite stores behind the Vite middleware; browser state is temporary unless explicitly saved through an API call.

`src/ui/App.tsx` owns page-level state:

- Review queue filters, fetched trades, known instruments, known tags, and selected trade ID.
- Active Review Timeframe.
- Review mode: `trade`, `bitget`, `freeReplay`, or `scan`.

`trade` (交割单复盘, xlsx source) and `bitget` (Bitget复盘) share ONE queue/detail code path: both render the same filters/progress/list/detail/chart/editor and differ only by the data-source endpoint. `App.tsx` picks the endpoint with `tradeReviewEndpoint(mode)` (`/api/trades` vs `/api/bitget/trades`) and re-fetches when the mode or a `tradeRefreshToken` bump changes; `BitgetControlBar` bumps that token after a successful sync. Review tags/notes/star are shared across both sources because reviews key on `trade.id` and Bitget ids carry a `bg-` prefix.
- Free Replay session: selected instrument/start time/cursor. Its loaded candles are owned by `src/ui/free-replay-dataset.ts` (Cursor / Focus / Active / Rendered + all loads), not by component refs; see `free-replay-dataset.md`.

`src/ui/ReviewEditor.tsx` owns draft tags, draft note, and save status until `/api/reviews` persists them. `src/ui/FreeReplayPanel.tsx` owns instrument search, selected instrument, start time, status text, and the `flatpickr` instance.

## Server State

Server data is fetched through these routes from `src/server/app-plugin.ts`:

- `/api/trades` returns reviewed trades, source workbook instruments, and saved review tags.
- `/api/bitget/trades` returns the same queue contract for cached Bitget positions plus `configured: boolean`.
- `/api/bitget/config` (`GET`/`POST`/`DELETE`) manages the locally stored read-only key; `POST /api/bitget/sync` fetches closed position history. Both live behind `BitgetControlBar` in the Bitget module.
- `/api/reviews` saves a `TradeReview` and answers `{ review, tags, tagCounts }`, scoped to the `module` sent in the request body. `App.handleReviewSaved` replaces its tag list/counts from that payload (tag counts are module-scoped and recomputed server-side, so a tag that just lost its last trade disappears); `ReviewEditor` and `App.toggleStarred` must both send `module`.
- `/api/candles` returns cached/fetched candlesticks for initial, earlier, or later modes.
- `/api/drawings` lists, saves, and deletes chart drawings, scoped by **board** (10/26): GET/POST require `board` = `scan` (选品抽屉) | `review` (复盘/回溯图), missing/illegal → 400. Listing matches the instrument CANONICALLY inside the board; the 距线 scan measures the `scan` board only.
- `/api/free-replay/instruments` returns OKX SWAP instruments.
- `/api/free-replay/sessions` lists saved Free Replay sessions; PUT upserts one on `(instrument, startTime)`, DELETE removes one AND cascades its paper round reviews.
- `/api/paper/rounds` returns the 模拟单库 (`rounds` / `sessions` / `reviews` / `tags` / `tagCounts`); `App` re-fetches it on entering 回溯复盘, on returning to the replay home screen, and when the library filters change.

After saving a review, update local `data` state in place like `handleReviewSaved` does: merge new tags into the tag list and replace only the matching trade review.

## Paper Round Annotations (11/04)

One review row per **Paper Round**, keyed `paper:{instrument}:{startTime}:{positionId}`, held in `App` as `paperReviews` (id → `TradeReview`). Rules this codebase relies on:

- **One map, two entries.** The in-replay 单子 rows and the 模拟单库 rows read the same map, so an edit in either place shows up in the other without a refetch. Inside the replay, resolve a fill's round id through `paperRoundReviewId(...)` — never use `trade.id` (a fill id) as the review id.
- **Seeded from `reviews`, not just `rounds`.** The library answer's `rounds` excludes the still-open round, but its partial fills are annotatable during the replay; seed the map from `reviews` (every `paper:` review) and then from `rounds`.
- **Saves patch in place.** `/api/reviews` (with `module: 'paper'`) answers `{ review, tags, tagCounts }`; write the review into the map and the round row, and replace `tags`/`tagCounts` from the payload (counts are module-scoped, a locally merged list could not drop a tag that just lost its last round). Do not refetch the whole library on save.
- **Stars are one click.** The star toggle saves immediately (optimistically, rolling back on failure) from both entries; expanding an annotation editor to add a star would make the two entries behave differently for the same action. Tags/note keep the explicit save button.
- **Tag rename/delete must patch paper rows too.** `mutatePaperTag` posts with `module: 'paper'` and rewrites `paperReviews` + library rows, otherwise the local snapshot would resurrect the old tag name on the next save.
- **Session delete drops its annotations locally.** The server cascade deletes the rows; `App.handleDeleteSession` prunes its in-memory reviews by `paperSessionReviewPrefix` and bumps `paperLibraryToken`, so the library cannot keep rows nothing can render.

## Derived State

Keep derived state close to the consumer and prefer pure helpers:

- `selectedTrade`, `progress`, and `nextUnreviewedTrade` are derived in `App.tsx` from fetched queue data.
- `reviewProgress` and `firstUnreviewedTrade` live in `src/ui/review-progress.ts` and are covered by `tests/review-progress.test.ts`.
- Free Replay visibility and cursor movement live in `src/ui/free-replay-chart.ts` and are covered by `tests/free-replay-chart.test.ts`; the four candlestick windows, stale-response guards and deferred render are owned by `FreeReplayDataset` (`src/ui/free-replay-dataset.ts`, `tests/free-replay-dataset.test.ts`).

## Domain Rules

Review Progress counts a trade as reviewed only when it has at least one Review Tag. Review Notes alone do not mark a trade as reviewed. Free Replay sessions auto-save to SQLite and restore the reveal cursor and paper trading state; starting the same instrument + start time resumes the saved session instead of creating a new one.

## Common Mistakes

Do not duplicate queue filtering or sorting in the frontend. The authoritative queue comes from `buildReviewQueue` through `/api/trades`. Keep Free Replay auto-save additive: the auto-save effect must never PUT on first render or on the restore path, and a deleted session must not be re-added by an in-flight save response. Do not mutate candle arrays in place; merge by timestamp and sort before rendering.