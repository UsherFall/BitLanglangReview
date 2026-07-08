# Persistence And Imports

## Review Store

`src/server/review-store.ts` persists one review per trade in `trade_reviews`. It enables SQLite WAL mode, stores tags as JSON, and upserts on `trade_id`.

Keep tag cleanup in the store boundary. `uniqueCleanTags` trims tags, removes empty entries, and preserves first-seen order through `Set`. Existing coverage is `tests/review-store.test.ts`.

## Drawing Store

`src/server/drawing-store.ts` owns Chart Drawing persistence. Drawings are instrument-level and should be listed by Instrument, not only by Trade ID. Keep point arrays serialized in the store layer and exposed as `ChartDrawing` domain objects.

Use `tests/drawing-store.test.ts` when changing drawing save/list/delete behavior.

## Candlestick Store

`src/server/candlestick-store.ts` is the local Candlestick Cache. It is not the authoritative market archive; OKX remains the Market Data Source. Cache keys must include Instrument, Review Timeframe, and timestamp.

## Source Workbook Import

`src/server/trade-import.ts` is the only code that reads the Source Workbook. It uses `xlsx`, reads the named sheet when present and falls back to sheet index 1, converts rows into `Trade`, filters incomplete rows, and sorts by `entryTime`.

Keep these import contracts stable:

- Trade IDs are SHA-256 hashes of sequence, instrument, entry time, exit time, direction, entry price, exit price, and profit.
- Imported times are Shanghai ISO strings with `+08:00`.
- Excel serial dates round seconds to the nearest minute before formatting.
- Missing numeric fields default only where the `Trade` contract allows defaults; core fields must be present or the row is skipped.

`tests/trade-import.test.ts` loads the real workbook and verifies row count, first trade fields, stable ID length, stable ID repeatability, and entry-time ordering.

## Encoding Risk

The current checkout contains mojibake for many Chinese workbook headers and literals. Do not rename these keys casually: they are part of the current parser/test contract. A proper encoding cleanup should update source, tests, and workbook references together.