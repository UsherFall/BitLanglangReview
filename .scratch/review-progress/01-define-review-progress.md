# Define Review Progress for the current Review Queue

## What to build

Define Review Progress for Trade Review. In the current Review Queue, a Trade counts as reviewed only when it has at least one Review Tag. A Review Note alone does not mark a Trade as reviewed. The progress model should report the current queue total, reviewed count, and selected Trade position so later UI and navigation can share one rule.

## Acceptance criteria

- [ ] `CONTEXT.md` defines Review Progress using the existing Trade, Review Queue, Review Tag, and Review Note language.
- [ ] A Trade with at least one Review Tag counts as reviewed.
- [ ] A Trade with only a Review Note and no Review Tag does not count as reviewed.
- [ ] Review Progress reports `total`, `reviewed`, and `current` for the current Review Queue.
- [ ] If the selected Trade is not in the current Review Queue, `current` is `0`.
- [ ] Tests cover tagged, note-only, unreviewed, selected, and missing-selected cases.

## Blocked by

- None - can start immediately
