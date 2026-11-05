# Implement — Transactional Session cascade

- [x] 1. Extract the existing ReviewStore prefix-delete statement into an exported same-connection helper and delegate the class method to it.
- [x] 2. Add `deleteSessionWithPaperReviews` to `src/server/free-replay-session-store.ts` using one `this.db.transaction`.
- [x] 3. Add the file-backed commit + trigger-forced rollback tests.
- [x] 4. Replace the route's two independent delete calls with the cascade and preserve the response.
- [x] 5. Run focused checks:

  ```bash
  npx vitest run tests/free-replay-session-delete-transaction.test.ts tests/review-store.test.ts tests/free-replay-session-store.test.ts tests/free-replay-session-lifecycle.test.tsx tests/app-free-replay.test.tsx
  npx tsc --noEmit
  ```

- [x] 6. Review that there is no duplicate prefix SQL, no cross-connection pseudo-transaction, no response/schema change and no weakened test.
- [x] 7. Run `npm test`, the established runnable-suite exclusion, `npx tsc --noEmit` and `git diff --check`; record the known fixture issue.
- [x] 8. Update persistence spec and parent map, commit independently, archive, then start #6.

## Rollback points

- If the trigger test does not genuinely fail the second statement, fix the experiment before changing production code.
- If delegation changes any ReviewStore prefix result, stop and restore the exact escaping behavior.
- Revert the single work commit to restore the previous route and store APIs; no data rollback is needed.
