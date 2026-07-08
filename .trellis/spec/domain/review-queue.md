# Review Queue

## Queue Ownership

`src/domain/build-review-queue.ts` is the authoritative place for applying Review Queue filters, attaching reviews, and sorting trades. Do not duplicate this behavior in React components or server route handlers.

The Vite middleware in `src/server/app-plugin.ts` should parse URL query parameters into `ReviewQueueOptions` and call `buildReviewQueue(trades, reviewStore.listReviews(), options)`.

## Filtering Rules

`ReviewQueueOptions` in `src/domain/review-queue.ts` supports:

- Instrument equality.
- Direction equality.
- Entry date range using the `YYYY-MM-DD` prefix of `entryTime`.
- Result: `profit`, `loss`, or `flat` from numeric `profit`.
- Review Tag inclusion.
- Review Note state: with trimmed note or without trimmed note.

Keep filter behavior deterministic and side-effect free. Existing coverage is in `tests/review-queue.test.ts`.

## Sorting Rules

The default queue order is entry time ascending. Optional sort fields are `entryTime`, `returnRate`, `profit`, and `holdingMinutes`, each with `asc` or `desc` direction.

Use string comparison for `entryTime` because imported trade times are normalized ISO strings with `+08:00`. Use numeric comparison for numeric sort fields.

## Reviewed Status

Review Progress is a UI helper, but it depends on the same domain meaning: a trade is reviewed only when `trade.review?.tags.length` is greater than zero. A note without tags is still unreviewed.

## Common Mistakes

Do not make a missing review equivalent to an empty saved review unless the caller explicitly needs that distinction removed. `ReviewedTrade.review` is `TradeReview | null` so UI can distinguish unsaved review data.