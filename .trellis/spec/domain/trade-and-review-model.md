# Trade And Review Model

## Domain Language

Use the terms in `CONTEXT.md` exactly. A completed position is a Trade, the market is an Instrument, OHLCV bars are Candlesticks, user labels are Review Tags, the one user-written summary is a Review Note, and drawings are Chart Drawings.

Avoid terms called out in `CONTEXT.md`, especially order, transaction, row, coin, ticker, K line, comment, and simulator.

## Trade Contract

`src/domain/trade.ts` defines `Trade`, `Direction`, `ReviewTimeframe`, and `reviewTimeframes`. The supported Review Timeframes are exactly `1m`, `5m`, `15m`, `1H`, `4H`, `1D`, `1W`, and `1M`. Keep `reviewTimeframes` in UI display order, with `1m` before `5m`.

A Trade ID is a stable SHA-256 identifier created by `src/server/trade-import.ts` from source sequence plus core trade fields. Do not switch review persistence to row numbers or workbook indexes.

## Review Contract

`src/domain/review.ts` defines one `TradeReview` per trade with `tradeId`, `tags`, `note`, `starred`, and `updatedAt`. Tags are custom reviewer labels, not a fixed enum. `starred` is a boolean favorite marker and must default to `false` for missing reviews and migrated rows. Notes alone do not make a trade reviewed; see Review Progress rules in `CONTEXT.md` and UI helper tests.

## Scenario: Review Favorite And Timeframe Contract

### 1. Scope / Trigger

- Trigger: Changes to Review Timeframes or `TradeReview` fields cross domain types, `/api/*` payloads, SQLite storage, React state, and tests.

### 2. Signatures

- `ReviewTimeframe = '1m' | '5m' | '15m' | '1H' | '4H' | '1D' | '1W' | '1M'`
- `reviewTimeframes = ['1m', '5m', '15m', '1H', '4H', '1D', '1W', '1M']`
- `TradeReview = { tradeId: string; tags: string[]; note: string; starred: boolean; updatedAt: string }`
- `ReviewQueueOptions.starred?: 'yes' | 'no'`
- SQLite `trade_reviews.starred integer not null default 0`

### 3. Contracts

- `POST /api/reviews` accepts `starred?: boolean`; omitted means `false` at the API boundary.
- Review Store serializes `starred` as `1` or `0` and deserializes it back to a boolean domain field.
- `/api/trades?starred=yes` returns only starred trades; `/api/trades?starred=no` returns missing-review and explicitly unstarred trades.
- `1m` uses a 60,000 ms timeframe duration in both UI chart helpers and server candlestick service.

### 4. Validation & Error Matrix

- Unsupported `timeframe` in `/api/candles` -> HTTP 400 from `reviewTimeframes.includes(timeframe)`.
- Missing `starred` column in existing SQLite file -> constructor migration adds it with default `0`.
- Missing review when filtering `starred=no` -> included because missing review is treated as unstarred.

### 5. Good/Base/Bad Cases

- Good: Add a new Review Timeframe by updating domain union, ordered array, UI `timeframeMs`, server `timeframeMs`, and tests together.
- Base: Existing rows without a favorite marker read as `{ starred: false }`.
- Bad: Adding a Review Store field only to React state without SQLite migration loses data on refresh.

### 6. Tests Required

- `tests/chart-time.test.ts`: timeframe order and duration for any new Review Timeframe.
- `tests/review-store.test.ts`: save/load and default migration behavior for any new `TradeReview` field.
- `tests/review-queue.test.ts`: filter semantics for any new `ReviewQueueOptions` field.
- `tests/review-editor.test.tsx` or app-level tests: UI payload preserves existing review fields when saving partial edits.

### 7. Wrong vs Correct

#### Wrong

```ts
reviewStore.saveReview({ tradeId, tags, note }); // drops an existing starred flag
```

#### Correct

```ts
reviewStore.saveReview({ tradeId, tags, note, starred: currentReview?.starred ?? false });
```

## Candlestick And Drawing Contracts

`src/domain/candlestick.ts` keeps market candles as millisecond timestamps with OHLCV fields and a `ReviewTimeframe`. Chart code converts to seconds only at the `lightweight-charts` boundary.

`src/domain/drawing.ts` defines instrument-level Chart Drawings. Drawings have `horizontal` or `segment` kind and price/time points. A drawing may be created while reviewing a trade, but it is displayed by Instrument across trades and Review Timeframes.

## Verification

When changing these contracts, update both server and UI callers and run `npm test`. High-signal tests include `tests/trade-import.test.ts`, `tests/drawing-store.test.ts`, `tests/trade-markers.test.ts`, and `tests/free-replay-chart.test.ts`.
