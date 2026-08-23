# Implementation Plan

## Steps

1. Extend `src/ui/review-progress.ts`:
   - Add `reviewedProfit` to `ReviewProgress`.
   - Sum `profit` for trades where `isReviewedTrade(trade)` is true.

2. Update progress tests:
   - Adjust existing `reviewProgress` expectations for the new field.
   - Add a case proving note-only trades do not contribute profit.
   - Add positive/negative profit examples.

3. Update `src/ui/App.tsx` Review Progress UI:
   - Render `“—∏¥≈Ã ’“Ê` beside the existing current/reviewed metrics.
   - Format signed USDT with two decimals.
   - Apply positive/negative/neutral tone class.
   - Ensure `handleReviewSaved` still triggers updated progress and profit.

4. Update app-level progress tests:
   - Assert initial reviewed profit display.
   - Assert saving Review Tags updates reviewed count and reviewed profit.

5. Add Trade Review keyboard panning:
   - Add a `useEffect` in `TradeChart` for `keydown`.
   - Ignore input/select/textarea targets.
   - For `ArrowRight` / `ArrowLeft`, pan `getVisibleRange()` by `timeframeMs(timeframe) / 1000` using `setVisibleRange()`.
   - Do not modify candle loading or rendering state.

6. Add or update chart keyboard tests:
   - Mock lightweight-charts `getVisibleRange` and `setVisibleRange`.
   - Assert ArrowRight pans forward one timeframe step.
   - Assert ArrowLeft pans backward one timeframe step.
   - Assert keydown from form controls is ignored.
   - Keep Free Replay test coverage passing.

7. Styling pass:
   - Adjust `.review-progress` layout if needed so three metrics plus button fit without overlap.
   - Reuse existing `.good` / `.bad` semantics where possible.

## Validation

Run:

```bash
npm.cmd test
```

Use `npm.cmd` on this machine because PowerShell blocks `npm.ps1` by execution policy.

## Risk Points

- `lightweight-charts` mocks in existing tests may need to expose stable `getVisibleRange` / `setVisibleRange` functions for assertions.
- Programmatic `setVisibleRange` from keyboard should not toggle `suppressAutoLoadRef`, or on-demand loading will not trigger at edges.
- Review Progress expectations in existing tests must be updated everywhere because the return shape gains `reviewedProfit`.

## Review Gate

Before `task.py start`, confirm with the user that the PRD and design match intent. Do not implement before approval.
