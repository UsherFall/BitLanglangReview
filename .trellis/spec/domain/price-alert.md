# Price Alert (价格警报)

## 1. Scope / Trigger

The 选币 (Coin Scan) module lets the user set manual price alerts on watched instruments (上破 / 下破). This contract covers the pure domain in `src/domain/price-alert.ts`: the `PriceAlert` type, `AlertDirection`, `AlertStatus`, and the deterministic trigger predicate `isAlertTriggered`. Persistence lives in the Alert Store (`persistence-and-imports.md`), monitoring in `AlertMonitor`, notification in the Server酱 notifier, and routes under `/api/alerts` (`api-plugin.md`).

## 2. Signatures

```ts
export type AlertDirection = 'above' | 'below';
export type AlertStatus = 'active' | 'triggered';
export type PriceAlert = {
  id: number;
  instrument: string;          // BTC-USDT-SWAP
  direction: AlertDirection;
  targetPrice: number;
  status: AlertStatus;
  createdAt: string;           // ISO
  triggeredAt: string | null;
};
export function isAlertTriggered(alert: PriceAlert, currentPrice: number): boolean;
```

## 3. Contracts

Trigger predicate rules (all must hold to return true):

- Status must be `active`; a `triggered` alert never re-triggers (status flow is one-way until `reactivate`).
- `above`: `currentPrice >= targetPrice`.
- `below`: `currentPrice <= targetPrice`.
- Equality triggers in both directions; this is documented behavior, not a boundary error.

## 4. Validation & Error Matrix

`isAlertTriggered` is total: any `alert` + finite `currentPrice` returns a boolean; no throw. The domain layer must not import React, Vite, filesystem, SQLite, or `fetch`.

## 5. Good/Base/Bad Cases

- **Good**: `above` alert, `currentPrice 101` vs `targetPrice 100` → `true`. `below` alert, `currentPrice 99` vs `targetPrice 100` → `true`.
- **Base**: equality `above` `currentPrice 100` vs `targetPrice 100` → `true` (equal triggers).
- **Bad**: `triggered` status with price past target → `false`; `above` alert with `currentPrice 90` vs `100` → `false`.

## 6. Tests Required

`tests/price-alert.test.ts` must cover: above trigger, below trigger, equality trigger, non-triggering side, and `triggered` status never firing again.

## 7. Wrong vs Correct

#### Wrong

A `triggered` alert with the price still past the target re-fires every monitor tick, spamming the notifier.

#### Correct

`isAlertTriggered` returns `false` for any non-`active` alert. `AlertMonitor` marks the alert triggered before sending, so a repeat tick on the same alert cannot re-push; re-enabling is an explicit user action.
