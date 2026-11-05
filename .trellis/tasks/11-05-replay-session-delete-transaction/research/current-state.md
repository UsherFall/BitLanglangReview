# Current state — Session + Paper Review cascade

Date: 2026-11-05

## Evidence

`DELETE /api/free-replay/sessions` in `src/server/app-plugin.ts` currently performs:

1. `freeReplaySessionStore.deleteSession(instrument,startTime)`;
2. `reviewStore.deleteReviewsByPrefix(paperSessionReviewPrefix(...))`;
3. `{ ok: true, deletedReviews }`.

Both stores open their OWN `better-sqlite3` connection to `data/review.sqlite`. There is no transaction around the two calls. A failure in step 2 leaves the session gone and its Paper Round annotations orphaned, exactly the inconsistency the cascade is meant to prevent.

`ReviewStore.deleteReviewsByPrefix` owns the proven LIKE escaping contract: `!`, `%`, `_` are escaped, SQL pins `escape '!'`, and callers pass a trailing `:`. Existing tests cover same-session rows, prefix collision (`10:0` vs `10:07`) and `_` in instrument names.

Baseline before this child:

```text
npx vitest run tests/review-store.test.ts tests/free-replay-session-store.test.ts tests/free-replay-session-lifecycle.test.tsx
3 files / 21 tests passed
```

## Required boundary

`FreeReplaySessionStore` already owns the session row and one SQLite connection. Add a cascade method there that runs BOTH deletes through that same `this.db.transaction`. Reuse the ReviewStore prefix deletion through a module-level SQL helper so wildcard behavior is not duplicated.

The route should call this one method and preserve its response shape. Keep existing standalone `deleteSession` and `ReviewStore.deleteReviewsByPrefix` APIs intact for their current callers/tests.

## Failure experiment

A real rollback test needs the actual SQLite constraint/transaction seam, not a mocked second store:

- create a file-backed temporary DB with a session and Paper Reviews;
- add a SQLite BEFORE DELETE trigger on `trade_reviews` that raises an error;
- call the cascade and observe the error;
- verify the session row still exists and all reviews remain.

A second success case verifies both rows disappear, `deletedReviews` is correct, and neighboring session/trade reviews survive. File-backed DB is required because production uses two store connections; `:memory:` databases are connection-local.
