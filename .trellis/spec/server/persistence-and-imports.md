# Persistence And Imports

## Review Store

`src/server/review-store.ts` persists one review per trade in `trade_reviews`. It enables SQLite WAL mode, stores tags as JSON, and upserts on `trade_id`.

Keep tag cleanup in the store boundary. `uniqueCleanTags` trims tags, removes empty entries, and preserves first-seen order through `Set`. Existing coverage is `tests/review-store.test.ts`.

## Drawing Store

`src/server/drawing-store.ts` owns Chart Drawing persistence. Drawings are instrument-level and should be listed by Instrument, not only by Trade ID. Keep point arrays serialized in the store layer and exposed as `ChartDrawing` domain objects.

Use `tests/drawing-store.test.ts` when changing drawing save/list/delete behavior.

## Free Replay Session Store

`src/server/free-replay-session-store.ts` persists Free Replay sessions in `free_replay_sessions`. It enables SQLite WAL mode and shares the same `data/review.sqlite` file as the other stores. Upsert key is `(instrument, start_time)`; the payload is stored as opaque JSON in `paper_trading_json`, with `updated_at` written by the server so history sorts deterministically.

When the product requirement is to save Free Replay state, sessions keyed by the same instrument + start time overwrite rather than duplicate. Use `tests/free-replay-session-store.test.ts` when changing save/list/delete behavior.

## Bitget Position Store And Keys

`src/server/bitget-position-store.ts` caches raw Bitget history-position rows in `bitget_positions` on the same `data/review.sqlite` (own handle, WAL, raw SQL). It is a cache of the user's own account data, not an authoritative market archive.

```sql
create table if not exists bitget_positions (
  id text primary key,          -- 'bg-' + sha256(content key)
  raw_json text not null,       -- full Bitget row kept verbatim
  symbol text not null,
  ctime integer not null,       -- open ms
  utime integer not null,       -- close ms
  fetched_at text not null
);
```

- Upsert is by `id`, so repeated syncs never duplicate rows (`upsertRows` bulk transaction).
- `maxUtime()` is the newest close time (incremental-sync seed). `deleteByTime(fromMs, toMs)` exists for explicit full re-sync (`wipe: true`).
- Rows are converted to domain `Trade` objects only at read time by `src/server/bitget-import.ts`; the store never parses `Trade`.

`src/server/bitget-keys.ts` reads/writes `data/bitget-keys.json` (`mode 0o600`, git-ignored via `data/`). It must never be returned by an API response — routes answer only `configured: boolean`. Corrupt/missing file == not configured.

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