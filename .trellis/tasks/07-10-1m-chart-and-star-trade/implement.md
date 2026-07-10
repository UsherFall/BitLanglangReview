# Implementation Plan

## Ordered Checklist

### Step 1: R1 — 1m Timeframe (domain + time utils)

- [ ] `src/domain/trade.ts:25` — Add `'1m'` to `ReviewTimeframe` type union
- [ ] `src/domain/trade.ts:27` — Add `'1m'` to `reviewTimeframes` array (first element)
- [ ] `src/ui/chart-time.ts:42` — Add `'1m': 60_000` to `timeframeMs` map
- [ ] `src/server/candlestick-service.ts:107` — Add `'1m': 60_000` to `timeframeMs` map
- [ ] Verify: `npm run build` — TypeScript compiles without errors (exhaustive switch checks)
- [ ] `tests/chart-time.test.ts` — Add 1m placement tests (entry, free replay cursor, timeframe switch)
- [ ] Verify: `npm test` — all existing tests pass

### Step 2: R2 — Star/Favorite (data layer)

- [ ] `src/domain/review.ts` — Add `starred: boolean` to `TradeReview`
- [ ] `src/server/review-store.ts` — Add `starred` column migration (ALTER TABLE with try/catch)
- [ ] `src/server/review-store.ts` — Update `saveReview` to accept and persist `starred`
- [ ] `src/server/review-store.ts` — Update `toReview` to read `starred` column
- [ ] `src/domain/review-queue.ts` — Add `starred?: 'yes' | 'no'` to `ReviewQueueOptions`
- [ ] `src/domain/build-review-queue.ts` — Add starred filter in `matchesOptions`
- [ ] `src/server/app-plugin.ts` — POST `/api/reviews`: accept `starred` in body
- [ ] `src/server/app-plugin.ts` — GET `/api/trades`: parse `starred` param in `toQueueOptions`
- [ ] `tests/review-store.test.ts` — Add starred save/load test
- [ ] `tests/review-queue.test.ts` — Add starred filter test
- [ ] Verify: `npm test`

### Step 3: R2 — Star/Favorite (UI)

- [ ] `src/ui/App.tsx` — Add star toggle button (★/☆) on each trade row, with optimistic UI update
- [ ] `src/ui/App.tsx` — Add "已收藏" filter select (全部 / 已收藏 / 未收藏)
- [ ] Verify: `npm run build`
- [ ] Verify: manual smoke test — click star, refresh, star persists

### Step 4: R3 — Tags Combobox

- [ ] `src/ui/ReviewEditor.tsx` — Replace tags text input with custom combobox component
  - [ ] Input field with dropdown
  - [ ] Filter existing tags by input text
  - [ ] "Create new tag" option when no match
  - [ ] Selected tags as removable chips
  - [ ] Keep existing save behavior (comma-separated in POST body unchanged)
- [ ] `tests/review-editor.test.tsx` — Add combobox interaction tests
- [ ] Verify: `npm run build && npm test`

### Step 5: Final Check

- [ ] `npm test` — all tests pass
- [ ] `npm run build` — no TypeScript errors
- [ ] Manual: 1m chart loads, star toggle works, tags combobox works

---

## Validation Commands

```bash
npm run build          # TypeScript check
npm test               # All tests
npx vitest run --reporter=verbose  # Detailed test output
```

## Risky Files

| File | Risk | Why |
|------|------|-----|
| `src/server/review-store.ts` | Medium | DB schema change — migration must be idempotent |
| `src/ui/App.tsx` | Medium | Large file (~1200 lines), multiple changes may conflict |
| `src/domain/trade.ts` | Low | Type change — compiler catches all missing cases |

## Rollback Points

- After Step 1: R1 is standalone, can revert independently
- After Step 2: R2 data layer is backward-compatible (starred defaults to false)
- After Step 3-4: UI changes, revert by reverting files
