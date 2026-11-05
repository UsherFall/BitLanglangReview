# Design — Transactional Session cascade

## 1. Shared prefix SQL

Export a module-level helper from `src/server/review-store.ts`:

```ts
export function deleteReviewsByPrefix(db: Database.Database, prefix: string): number;
```

It contains the existing escaping and `delete from trade_reviews where trade_id like ? escape '!'` statement. `ReviewStore.deleteReviewsByPrefix(prefix)` becomes a one-line delegate, preserving its public API and all existing tests.

No new generic repository abstraction is introduced.

## 2. SessionStore cascade

Add:

```ts
deleteSessionWithPaperReviews(
  instrument: string,
  startTime: string,
  paperReviewPrefix: string,
): { deletedReviews: number };
```

Implementation creates `const cascade = this.db.transaction(...)`; inside it:

1. delete from `free_replay_sessions` by exact key;
2. call the shared prefix helper with THE SAME `this.db`;
3. return `{ deletedReviews }` from `cascade()`.

`paperReviewPrefix` must be the existing `paperSessionReviewPrefix(instrument,startTime)` including trailing `:`. The existing `deleteSession` remains for standalone store callers.

The SessionStore owns this aggregate operation because it owns the session row and can atomically touch dependent Paper Review rows on its connection. This is narrower than sharing a global DB handle across every Store.

## 3. Route wiring

Replace the two delete calls with:

```ts
const { deletedReviews } = freeReplaySessionStore.deleteSessionWithPaperReviews(
  instrument,
  startTime,
  paperSessionReviewPrefix(instrument, startTime),
);
return send(res, 200, { ok: true, deletedReviews });
```

No request or response change. Transaction errors continue through the existing middleware error behavior instead of returning a false success.

## 4. Tests

New `tests/free-replay-session-delete-transaction.test.ts` uses a temp file DB with real `ReviewStore` + `FreeReplaySessionStore` connections.

- **Commit case:** two target Paper Reviews, one neighboring-session review and one ordinary trade review; expect both target rows + session deleted, exact count 2, everything else retained.
- **Rollback case:** install a BEFORE DELETE trigger on `trade_reviews` that raises `forced review delete failure`; expect the cascade to throw, target session to remain and every review to remain.

Existing `tests/review-store.test.ts` proves helper delegation did not change wildcard/prefix semantics; existing session and lifecycle suites protect standalone deletion and client behavior.

## 5. Trade-offs and rollback

Putting Paper Review deletion on the SessionStore connection couples this one aggregate method to `trade_reviews`, but avoids a broad shared-connection refactor and is the only way to get one SQLite transaction with the current ownership. The shared SQL helper prevents semantic drift.

Rollback is one commit revert. No schema or data migration; a failed transaction naturally leaves both original datasets intact.
