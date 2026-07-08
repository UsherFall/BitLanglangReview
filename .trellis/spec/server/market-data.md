# Market Data

## OKX Instrument List

`src/server/okx-instrument-service.ts` and `src/server/free-replay-instruments.ts` provide the Free Replay Instrument List from OKX public SWAP instruments. Free Replay should not be limited to instruments present in the Source Workbook.

When changing this flow, keep the domain language as Instrument and preserve `BTC-USDT-SWAP` style futures symbols.

## Candlestick Service

`src/server/candlestick-service.ts` is the service boundary between the local Candlestick Cache and OKX history candles. It accepts an Instrument, Review Timeframe, anchor timestamp in milliseconds, direction (`earlier` or `later`), and limit.

Behavior to preserve:

- Return contiguous cached candles when enough are present.
- Fetch OKX history only when the contiguous cache is insufficient.
- Save fetched candles to the cache, then return from the cache path.
- For `later` requests, map intra-candle anchors to the containing candlestick boundary before calculating the OKX `after` parameter.
- Treat daily candles with the existing Shanghai/UTC offset handling in `boundaryAnchor`.
- Do not return later candles if the first candle after the anchor is missing; gaps break contiguity.

Coverage is in `tests/candlestick-cache.test.ts`.

## API Windowing

`src/server/app-plugin.ts` builds the initial Review Window by fetching 150 earlier and 150 later candlesticks around the entry time, then merges by timestamp. On-demand requests use `mode=earlier` or `mode=later` with an anchor.

Do not preload all history. The product contract is On-Demand Candlestick Loading with cache reuse.

## Error Handling

`defaultFetchJson` aborts OKX requests after 12 seconds and throws when the response is not OK. Route handlers convert service failures to HTTP 502 so the UI can show loading failure status without crashing.