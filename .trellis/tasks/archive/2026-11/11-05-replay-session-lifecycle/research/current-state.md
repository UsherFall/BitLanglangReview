# Current state — Free Replay Session lifecycle

Date: 2026-11-05

## Baseline

- Branch: `feat/architecture-deepening`, including completed children 1–3.
- Focused baseline before child 4: `npx vitest run tests/app-free-replay.test.tsx tests/free-replay-panel.test.tsx tests/free-replay-session-store.test.ts` → **3 files / 75 tests passed**.
- The previous Dataset and StrictMode tasks are complete; this child must not reopen their boundaries.

## Current ownership in `src/ui/App.tsx`

| Concern | Current location | Coupling / risk |
| --- | --- | --- |
| Active `FreeReplayStart` | `useState` around line 247 | App can mutate it from six separate handlers |
| Paper Trading session | `useState` around line 255 | Restore/new/delete normalization sits beside chart/paper rendering |
| Shared Review Timeframe | `useState` around line 221 | Trade Review uses the setter; Replay restore/switch adds cursor remapping |
| Session history | GET effect around line 364 + `upsertSession` | API ordering and local list upsert are App concerns |
| Auto-save | effect around lines 410–450 | Payload construction, trailing 500ms debounce, mode-exit flush |
| Page hide | effect around lines 453–470 | Direct pending-ref access and keepalive PUT |
| Save/delete coordination | `pendingSaveRef`, `saveTimerRef`, `deletedSessionKeysRef` | Tombstones prevent deleted rows reappearing from stale PUT responses |
| Restore | `restoreFreeReplaySession` around line 705 | Flushes outgoing save, restores timeframe/paper state, anchors data on saved cursor, resets chart/focus |
| New/start existing | `handleFreeReplayStart` around line 737 | Existing key restores; fresh key clears tombstone and resets paper/chart |
| Delete | `handleDeleteSession` around line 753 | Cancels pending save, DELETE, local Paper Review pruning, active-session close |
| Cursor actions | reveal/rewind/switch around lines 655–691 | Cursor math + paper processing + Focus clearing mixed into App |

## Contracts that must remain observable

1. `GET /api/free-replay/sessions` loads history on mount; a successful PUT upsert sorts by descending `updatedAt`.
2. Auto-save is trailing 500ms and includes `candleSource`, exact progress/cursor fields, timeframe and normalized Paper Trading state. No inactive session produces a new auto-save.
3. Leaving Replay or stopping it flushes a pending save. `pagehide` sends the pending payload with `keepalive: true` and does not clear the tombstone guard.
4. Restore first flushes the outgoing pending save; `dataAnchorTime` is the saved CURSOR as ISO, not the original session start. Missing `candleSource` maps to `LEGACY_REPLAY_CANDLE_SOURCE`.
5. Starting an existing `(instrument, startTime)` resumes it; starting fresh resets Paper Trading and clears any deletion tombstone for that key.
6. Delete marks the key before the request, cancels a matching pending save, ignores stale PUT success for that key, prunes Paper Round reviews through an App callback, and closes only the matching active Replay. Network failure removes the new tombstone and propagates the error, preserving current behavior.
7. Reveal uses Cursor candles only, processes a newly revealed candle into Paper Trading, and invokes future retry when no cursor advance is available. Rewind remains locked while Paper Trading is active. Timeframe switch clears Focus and remaps both start and current cursors against the session grid.
8. `FreeReplayDataset` remains the sole owner of Cursor/Focus/Active/Rendered candle arrays; this lifecycle Module never owns candle windows.

## Best Module boundary

A React hook is the smallest boundary that owns the existing state + effects without introducing another state framework:

`useFreeReplaySessionLifecycle` owns active Replay, Paper Trading, shared timeframe, session history and all save/delete coordination. It exposes intent commands and read state, not pending refs or `setFreeReplay`.

App retains chart candle arrays, Focus, future-retry token and Paper Library state. Narrow callbacks let the hook request view/focus resets, future retry and post-delete Paper Library pruning without taking ownership of those concerns.

## Rejected approaches

- **API helper extraction only:** moving `fetch` calls would leave debounce, tombstones, restore and state coordination in App, providing little locality or direct test value.
- **Framework-free duplicate controller:** a second mutable copy of React Replay/Paper state would create synchronization races and violate the one-owner rule.
- **Global store / reducer for the whole App:** unnecessary broadening; the state belongs to one Replay workflow.
- **Absorb Chart Dataset or Paper Library:** these are separate tested Modules and would make the Interface shallower and larger.
- **Server/API redesign in this child:** no payload or persistence change is needed; transactional cascade belongs to child 5.

## Test strategy

Add `tests/free-replay-session-lifecycle.test.tsx` using `renderHook`, controllable fetch and fake timers. Direct cases cover restore/new start, payload + debounce/pagehide/mode-exit flushing, delete versus in-flight PUT, tombstone recreation, and cursor/timeframe commands. Existing App tests remain the end-to-end compatibility suite; no assertions should be weakened.
