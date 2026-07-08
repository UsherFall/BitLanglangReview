# Type Safety

## Type Sources

Domain types are defined in `src/domain` and should be imported into UI and server code instead of duplicated:

- `Trade`, `Direction`, `ReviewTimeframe`, and `reviewTimeframes` in `src/domain/trade.ts`.
- `TradeReview` in `src/domain/review.ts`.
- `ReviewedTrade`, `ReviewQueueOptions`, and sort types in `src/domain/review-queue.ts`.
- `Candlestick` in `src/domain/candlestick.ts`.
- `ChartDrawing`, `ChartPoint`, and `SaveChartDrawingInput` in `src/domain/drawing.ts`.

UI-local payload types are acceptable at the API boundary when the server returns a composed payload. `TradeResponse` in `App.tsx` and `InstrumentResponse` in `FreeReplayPanel.tsx` are examples.

## Runtime Validation

There is no schema validation library. Runtime validation happens manually at boundaries:

- `src/server/app-plugin.ts` checks required query fields and `reviewTimeframes.includes(timeframe)` before loading candles.
- `src/server/trade-import.ts` converts workbook rows with `toString`, `toNumber`, `toDirection`, and `toShanghaiIso`, returning `null` for incomplete rows.
- UI code treats API responses as typed after `response.json()`, so server route tests are important when changing payloads.

## Type Assertions

Keep assertions narrow and close to the boundary. Examples that fit the current style are casting query string values to `ReviewQueueOptions` fields in `toQueueOptions`, casting JSON responses to local payload types after `fetch`, and adapting `flatpickr` to the limited `{ close; destroy }` shape used by the component.

Avoid broad `any`. If external data has unknown shape, parse it into a domain type in the server layer before exposing it to the UI.

## Time And Price Types

Market timestamps use milliseconds in domain/server candlesticks and seconds where `lightweight-charts` expects `UTCTimestamp`. Keep conversions explicit at chart boundaries, as in `chartDataWithWhitespace`, `tradeMarkers`, and the Free Replay cursor helpers.

Review times from the Source Workbook use Shanghai ISO strings with `+08:00`. Do not replace them with local browser dates or UTC-only strings unless every caller and test is updated.