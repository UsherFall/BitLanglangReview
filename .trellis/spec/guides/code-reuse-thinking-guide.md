# Code Reuse Thinking Guide

Use this guide before adding helpers, constants, parsing branches, or another copy of logic that already exists in the Trading Review app.

## Search First

Before creating a new utility, search for the concept and the exact value you are about to change.

Useful searches:

```bash
rg "reviewTimeframes|timeframeMs|freeReplayCursor|entryVisibleRange" src tests
rg "mergeCandles|timestamp" src/ui src/server tests
rg "ReviewQueueOptions|buildReviewQueue|reviewProgress" src tests
rg "URLSearchParams|/api/candles|/api/trades" src tests
```

## Reuse Existing Owners

Prefer the current ownership boundaries:

| Concern | Existing Owner |
| --- | --- |
| Review Timeframe list | `src/domain/trade.ts` |
| Queue filtering and sorting | `src/domain/build-review-queue.ts` |
| Review Progress and next unreviewed trade | `src/ui/review-progress.ts` |
| Entry/exit marker placement | `src/ui/trade-markers.ts` |
| Chart time, timeframe boundaries, Free Replay cursor mapping | `src/ui/chart-time.ts` |
| On-demand load thresholds | `src/ui/chart-autoload.ts` |
| Navigation anchor restoration | `src/ui/chart-navigation-anchor.ts` |
| Free Replay visible/reveal/rewind logic | `src/ui/free-replay-chart.ts` |
| Workbook row parsing and Trade IDs | `src/server/trade-import.ts` |
| Review persistence | `src/server/review-store.ts` |
| Candlestick cache and OKX fetch boundary | `src/server/candlestick-service.ts` and `src/server/candlestick-store.ts` |

## Duplication Traps

Avoid creating a second version of these rules:

- Supported Review Timeframes. Import `reviewTimeframes`; do not hand-write another list.
- Timeframe duration math. Use or extend existing chart/server helpers carefully and add tests.
- Candle merging by timestamp. Both chart and server need sorted, de-duplicated candles; keep behavior explicit and tested.
- Queue filters. The UI should request `/api/trades`; it should not locally re-filter the authoritative queue.
- Reviewed status. Tags mark reviewed; notes alone do not.
- Instrument-level drawings. Do not create trade-only drawing logic unless the product language changes.

## When To Extract

Extract a helper when the logic is deterministic and can be tested without React, Vite, SQLite, or network calls. The existing UI chart helpers are good examples: they keep complex chart behavior out of JSX and have focused Vitest coverage.

Do not extract just to hide one small branch. Keep tightly coupled chart API code near the component when it depends on refs, subscriptions, pointer capture, or imperative library objects.

## Verification

After reuse-sensitive changes, run the closest focused tests and then `npm test` when practical. Add or update a test beside the existing pattern rather than relying on manual chart inspection alone.