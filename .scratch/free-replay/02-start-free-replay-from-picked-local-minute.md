# Start Free Replay from a picked local minute

## What to build

Let the reviewer choose a Free Replay Start Time with a date-time picker and start a Free Replay for the selected Instrument. The start time is local, minute-level, and maps to the Candlestick in the active Review Timeframe whose time range contains that minute.

## Acceptance criteria

- [ ] Free Replay uses an open-source date-time picker configured for local date and minute selection.
- [ ] The picker supports choosing both date and time without second-level precision.
- [ ] Starting Free Replay loads the containing Candlestick for the selected local minute.
- [ ] The first revealed Candlestick becomes the Free Replay Cursor.
- [ ] Invalid or missing Instrument/start-time inputs are handled without starting a replay.
- [ ] Tests cover mapping an arbitrary local minute to the containing Candlestick for supported Review Timeframes.

## Blocked by

- 01-free-replay-mode-shell-and-okx-swap-picker
