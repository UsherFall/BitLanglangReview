# Trellis Spec Index

Project-specific coding guidance for the Trading Review app.

## Spec Directories

| Directory | Scope |
| --- | --- |
| [Domain](./domain/index.md) | Pure trade, review, candlestick, drawing, and queue contracts |
| [Server](./server/index.md) | Vite middleware, Source Workbook import, SQLite stores, OKX market data |
| [Frontend](./frontend/index.md) | React UI, lightweight-charts integration, browser state, CSS |
| [Thinking Guides](./guides/index.md) | Cross-cutting review prompts for reuse and cross-layer changes |

## Architecture Summary

This is a local Vite/React TypeScript review tool for futures trades. The Source Workbook is read-only. Review tags, notes, candlestick cache entries, and chart drawings are persisted in local SQLite under `data/review.sqlite`. OKX public market data supplies candlesticks and Free Replay swap instruments.

Primary source layout:

```text
src/domain  Pure contracts and deterministic helpers.
src/server  Local API plugin, persistence, workbook import, market data services.
src/ui      React components, chart integration, UI helpers, CSS.
tests       Vitest tests for domain, server, and UI behavior.
```

Before changing behavior, read `CONTEXT.md` for project terminology and the spec directory matching the files you will touch.

## Task Research Data

Task `research/` directories keep scripts and `findings.md` in git, but bulk regenerable data stays out: `.gitignore` blocks `.trellis/tasks/**/research/pool/` and `research/out/`. Put candle dumps, rendered previews, and fetched snapshots under those names (or `.scratch/`), never as hand-committed files.

Two operational traps hit in practice:

- `git commit -- <pathspec>` re-stages those paths from the working tree and silently drops staged `git rm --cached` deletions. Commit staged deletions with a bare `git commit` (pathspec-free) instead.
- `task.py archive` auto-commit runs `git add` over the archive subtree; any bulk data not yet ignored gets re-added to the index. New bulk-data directories need a `.gitignore` rule *before* the next archive.