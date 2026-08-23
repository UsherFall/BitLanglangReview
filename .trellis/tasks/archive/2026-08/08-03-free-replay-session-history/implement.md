# Implement — Free Replay session history with progress restore

## Ordered Checklist

### 1. Server store — `src/server/free-replay-session-store.ts` (new)
- `FreeReplaySessionStore` class, better-sqlite3 + WAL, mirror `DrawingStore` pattern.
- Table `free_replay_sessions` (schema in `design.md`).
- Methods: `listSessions()` (ordered by `updated_at` desc), `saveSession(payload)` (upsert on `(instrument, start_time)`, returns payload with server `updatedAt`), `deleteSession(instrument, startTime)`.
- Payload treated as opaque JSON; `paper_trading_json` column holds the stringified paper trading state.

### 2. Server routes — `src/server/app-plugin.ts`
- Instantiate `FreeReplaySessionStore` alongside the other stores.
- Add `/api/free-replay/sessions`:
  - GET → `{ sessions }` (list, `updated_at` desc).
  - PUT → parse body, `saveSession`, return saved payload.
  - DELETE → `instrument` + `startTime` query params, `deleteSession`, return `{ ok: true }`.
  - Other methods → 405.
- Follow existing `send`/`readBody` helpers.

### 3. Frontend session state + auto-save — `src/ui/App.tsx`
- Add `freeReplaySessions` state; `GET /api/free-replay/sessions` on mount.
- Add trailing-debounced (~500 ms) auto-save effect on `[freeReplay, paperTrading, timeframe]`: if `reviewMode === 'freeReplay'` and `freeReplay`, PUT current payload (exclude `updatedAt`). Upsert result into local list, sort by `updatedAt` desc.
- Pending-payload ref + `pagehide` listener flushing with `fetch(..., { keepalive: true })`.
- Guard so the very first render (sessions still loading / no active session) never PUTs.

### 4. Restore + resume-by-key — `src/ui/App.tsx`
- `onStart` handler (App.tsx:404): before building a fresh `FreeReplayStart`, look up `freeReplaySessions` by `(instrument, startTime)`; if found, run restore path.
- New `restoreFreeReplaySession(payload)` used by both history click and resume-by-key: set `freeReplay`, `setTimeframe(payload.timeframe)`, `setPaperTrading(payload.paperTrading)`, `setFreeReplayCandles([])`.

### 5. History list UI — `src/ui/FreeReplayPanel.tsx`
- New props: `sessions`, `onRestore(session)`, `onDelete(instrument, startTime)`.
- Collapsible "历史会话" section below the start controls: each row shows instrument, start time, and last activity (formatted `updatedAt`), with a delete button. Click row → `onRestore`.

### 6. Delete semantics — `src/ui/App.tsx` + `FreeReplayPanel.tsx`
- `handleDeleteSession`: `DELETE` request, remove from local list; if the deleted session is the active one, `setFreeReplay(null)` + `setPaperTrading(initialPaperTradingSession())`.

### 7. Styles — `src/ui/styles.css`
- Styles for the history section, rows, active-row highlight, and delete button; match existing sidebar/panel styling.

### 8. Tests — `tests/`
- Update `tests/app-free-replay.test.tsx` fetch stub to serve `GET/PUT/DELETE /api/free-replay/sessions`.
- New cases:
  - auto-save PUT fires after reveal / paper trading action;
  - restore on history click sets instrument, timeframe, cursor, paper trading;
  - resume-by-key: starting same instrument + start time restores instead of creating new;
  - delete active session stops replay and is not re-saved.

### 9. CONTEXT.md spec update (Phase 3 gate)
- Revise **Free Replay Session** (`CONTEXT.md:127-129`) and the example dialogue (`CONTEXT.md:207-209`) to remove "does not save free replay sessions between page visits".

## Validation Commands

- `npx tsc --noEmit` — type check (must pass before and after each phase).
- `npm test` — vitest suite; existing free-replay tests must stay green, new cases added.
- `npm run dev` — manual: start a session, reveal a few candles, place a paper order, reload page → session listed and restores to exact cursor + paper state; same-key restart resumes; delete active session stops replay.

## Risky Files / Rollback Points

- **`src/server/app-plugin.ts`** — server middleware; additive routes only. Rollback point after step 2: client untouched.
- **`src/ui/App.tsx`** — 1642-line component; all changes additive (new state, effect, handlers). Restore must not break existing start/reveal/rewind flows (existing free-replay tests are the guard).
- **`src/ui/FreeReplayPanel.tsx`** — new props must keep existing render paths working; `onStart`/`onReveal`/`onRewind` already optional.
- Rollback: remove store instantiation + routes + frontend state/section; existing tables untouched.

## Follow-up Checks Before `task.py start`

- [ ] jsonl curated with real spec entries (not seed).
- [ ] User reviewed prd.md / design.md / implement.md.
- [ ] User confirms `task.py start`.
