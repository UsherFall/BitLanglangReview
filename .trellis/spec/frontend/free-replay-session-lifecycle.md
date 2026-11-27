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
  revealPending: boolean;
  executionError: string;
  revealNext(): void;
  rewind(): void;
  switchTimeframe(next: ReviewTimeframe): void;
};
```

`setTimeframe` is the Trade Review path. Replay UI calls `switchTimeframe`, which remaps the data anchor/start/current cursors and preserves Focus in both **active** and **ended** states (11/26). With a selected order, the unchanged token plus new `rangeKey` lets the chart refetch/re-anchor that order's entry in the target period; without Focus, the normal Cursor window and right-edge anchor remain. `setPaperTrading` remains for existing trading commands but is a freeze-aware Dispatch: while `reviewStatus === 'ended'` it does not even execute the supplied functional update. Internal start/restore/delete/reveal transitions use the private raw Paper setter. No pending ref, tombstone, timer or generic `setFreeReplay` is public.

**Transitional execution (11/27):** `revealPending` / `executionError` are temporary UI state, never session payload fields. When a newly revealed coarse candle opens before the current `progressTime` and automatic orders exist, the hook calls `free-replay-order-execution.ts` for same-source/grid execution-only child candles. It does not change Replay/Paper/Focus until the exact new interval is loaded; success commits Paper + Replay together and clears Focus, while failure leaves them untouched and exposes a retryable error. A monotonic operation token plus latest-active ref rejects late completion after scene changes, Paper edits, mode exit or unmount. Ordinary reveals remain synchronous.

## Contracts

1. **History.** Mount GET `/api/free-replay/sessions`; missing `sessions` means `[]`. Successful PUT upserts `(instrument,startTime)` and sorts descending by `updatedAt`.
2. **Auto-save.** Active Replay schedules a trailing 500ms PUT with source, exact progress/cursor fields, timeframe, Paper Trading state and `reviewStatus`. Leaving Replay flushes pending; `pagehide` sends pending with `keepalive: true`.
3. **Restore.** Flush outgoing pending first. Missing source uses `LEGACY_REPLAY_CANDLE_SOURCE`; `dataAnchorTime` is the saved cursor as ISO; timeframe and normalized Paper Trading state restore with one `onResetView`. Missing `reviewStatus` means `active`; a different saved session may restore `ended`. If the current session is already `ended`, a SAME-key restore returns after the outgoing flush and is otherwise a complete no-op, so stale history/library payloads cannot resume it or roll back its cursor/Paper/Focus. The library's own later Focus command still runs.
4. **Start.** Existing key delegates to restore. Fresh start clears the key's tombstone, sets `reviewStatus='active'`, resets Paper Trading and calls `onResetView` once.
5. **Delete.** Mark the key and cancel matching pending before DELETE. Successful DELETE calls `onSessionDeleted`, removes the row and closes only a matching active Replay. Closing that Replay also resets `reviewStatus='active'`. A stale PUT checks the tombstone after parsing and cannot reinsert the row. Fresh start legitimately clears the tombstone.
6. **Cursor commands.** Reveal reads Cursor candles only, processes the newly revealed candle into Paper Trading and calls future retry when no advance exists. Rewind is a no-op while Paper Trading is active. BOTH reveal and rewind return before Focus clearing, cursor math, future retry or fill processing while `reviewStatus === 'ended'`. Timeframe switch is view-only in both states: it preserves exact `progressTime`, Paper Trading and Focus, and never calls `onClearFocus`. An existing Focus follows the `rangeKey:token` chart path to refetch/re-anchor the selected order; no Focus keeps the normal Cursor initialization. The chart-local pre-entry scissors state therefore survives a same-order timeframe switch without entering the session payload.
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
| Transitional reveal loading | Pending guard blocks duplicate commands; no cursor/Paper/Focus change yet |
| Child data failed/incomplete | Retryable error; no coarse-OHLC fallback or partial commit |
| Late child response after scene/Paper/mode change or unmount | Silent discard, no error/fill/cursor write |
| Rewind with active Paper Trading | No cursor or Focus change |
| Reveal/rewind while ended | No cursor, Paper, Focus, future-retry or fill change |
| Paper Dispatch while ended | No state change and no functional-updater execution |
| Active timeframe switch with Focus | Preserve Focus and chart-local scissors state; fetch/re-anchor the selected order's target-period entry window; exact `progressTime` / Paper unchanged |
| Any timeframe switch without Focus | Keep the normal Cursor-window initialization and right-edge anchor |
| Ended timeframe switch with Focus | Same Focus behavior as active; `reviewStatus='ended'` and Paper stay frozen |
| Ended same-key restore | Complete no-op after outgoing flush; no resume or scene rollback |
| Legacy payload without reviewStatus | Restore as active |
| Trade Review timeframe selector | Change shared timeframe without Replay cursor remapping |

## Good / Base / Bad Cases

- **Good:** a coarse transition with automatic orders loads exact child candles; pre-progress lows/highs are excluded, while a real post-progress stop fills at the child close.
- **Good:** direct `renderHook` test resolves a DELETE before an older PUT; history stays deleted, then fresh start permits recreation.
- **Good:** restoring B while A's debounce is pending PUTs A before applying B.
- **Good:** ending with a position, entry/exit limits and stops freezes the exact scene; arrows, button clicks and direct Dispatches cannot change it, while order Focus and timeframe viewing still work.
- **Good:** ending A updates A's history row before its trailing PUT resolves; restoring B and then that latest A row keeps A ended.
- **Base:** restoring a session still auto-saves its restored state later, matching existing behavior.
- **Base:** an ordinary full-candle reveal remains synchronous and performs no execution-child request.
- **Bad:** using `paperTrading.active=false` as the ended flag — that field means Paper Trading has not started and has different rewind semantics.
- **Bad:** a second React state copy of `freeReplay` or `reviewStatus` in App “for convenience”.
- **Bad:** disabling only the previous/next buttons while Arrow keys or `setPaperTrading` stay live.
- **Bad:** applying a stale same-key payload while ended; status is not the only thing it can roll back — cursor and Paper can move too.
- **Bad:** moving `cursorCandles` ownership out of Dataset or passing Focus candles to reveal.
- **Bad:** exposing `pendingSaveRef` / `deletedSessionKeysRef` so App can patch lifecycle internals.
- **Bad:** clearing Paper Library inside the hook; that state belongs to App's callback boundary.
- **Bad:** falling back to the transitional coarse candle when child loading fails or has a gap; this recreates the pre-progress false-fill bug.

## Tests Required

`tests/free-replay-session-lifecycle.test.tsx` uses `renderHook`, fake timers and controllable fetch for:

1. history + restore source/timeframe/cursor/paper + saved-cursor data anchor;
2. existing versus fresh start;
3. full trailing payload and 500ms boundary;
4. mode-exit flush + pagehide keepalive;
5. outgoing flush before restore;
6. stale PUT after DELETE + fresh recreate;
7. reveal/Paper Trading, future retry, rewind guard and timeframe remapping;
8. end/resume with an open Paper scene, frozen Dispatch/cursor/keyboard commands, status in trailing/mode-exit/pagehide saves, ended restore, legacy-active fallback, same-key no-op and history status freshness across session switches;
9. active/ended timeframe Focus parity, including the chart-local pre-entry scissors state, plus App-level proof that a selected order in EITHER state keeps its row active, fetches the target-period `positionOpenTime` initial window, re-anchors with `entryVisibleRange`, preserves the strict pre-entry cutoff when enabled, and preserves exact progress/Paper.
10. transitional execution: real 15m→1H pre-progress low does not stop; a post-progress low still stops at the child close; pending dedupe, incomplete-data retry, duplicate/late responses, scene/Paper/mode invalidation and unmount; ordinary reveal performs no execution fetch.

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

```ts
// Wrong: the coarse candle's pre-progress low can fill an existing stop.
processRevealedCandle(paper, revealedCoarse, nextReplay.progressTime);

// Correct: automatic orders in a transitional candle execute only exact new child bars.
if (hasAutomaticOrders(paper) && needsPartialExecution(revealedCoarse, replay.progressTime)) {
  const children = await loadPartialExecutionCandles(input);
  const nextPaper = processExecutionCandles(paper, children);
  // Commit only while the operation token is still current.
}
```


```ts
// Wrong: status-dependent clearing removes the button and its cutoff.
if (reviewStatus !== 'ended') callbacksRef.current.onClearFocus();

// Correct: timeframe switching never clears Focus; rangeKey drives target-period refetch.
setTimeframe(nextTimeframe);
setFreeReplay((current) => current ? {
  ...current,
  dataAnchorTime: new Date(current.progressTime * 1000).toISOString(),
  startCursorTime: freeReplayCursorTimeForStart(current.startTime, nextTimeframe, replayCandleGrid(current)),
  cursorTime: freeReplayCursorTimeForTimeframeSwitch(current.progressTime, nextTimeframe, replayCandleGrid(current)),
} : current);
```