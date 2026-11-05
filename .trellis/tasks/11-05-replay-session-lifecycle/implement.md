# Implement — Free Replay Session lifecycle

## Ordered checklist

- [x] 1. Create `src/ui/use-free-replay-session-lifecycle.ts` with the reviewed option/result Interface and move session history, save/delete refs, auto-save/pagehide and lifecycle commands into it.
- [x] 2. Add `tests/free-replay-session-lifecycle.test.tsx` covering the six direct groups in `design.md`; run the hook suite independently.
- [x] 3. Migrate `src/ui/App.tsx` to one hook call, wire view/focus/delete/future callbacks, and delete superseded App state/effects/handlers/imports.
- [x] 4. Run focused compatibility:

  ```bash
  npx vitest run tests/free-replay-session-lifecycle.test.tsx tests/app-free-replay.test.tsx tests/free-replay-panel.test.tsx tests/free-replay-session-store.test.ts
  npx tsc --noEmit
  ```

- [x] 5. Perform full-scope review: no duplicate pending-save/tombstone owner, no Focus/candle ownership migration, no Dataset changes, no API/payload changes and no test weakening.
- [x] 6. Run final gates:

  ```bash
  npm test
  npm test -- --exclude tests/level-alert-parity.test.ts
  npx tsc --noEmit
  git diff --check
  ```

  Record the established missing-pool failure separately; do not claim raw `npm test` is green unless the fixture is present.

- [x] 7. Add a frontend Session Lifecycle code-spec and update state/hook/quality guidance as needed. Update the parent task map with the work commit.
- [x] 8. Commit this child independently (`refactor(replay): ...`), archive it, then create child #5. Do not combine #5 code in this commit.

## Review gates

- **Interface:** App cannot set `freeReplay` directly or access save timers/tombstones; Paper Trading setter remains only for existing trading commands.
- **Restore:** saved cursor becomes the new data anchor and source/timeframe/paper state survive; outgoing pending save flushes first.
- **Delete:** stale PUT cannot resurrect, active key closes, non-active key leaves current Replay intact, fresh start clears the tombstone.
- **React:** no mutable duplicate controller, no StrictMode-disposed owner, no effect dependency loop from callback identities.
- **Compatibility:** all pre-existing App Replay assertions continue to pass without relaxation.

## Rollback points

1. If the standalone hook is incorrect, stop before App migration and fix its direct tests.
2. If App integration fails, revert only the App migration locally while retaining the hook/tests for diagnosis; do not commit a dual-owner intermediate state.
3. After delivery, revert the child's single work commit; no schema/API/data rollback is needed.
