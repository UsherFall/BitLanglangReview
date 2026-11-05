# Free Replay Session Lifecycle

## Scope / Trigger

Read this before changing `src/ui/use-free-replay-session-lifecycle.ts`, App's Replay session wiring, auto-save, restore, deletion or cursor commands.

The hook is the single owner of active `FreeReplayStart`, Paper Trading session, shared Review Timeframe, session history, pending saves, debounce timers and deletion tombstones. `FreeReplayDataset` remains the only Candlestick-window owner; App retains Focus, chart-facing arrays and Paper Library state.

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

`setTimeframe` is the Trade Review path. Replay UI calls `switchTimeframe`, which additionally clears Focus and remaps the data anchor/start/current cursors. `setPaperTrading` remains for existing trading commands. No pending ref, tombstone, timer or generic `setFreeReplay` is public.

## Contracts

1. **History.** Mount GET `/api/free-replay/sessions`; missing `sessions` means `[]`. Successful PUT upserts `(instrument,startTime)` and sorts descending by `updatedAt`.
2. **Auto-save.** Active Replay schedules a trailing 500ms PUT with source, exact progress/cursor fields, timeframe and Paper Trading state. Leaving Replay flushes pending; `pagehide` sends pending with `keepalive: true`.
3. **Restore.** Flush outgoing pending first. Missing source uses `LEGACY_REPLAY_CANDLE_SOURCE`; `dataAnchorTime` is the saved cursor as ISO; timeframe and normalized Paper Trading state restore with one `onResetView`.
4. **Start.** Existing key delegates to restore. Fresh start clears the key's tombstone, resets Paper Trading and calls `onResetView` once.
5. **Delete.** Mark the key and cancel matching pending before DELETE. Successful DELETE calls `onSessionDeleted`, removes the row and closes only a matching active Replay. A stale PUT checks the tombstone after parsing and cannot reinsert the row. Fresh start legitimately clears the tombstone.
6. **Cursor commands.** Reveal reads Cursor candles only, processes the newly revealed candle into Paper Trading and calls future retry when no advance exists. Rewind is a no-op while Paper Trading is active. Timeframe switch preserves exact `progressTime` and uses existing pure cursor helpers.
7. **Callbacks.** `onResetView` clears Focus and both chart arrays; `onClearFocus` only clears Focus; `onSessionDeleted` prunes the matching Paper Review prefix and refreshes Paper Library. Latest callback refs prevent callback identities from retriggering mount effects.

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
| Trade Review timeframe selector | Change shared timeframe without Replay cursor remapping |

## Good / Base / Bad Cases

- **Good:** direct `renderHook` test resolves a DELETE before an older PUT; history stays deleted, then fresh start permits recreation.
- **Good:** restoring B while A's debounce is pending PUTs A before applying B.
- **Base:** restoring a session still auto-saves its restored state later, matching existing behavior.
- **Bad:** a second React state copy of `freeReplay` in App “for convenience”.
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
7. reveal/Paper Trading, future retry, rewind guard and timeframe remapping.

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
