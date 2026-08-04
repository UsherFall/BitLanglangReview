# Design — Free Replay session history with progress restore

## Problem Restated

Reviewer loses Free Replay position when closing the page or switching tasks. Need durable, auto-saved session history with one-click restore.

## Architecture and Boundaries

Three layers, following existing patterns:

1. **Server store** — new `FreeReplaySessionStore` (`src/server/free-replay-session-store.ts`), better-sqlite3 + WAL like `DrawingStore`. New table `free_replay_sessions` in the existing `data/review.sqlite`.
2. **Server routes** — `/api/free-replay/sessions` added to `tradingReviewApiPlugin` (`src/server/app-plugin.ts`), same middleware style as `/api/drawings`.
3. **Frontend** — `App.tsx` owns session list state, auto-save, and restore. `FreeReplayPanel.tsx` renders the "历史会话" list.

### Session identity

Primary key is the composite `(instrument, start_time)` — matches R3 resume-by-key. No separate id column needed.

### Table schema

```sql
create table if not exists free_replay_sessions (
  instrument          text not null,
  start_time          text not null,
  timeframe           text not null,
  data_anchor_time    text not null,
  start_cursor_time   integer not null,
  start_progress_time integer not null,
  progress_time       integer not null,
  cursor_time         integer not null,
  paper_trading_json  text not null,
  updated_at          text not null,
  primary key (instrument, start_time)
);
```

`timeframe` is stored explicitly because it is separate shared App state, not part of `FreeReplayStart`. `paper_trading_json` stores the serialized `PaperTradingSession`. Candles are never stored — `FreeReplayChart` refetches on mount (App.tsx:719-750).

## Wire Contract

Shared JSON shape (opaque to the server — the store serializes/deserializes without knowing the types; no cross-layer type imports, keeping `src/ui` and `src/server` decoupled):

```ts
type FreeReplaySessionPayload = {
  instrument: string;
  startTime: string;          // raw flatpickr "Y-m-d H:i" string
  dataAnchorTime: string;     // ISO
  startCursorTime: number;    // unix seconds
  startProgressTime: number;  // unix seconds
  progressTime: number;       // unix seconds
  cursorTime: number;         // unix seconds
  timeframe: ReviewTimeframe;
  paperTrading: PaperTradingSession;
};
```

Routes:

| Method | Path | Body / Query | Response |
| --- | --- | --- | --- |
| GET | `/api/free-replay/sessions` | — | `{ sessions: FreeReplaySessionPayload[] }`, ordered by `updated_at` desc |
| PUT | `/api/free-replay/sessions` | full payload (no `updatedAt`) | saved payload with server `updatedAt` |
| DELETE | `/api/free-replay/sessions?instrument=..&startTime=..` | — | `{ ok: true }` |

Server sets `updatedAt`; client never sends it. PUT is an upsert keyed on `(instrument, start_time)`.

## Data Flow

### Auto-save
- On mount, App fetches the session list (`GET`).
- A single debounced effect (trailing ~500 ms) watches `[freeReplay, paperTrading, timeframe]`; when `reviewMode === 'freeReplay'` and `freeReplay` is set, it PUTs the current payload.
- A ref holds the latest pending payload; a `pagehide` listener flushes it with `fetch(..., { keepalive: true })` so an abrupt tab close keeps the last action.
- After each successful PUT, the local session list is upserted and re-sorted by `updatedAt` desc.
- Idempotent: restoring a session re-saves identical content (harmless; bumps `updatedAt` to the top, which reads as "most recently worked on").

### Start (resume-by-key)
`FreeReplayPanel` `onStart` (App.tsx:404) first checks the session list for an entry matching `(selectedInstrument, startTime)`:
- **Found** → restore path (below).
- **Not found** → build a fresh `FreeReplayStart` as today, and set state; the auto-save effect creates the new session.

### Restore (history click or resume-by-key)
Set, in one tick:
- `setFreeReplay({ instrument, startTime, dataAnchorTime, startCursorTime, startProgressTime, progressTime, cursorTime })`
- `setTimeframe(payload.timeframe)`
- `setPaperTrading(payload.paperTrading)`
- `setFreeReplayCandles([])`

`FreeReplayChart` remounts/re-inits from `replay.instrument`/`dataAnchorTime`/`timeframe`, loads candles, and anchors the visible range to `cursorTime` via the existing initialization effect (App.tsx:757-782). Switching between two active sessions re-keys the chart effect (`instrument:startTime:timeframe`) and reloads.

### Delete
- History row delete → `DELETE` + remove from local list.
- If the deleted session is the active one, also stop the replay: `setFreeReplay(null)` and `setPaperTrading(initialPaperTradingSession())`. Without this, the next auto-save would resurrect the deleted session. (AC5.)

## Compatibility and Migration

- New table only; `create table if not exists` on server start. No migration of existing tables. Rolling back = stop using the store/routes and remove the UI section.
- `CONTEXT.md:127-129` **Free Replay Session** definition must be revised in Phase 3 to remove "does not save free replay sessions between page visits" and the matching example dialogue line (`CONTEXT.md:207-209`).
- Existing `/api/free-replay/instruments`, `/api/candles`, `/api/drawings` untouched.

## Trade-offs

- **Server SQLite vs localStorage** — chosen SQLite: sessions are review data like reviews/drawings, survive browser-data clearing, and match the established store pattern. Cost: one store class, three routes, client fetch wiring.
- **Opaque JSON in store vs shared domain types** — `FreeReplayStart`/`PaperTradingSession` currently live in `src/ui`; moving them to `src/domain` is a broader refactor out of scope for this task. The store stays type-agnostic (like `points_json` in drawings); the wire shape is documented above.
- **Debounced auto-save vs event-driven** — debounce centralizes writes and absorbs arrow-key reveal bursts; `pagehide` flush covers the close-page gap.
- **Resume-by-key means no "new session" for a duplicate key** — restart-from-zero requires deleting the session first. Deliberate per R3.

## Operational / Rollback Notes

- Rollback point: after server store + routes (Phase 2 step 1) — client untouched, server additive.
- Validation commands live in `implement.md`.
