# Free Replay session history with progress restore

## Goal

Add Free Replay history, like AI tool conversation history: past Free Replay sessions are listed, and clicking one restores the previous review progress so the reviewer can continue from where they left off.

User value: the reviewer no longer loses replay position (instrument, start time, timeframe, reveal cursor, and paper trading state) when closing the page or switching tasks.

## Confirmed Facts

- `CONTEXT.md` defines **Free Replay Session** as temporary in-page state that "does not save free replay sessions between page visits" (`CONTEXT.md:127-129`). This feature reverses that documented constraint; the definition must be updated in Phase 3.
- The previous archived task `07-30-free-replay-timeframe-chart-fill` explicitly listed "Persisting Free Replay sessions between page visits" as out of scope.
- Free Replay state lives entirely in memory in `src/ui/App.tsx`:
  - `freeReplay: FreeReplayStart | null` (`App.tsx:115`), shape defined in `src/ui/FreeReplayPanel.tsx:11-19`: instrument, startTime, dataAnchorTime, startCursorTime, startProgressTime, progressTime, cursorTime.
  - `freeReplayCandles: Candlestick[]` (`App.tsx:116`) — loaded/revealed candles.
  - `paperTrading: PaperTradingSession` — JSON-serializable shape (`src/ui/free-replay-paper-trading.ts:46-55`): active, startedAtCursorTime, nextId, pendingEntry/pendingExit/pendingStopLoss orders, position, trades.
  - Active review timeframe is separate shared App state (`App.tsx:112`), so it must be stored with the session for full restore.
- The only existing client persistence is `sidebarConfig` in `window.localStorage` (`App.tsx:57`, `App.tsx:124-126`).
- Server SQLite (`data/review.sqlite`) holds the Review Store (tags/notes), Drawing Store, and Candlestick Cache. Drawings are instrument-level and already persist; they appear automatically once the instrument is reloaded. Store pattern: better-sqlite3 + WAL, one store class per table (`src/server/drawing-store.ts`).
- Server routes are Vite middleware in `src/server/app-plugin.ts` (`/api/trades`, `/api/reviews`, `/api/free-replay/instruments`, `/api/candles`, `/api/drawings`).
- Candlestick data can be refetched from `/api/candles` (OKX Candlestick Cache), so saved sessions do not need to persist candle arrays.

## Requirements

- R1. Free Replay sessions must be saved and listed as history, like AI tool conversation history.
- R2. Clicking a saved session restores the full replay workspace: instrument, start time, review timeframe, Free Replay Cursor / reveal progress, and the paper trading session (pending orders, position, closed trades). (User decision: full restore, not replay-position-only.)
- R3. Session identity is the instrument + start time pair. Re-starting Free Replay with the same instrument + start time resumes the existing session instead of creating a new one. (User decision: resume-by-key, not always-new.)
- R4. Sessions auto-save as the reviewer makes progress (reveal, rewind, timeframe switch, paper trading actions), matching the AI-tool conversation analogy. No manual save button.
- R5. Sessions persist server-side in SQLite, consistent with reviews and drawings. (User decision: server SQLite, not localStorage.)

## Acceptance Criteria

- [ ] AC1. Starting a Free Replay creates a saved session; reveal, rewind, timeframe switch, and paper trading actions update it automatically (server persistence survives page reload).
- [ ] AC2. Free Replay mode shows a collapsible "历史会话" history section listing saved sessions (instrument, start time, last activity), ordered by most recent activity first. (User decision: sidebar FreeReplayPanel section.)
- [ ] AC3. Clicking a history session restores instrument, start time, review timeframe, cursor/reveal progress, and the paper trading session (pending orders, position, closed trades); candlesticks reload from `/api/candles`.
- [ ] AC4. Starting Free Replay with the same instrument + start time as an existing saved session restores that session instead of creating a new one.
- [ ] AC5. Each history row has a delete action; deleting the currently active session stops Free Replay and resets paper trading so it is not re-saved.

## Out of Scope

- Persisting candle arrays (refetched instead).
- Persisting chart visible range, price scale mode, or drawing-tool state.
- Multi-user / cross-device sync semantics (local single-user tool).

## Notes

- FreeReplayStart and PaperTradingSession types live in `src/ui`; the server store treats the session payload as opaque JSON, so no cross-layer type moves are required (documented in `design.md`).
- Auto-save is trailing-debounced; pending state is flushed on `pagehide` so an abrupt tab close does not lose the latest action.
