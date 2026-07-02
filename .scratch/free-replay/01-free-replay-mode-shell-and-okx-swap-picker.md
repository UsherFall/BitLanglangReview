# Add Free Replay mode shell and OKX SWAP instrument picker

## What to build

Add a Free Replay mode alongside Trade Review. The reviewer can switch from the review queue into Free Replay, load selectable instruments from OKX public SWAP instruments, choose one instrument, and see an empty ready state for starting a replay without selecting a Trade.

## Acceptance criteria

- [ ] The UI has a clear mode switch between Trade Review and Free Replay.
- [ ] Trade Review keeps the existing Review Queue behavior.
- [ ] Free Replay does not require or select a Trade.
- [ ] Free Replay loads selectable Instruments from OKX public SWAP instruments.
- [ ] The first version limits Free Replay selection to SWAP instruments.
- [ ] Loading and failure states for the instrument list are visible and recoverable.
- [ ] Tests cover the instrument-list API behavior and the mode switch preserving Trade Review behavior.

## Blocked by

None - can start immediately
