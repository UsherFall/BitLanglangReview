# Design — Free Replay Session lifecycle

## 1. Boundary and Interface

New file `src/ui/use-free-replay-session-lifecycle.ts` exports one React hook and its option/result types.

```ts
type FreeReplaySessionLifecycleOptions = {
  active: boolean;                       // reviewMode === 'freeReplay'
  cursorCandles: Candlestick[];          // Dataset Cursor supply, never Focus
  onFutureRetry: () => void;
  onResetView: () => void;               // start/restore: Focus + both chart arrays reset
  onClearFocus: () => void;              // reveal/rewind/switch/active delete
  onSessionDeleted: (instrument: string, startTime: string) => void;
};

type FreeReplaySessionLifecycleResult = {
  freeReplay: FreeReplayStart | null;
  paperTrading: PaperTradingSession;
  setPaperTrading: Dispatch<SetStateAction<PaperTradingSession>>;
  timeframe: ReviewTimeframe;
  setTimeframe: Dispatch<SetStateAction<ReviewTimeframe>>; // Trade Review path
  sessions: FreeReplaySession[];
  start(next: FreeReplayStart): void;
  restore(payload: FreeReplaySessionPayload): void;
  remove(instrument: string, startTime: string): Promise<void>;
  revealNext(): void;
  rewind(): void;
  switchTimeframe(next: ReviewTimeframe): void;
};
```

The hook owns state and persistence coordination. It does not expose `setFreeReplay`, pending refs, tombstones, fetch helpers or timer handles. App's generic Paper Trading setter remains necessary for the existing trading commands.

## 2. State and callback ownership

Hook-owned:

- `freeReplay`, `paperTrading`, `timeframe`, `sessions`;
- `pendingSaveRef`, `saveTimerRef`, `deletedSessionKeysRef`;
- GET history, PUT persistence, DELETE, auto-save and pagehide effects.

App-owned:

- `freeReplayCandles` / `freeReplayActiveCandles`, `orderFocus`, `futureRetryToken`;
- Paper Library, Paper Reviews and their refresh token;
- `onResetView` clears Focus + both chart arrays; `onClearFocus` only clears Focus;
- `onSessionDeleted` prunes the matching Paper Review prefix and bumps the library refresh token;
- `onFutureRetry` increments the existing chart retry token.

A latest-callback ref inside the hook prevents changing App callback identities from retriggering mount effects. State setters are stable and safe for async completions.

## 3. Lifecycle contracts

### History and persistence

- Mount GET parses `{ sessions?: FreeReplaySession[] }`, defaulting to `[]`.
- `upsertSession` replaces the same key and sorts descending by `updatedAt` exactly as today.
- `persist` checks the tombstone before PUT and again after JSON parsing. It preserves existing fetch/error semantics; adding response-status policy is out of scope.

### Auto-save and pagehide

- The current effect moves unchanged in behavior: active Replay constructs the full payload, replaces the pending value, resets a 500ms trailing timer; inactive/no Replay flushes pending immediately.
- `pagehide` reads the current pending ref and issues a keepalive PUT. No new global persistence or beforeunload UX.
- Restore flushes outgoing pending before applying the restored state. Fresh-start behavior remains as today.

### Start and restore

- `start` finds an existing session by `(instrument,startTime)` and delegates to `restore`.
- Fresh start deletes the matching tombstone, sets Replay, resets Paper Trading and calls `onResetView` once.
- Restore maps missing source to `LEGACY_REPLAY_CANDLE_SOURCE`, sets `dataAnchorTime = new Date(cursorTime * 1000).toISOString()`, restores timeframe and `normalizePaperTradingSession`, then calls `onResetView` once.

### Delete

- Mark tombstone and cancel a matching pending save before DELETE.
- On network failure, remove that new tombstone and throw, preserving current behavior.
- On success, invoke `onSessionDeleted`, remove the local row, and only when the active key matches close Replay/reset Paper Trading/clear Focus. Stale PUT completion sees the tombstone and cannot reinsert the row.

### Cursor commands

- `revealNext` reads `cursorCandles` from the latest render, clears Focus, applies `nextFreeReplayProgress`, processes a newly revealed candle into Paper Trading, or calls future retry when no advance exists.
- `rewind` keeps the Paper Trading active guard and existing grid mapping.
- `switchTimeframe` sets shared timeframe, clears Focus and updates Replay's data anchor/start cursor/current cursor with the existing pure helpers. `setTimeframe` remains available for Trade Review's standalone selector.

## 4. App migration

Replace the App state/refs/effects/handlers listed in research with one hook call and destructuring. Panel props map directly:

- `onStart={start}`, `onRestore={restore}`, `onDelete={remove}`;
- reveal/rewind buttons call the hook commands;
- Replay timeframe buttons call `switchTimeframe`; Trade Review buttons keep `setTimeframe`;
- `openPaperRound` uses the same `sessions` and `restore`, preserving its deferred Focus token.

Remove `upsertSession`, `sessionKey`, `persistFreeReplaySession`, `restoreFreeReplaySession`, `handleFreeReplayStart`, `handleDeleteSession`, the session effects and obsolete imports. Do not move `FreeReplayChart`, `FreeReplayDataset` or Paper Library code.

## 5. Direct tests

`tests/free-replay-session-lifecycle.test.tsx` uses `renderHook` and a fetch fake limited to `/api/free-replay/sessions`:

1. mount history + restore source/timeframe/cursor/paper + cursor anchor + reset callback;
2. existing start resumes, fresh start resets paper and view;
3. full trailing payload, mode-exit flush and pagehide keepalive;
4. restore flushes outgoing pending before switching;
5. delete cancels/ignores stale PUT, prunes through callback and fresh recreate clears the tombstone;
6. reveal updates cursor/paper or requests retry; rewind guard and timeframe remapping preserve contracts.

Use fake timers with `act`/`advanceTimersByTimeAsync`, not real 500ms sleeps. Existing `tests/app-free-replay.test.tsx`, `free-replay-panel.test.tsx` and `free-replay-session-store.test.ts` remain unchanged unless integration exposes an actual assertion defect.

## 6. Compatibility and rollback

No API, database, payload or UX migration. The shared timeframe state changes location but not value or setter semantics. React hook ownership avoids a second mutable controller.

Rollback is one child-specific commit revert. If App integration reveals an unintended behavior change, return to the narrow hook design rather than reintroducing duplicate state in App.
