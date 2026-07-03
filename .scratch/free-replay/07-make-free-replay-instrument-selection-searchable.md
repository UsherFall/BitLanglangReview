# Make Free Replay instrument selection searchable

## What to build

Make the Free Replay Instrument selector searchable so the reviewer can quickly find an OKX SWAP instrument from a large list. The selector should keep the current OKX SWAP source, support keyboard-friendly filtering, and still submit a single selected Instrument into the Free Replay Session.

## Acceptance criteria

- [ ] The Free Replay Instrument selector supports typing to filter instruments.
- [ ] Filtering matches common instrument text such as `BTC`, `USDT`, and `BTC-USDT-SWAP`.
- [ ] The reviewer can choose one filtered instrument with keyboard or pointer input.
- [ ] The selected Instrument is used when starting Free Replay.
- [ ] Loading and failure states remain clear while instruments are fetched.
- [ ] Tests cover filtering and starting Free Replay with the selected filtered Instrument.

## Blocked by

- 01-free-replay-mode-shell-and-okx-swap-picker
