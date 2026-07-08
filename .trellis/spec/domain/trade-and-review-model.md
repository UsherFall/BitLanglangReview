# Trade And Review Model

## Domain Language

Use the terms in `CONTEXT.md` exactly. A completed position is a Trade, the market is an Instrument, OHLCV bars are Candlesticks, user labels are Review Tags, the one user-written summary is a Review Note, and drawings are Chart Drawings.

Avoid terms called out in `CONTEXT.md`, especially order, transaction, row, coin, ticker, K line, comment, and simulator.

## Trade Contract

`src/domain/trade.ts` defines `Trade`, `Direction`, `ReviewTimeframe`, and `reviewTimeframes`. The supported Review Timeframes are exactly `5m`, `15m`, `1H`, `4H`, `1D`, `1W`, and `1M`; `1m` is intentionally excluded.

A Trade ID is a stable SHA-256 identifier created by `src/server/trade-import.ts` from source sequence plus core trade fields. Do not switch review persistence to row numbers or workbook indexes.

## Review Contract

`src/domain/review.ts` defines one `TradeReview` per trade with `tradeId`, `tags`, `note`, and `updatedAt`. Tags are custom reviewer labels, not a fixed enum. Notes alone do not make a trade reviewed; see Review Progress rules in `CONTEXT.md` and UI helper tests.

## Candlestick And Drawing Contracts

`src/domain/candlestick.ts` keeps market candles as millisecond timestamps with OHLCV fields and a `ReviewTimeframe`. Chart code converts to seconds only at the `lightweight-charts` boundary.

`src/domain/drawing.ts` defines instrument-level Chart Drawings. Drawings have `horizontal` or `segment` kind and price/time points. A drawing may be created while reviewing a trade, but it is displayed by Instrument across trades and Review Timeframes.

## Verification

When changing these contracts, update both server and UI callers and run `npm test`. High-signal tests include `tests/trade-import.test.ts`, `tests/drawing-store.test.ts`, `tests/trade-markers.test.ts`, and `tests/free-replay-chart.test.ts`.