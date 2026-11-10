# Free Replay Session Lifecycle

## Scope / Trigger

Read this before changing `src/ui/use-free-replay-session-lifecycle.ts`, App's Replay session wiring, auto-save, restore, deletion or cursor commands.

The hook is the single owner of active `FreeReplayStart`, Paper Trading session, reversible `reviewStatus` (`active | ended`), shared Review Timeframe, session history, pending saves, debounce timers and deletion tombstones. `FreeReplayDataset` remains the only Candlestick-window owner; App retains Focus, chart-facing arrays and Paper Library state.

## Signatures

```ts
useFreeReplaySessionLifecycle(options: {
  active: boolean;
  cursorCandles: Candlestick[];
  onFutureRetry(): void;
  onResetView(): void;
  onClearFocus(): void;
  onSessionDeleted(instrument: string, startTime: string): void;
}): {
  freeReplay: FreeReplayStart | null;
  paperTrading: PaperTradingSession;
  setPaperTrading: Dispatch<SetStateAction<PaperTradingSession>>;
  reviewStatus: FreeReplayReviewStatus;
  endReview(): void;
  resumeReview(): void;
  timeframe: ReviewTimeframe;
  setTimeframe: Dispatch<SetStateAction<ReviewTimeframe>>;
  sessions: FreeReplaySession[];
  start(next: FreeReplayStart): void;
  restore(payload: FreeReplaySessionPayload): void;
  remove(instrument: string, startTime: string): Promise<void>;
  revealNext(): void;
  rewind(): void;
  switchTimeframe(next: ReviewTimeframe): void;
};
```

`setTimeframe` is the Trade Review path. Replay UI calls `switchTimeframe`, which additionally clears Focus and remaps the data anchor/start/current cursors. `setPaperTrading` remains for existing trading commands but is a freeze-aware Dispatch: while `reviewStatus === 'ended'` it does not even execute the supplied functional update. Internal start/restore/delete/reveal transitions use the private raw Paper setter. No pending ref, tombstone, timer or generic `setFreeReplay` is public.

## Contracts

1. **History.** Mount GET `/api/free-replay/sessions`; missing `sessions` means `[]`. Successful PUT upserts `(instrument,startTime)` and sorts descending by `updatedAt`.
2. **Auto-save.** Active Replay schedules a trailing 500ms PUT with source, exact progress/cursor fields, timeframe, Paper Trading state and `reviewStatus`. Leaving Replay flushes pending; `pagehide` sends pending with `keepalive: true`.
3. **Restore.** Flush outgoing pending first. Missing source uses `LEGACY_REPLAY_CANDLE_SOURCE`; `dataAnchorTime` is the saved cursor as ISO; timeframe and normalized Paper Trading state restore with one `onResetView`. Missing `reviewStatus` means `active`; a different saved session may restore `ended`. If the current session is already `ended`, a SAME-key restore returns after the outgoing flush and is otherwise a complete no-op, so stale history/library payloads cannot resume it or roll back its cursor/Paper/Focus. The library's own later Focus command still runs.
4. **Start.** Existing key delegates to restore. Fresh start clears the key's tombstone, sets `reviewStatus='active'`, resets Paper Trading and calls `onResetView` once.
5. **Delete.** Mark the key and cancel matching pending before DELETE. Successful DELETE calls `onSessionDeleted`, removes the row and closes only a matching active Replay. Closing that Replay also resets `reviewStatus='active'`. A stale PUT checks the tombstone after parsing and cannot reinsert the row. Fresh start legitimately clears the tombstone.
6. **Cursor commands.** Reveal reads Cursor candles only, processes the newly revealed candle into Paper Trading and calls future retry when no advance exists. Rewind is a no-op while Paper Trading is active. BOTH reveal and rewind return before Focus clearing, cursor math, future retry or fill processing while `reviewStatus === 'ended'`. Timeframe switch remains view-only and allowed while ended: it preserves exact `progressTime` and uses existing pure cursor helpers.
7. **Callbacks.** `onResetView` clears Focus and both chart arrays; `onClearFocus` only clears Focus; `onSessionDeleted` prunes the matching Paper Review prefix and refreshes Paper Library. Latest callback refs prevent callback identities from retriggering mount effects.
8. **End/resume.** `endReview` / `resumeReview` require an active Replay and change only `reviewStatus`, never `freeReplay`, Paper Trading, Focus, chart arrays or future-retry state. They also patch the matching history row's status in place without changing `updatedAt` or order, so a trailing PUT that has not yet returned cannot leave a stale row that bypasses the freeze. `paperTrading.active` is independent and must remain unchanged.

## Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| No active Replay | No new auto-save; pending flushes when leaving Replay |
| Existing start key | Restore, never reset the saved progress/paper state |
| Missing legacy source | Use the legacy Binance source, not the panel default |
| PUT resolves after DELETE | No history upsert |
| DELETE network failure | Remove the new tombstone and propagate the error |
| Fresh start after DELETE | Clear tombstone and allow a new PUT |
| Reveal with no next candle | Keep cursor/progress and request future retry |
| Rewind with active Paper Trading | No cursor or Focus change |
| Reveal/rewind while ended | No cursor, Paper, Focus, future-retry or fill change |
| Paper Dispatch while ended | No state change and no functional-updater execution |
| Ended same-key restore | Complete no-op after outgoing flush; no resume or scene rollback |
| Legacy payload without reviewStatus | Restore as active |
| Trade Review timeframe selector | Change shared timeframe without Replay cursor remapping |

## Good / Base / Bad Cases

- **Good:** direct `renderHook` test resolves a DELETE before an older PUT; history stays deleted, then fresh start permits recreation.
- **Good:** restoring B while A's debounce is pending PUTs A before applying B.
- **Good:** ending with a position, entry/exit limits and stops freezes the exact scene; arrows, button clicks and direct Dispatches cannot change it, while order Focus and timeframe viewing still work.
- **Good:** ending A updates A's history row before its trailing PUT resolves; restoring B and then that latest A row keeps A ended.
- **Base:** restoring a session still auto-saves its restored state later, matching existing behavior.
- **Bad:** using `paperTrading.active=false` as the ended flag — that field means Paper Trading has not started and has different rewind semantics.
- **Bad:** a second React state copy of `freeReplay` or `reviewStatus` in App “for convenience”.
- **Bad:** disabling only the previous/next buttons while Arrow keys or `setPaperTrading` stay live.
- **Bad:** applying a stale same-key payload while ended; status is not the only thing it can roll back — cursor and Paper can move too.
- **Bad:** moving `cursorCandles` ownership out of Dataset or passing Focus candles to reveal.
- **Bad:** exposing `pendingSaveRef` / `deletedSessionKeysRef` so App can patch lifecycle internals.
- **Bad:** clearing Paper Library inside the hook; that state belongs to App's callback boundary.

## Tests Required

`tests/free-replay-session-lifecycle.test.tsx` uses `renderHook`, fake timers and controllable fetch for:

1. history + restore source/timeframe/cursor/paper + saved-cursor data anchor;
2. existing versus fresh start;
3. full trailing payload and 500ms boundary;
4. mode-exit flush + pagehide keepalive;
5. outgoing flush before restore;
6. stale PUT after DELETE + fresh recreate;
7. reveal/Paper Trading, future retry, rewind guard and timeframe remapping;
8. end/resume with an open Paper scene, frozen Dispatch/cursor/keyboard commands, status in trailing/mode-exit/pagehide saves, ended restore, legacy-active fallback, same-key no-op and history status freshness across session switches.

`tests/app-free-replay.test.tsx`, `free-replay-panel.test.tsx` and `free-replay-session-store.test.ts` remain integration compatibility gates. Do not replace them with hook-only coverage.

## Wrong vs Correct

```ts
// Wrong: lifecycle internals leak back into App.
const [pending, setPending] = useState<FreeReplaySessionPayload | null>(null);
const [deletedKeys] = useState(new Set<string>());

// Correct: App consumes read state + intent commands.
const { freeReplay, sessions, restore, remove, revealNext } =
  useFreeReplaySessionLifecycle(options);
```

```ts
// Wrong: restore anchors the initial request at the original session start.
dataAnchorTime: payload.startTime;

// Correct: a progressed replay loads around its saved cursor.
dataAnchorTime: new Date(payload.cursorTime * 1000).toISOString();
```

```ts
// Wrong: ended is only a button state; the command still mutates Paper.
if (reviewStatus === 'ended') setControlsDisabled(true);
setPaperTrading((current) => closeMarket(current, candle, progressTime));

// Correct: the lifecycle command is the final guard, before any updater runs.
const setPaperTrading: Dispatch<SetStateAction<PaperTradingSession>> = (action) => {
  if (reviewStatus === 'ended') return;
  setPaperTradingState(action);
};
```