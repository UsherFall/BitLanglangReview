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