# Frontend Specs

Guidance for `src/ui`, the React application, chart integration, and UI-facing helpers.

## Read These Files

| Guide | Use When |
| --- | --- |
| [Directory Structure](./directory-structure.md) | Adding or moving UI files |
| [Component Guidelines](./component-guidelines.md) | Building React components or chart overlays |
| [Hook Guidelines](./hook-guidelines.md) | Adding effects, refs, or shared stateful logic |
| [State Management](./state-management.md) | Changing trade review, free replay, chart, or drawing state |
| [Quality Guidelines](./quality-guidelines.md) | Verifying UI behavior and tests |
| [Type Safety](./type-safety.md) | Defining UI-local types or API payload shapes |

## Layer Shape

The frontend owns the reviewer experience and browser-only state. It imports domain types and pure helpers from `src/domain`, calls Vite middleware routes in `src/server/app-plugin.ts`, and renders charts through `lightweight-charts`.

Representative files:

- `src/ui/App.tsx` coordinates trade review, free replay, chart rendering, drawing overlays, and API calls.
- `src/ui/ReviewEditor.tsx` edits review tags and the single review note for a trade.
- `src/ui/FreeReplayPanel.tsx` chooses an OKX swap instrument and local start time.
- `src/ui/chart-time.ts`, `src/ui/chart-autoload.ts`, `src/ui/chart-navigation-anchor.ts`, and `src/ui/free-replay-chart.ts` keep chart math testable outside React.

## Verification

Run `npm test` after behavior changes. For narrow UI-helper changes, the focused tests under `tests/*chart*.test.ts`, `tests/free-replay*.test.ts`, and `tests/review-editor.test.tsx` are the closest examples.