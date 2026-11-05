# Quality review — 2026-11-05

## Verdict

Implementation matches the approved design and the main regression scenarios are well covered. Do not commit/archive yet: complete one small Interface hardening fix and correct the quality-gate evidence.

## Independent verification

- Focused: 5 files / 114 tests passed (`chart-market-context`, `free-replay-chart`, `other-coin-chart`, `app-free-replay`, `chart-time`).
- Full: 76 files / 693 tests passed.
- `npx tsc --noEmit`: passed.
- `git diff HEAD --check`: FAILED with exit 2, 70 CRLF-related trailing-whitespace lines in `src/domain/candlestick.ts` and `src/ui/free-replay-chart.ts`.
- `git -c core.whitespace=cr-at-eol diff HEAD --check`: passed with no output. This confirms the reported whitespace is CR-at-EOL handling, not extra spaces in the code.
- No server, dependency, SQLite or unrelated product changes found. No runtime circular dependency found in the new mapping Module.
- `trellis-check` sub-agent could not start (`spawn pi ENOENT`); review was performed in the main session instead.

## P2 — Include requestSource in OtherCoinChart's data identity

File: `src/ui/OtherCoinChart.tsx:229`

Current:

```ts
const anchorKey = `${venue}:${isReplay ? `${instrument}:${timeframe}` : `${instrument}:${timeframe}:${entryTime}`}`;
```

`binance` and `binance-only` intentionally share `venue=binance` but have different request policies. If a caller rerenders from one to the other with the same instrument/timeframe/entry, `anchorKey` and the initial-load effect dependencies stay unchanged. The old Candlestick window can therefore survive a request-policy change.

Current App Replay sources do not offer both values within one Session, so this is a latent Interface issue rather than a reproduced user-facing regression. It is still directly owned by this task: the new abstraction separates venue and requestSource, so the data identity must include the latter.

Required fix:

- Build `anchorKey` from `requestSource` instead of `venue` (or include both). Using requestSource preserves venue changes too and distinguishes both Binance policies.
- Update the nearby comment: requestSource decides the Candlestick response/policy; venue alone is only the Instrument List vocabulary.
- Add an `OtherCoinChart` rerender regression with identical entry/instrument/timeframe: `binance` → `binance-only`. Assert two initial Candlestick loads, the first with `source=binance`, the second with `source=binance-only`. The Instrument List should not need a second load because venue remains Binance.
- Confirm the new test fails before the anchorKey change and passes after it.

## Quality-gate evidence correction

The PRD currently says “focused 4 files / 52 tests” and “staged diff check passed”. Both are inaccurate in the independent run:

- focused is 5 files / 114 tests;
- plain `git diff HEAD --check` exits 2 on the CRLF files.

The repository has `core.autocrlf=input`; the two files are CRLF. Do not normalize whole files and create a giant line-ending diff. Configure Git to recognize CR-at-EOL correctly (for example local repo config `git config core.whitespace cr-at-eol`) or use the documented equivalent, then run the plain acceptance command `git diff HEAD --check` and record its real exit code. Do not hide the failure or delete the check.

Recheck AC7 only after the anchorKey regression, focused/full tests, type check and the plain diff check all pass.

## Operational note

The work is still on `master` while `base_branch=master`. Trellis already warned that archive will refuse this. Create/record the feature branch before the focused commit and archive:

```bash
git switch -c feat/replay-market-context
python3 ./.trellis/scripts/task.py set-branch .trellis/tasks/11-05-replay-market-context feat/replay-market-context
```

If a branch was intentionally created by the executor, inspect and record that actual branch instead of recreating it.

## What looks good

- The exhaustive mapping is small, pure and typed; `binance` and `binance-only` remain distinct.
- All five FreeReplayChart Candlestick request sites route through the same mapping without changing effect ordering or chart protocols.
- App now passes the active Session source to Other Coin Panel.
- The App composition test distinguishes pre-open and post-open requests and would catch the original OKX/legacy defect.
- The UTC 1D test uses independent literal time calculations rather than calling the code under test.
- Existing non-Replay `binance` assertions and server behavior remain unchanged.
