import type { BitgetOrder } from './bitget-order';

/**
 * A closed position cycle as Bitget reports it (one `history-position` row):
 * the cycle started at `ctime`, finished at `utime`, and traded
 * `openTotalPos` in / `closeTotalPos` out — both **cumulative**, so adds and
 * partial closes are already summed in.
 */
export type ClosedRound = {
  symbol: string;
  holdSide: 'long' | 'short';
  ctime: number;
  utime: number;
  openTotalPos: number;
  closeTotalPos: number;
};

const EPSILON = 1e-6;
/** Orders are matched by fill time, and a round's `utime` trails its final
 * close by ~24ms (measured), so allow a small slack above it. Kept short so
 * the next round's orders (usually minutes later) can never leak in. */
const UPPER_SLACK_MS = 5_000;

/**
 * Picks the filled orders that make up one closed round, or `null` when the
 * answer cannot be proven.
 *
 * A round is defined by the position returning to flat, so the orders are
 * walked **backwards from the end**: a close adds to the running size, an open
 * subtracts, and the round starts where the running size hits zero. Walking
 * past that zero would mean stepping into the previous round, so the walk stops
 * there. Matches are only accepted when both cumulative totals agree with the
 * exchange's own `openTotalPos` / `closeTotalPos`; anything else returns `null`
 * so callers fall back to a two-point display instead of plotting wrong points.
 */
export function ordersForRound(round: ClosedRound, orders: readonly BitgetOrder[]): BitgetOrder[] | null {
  const candidates = orders
    .filter(
      (order) =>
        order.symbol === round.symbol &&
        order.posSide === round.holdSide &&
        order.tradedAt <= round.utime + UPPER_SLACK_MS,
    )
    .slice()
    .sort((a, b) => a.tradedAt - b.tradedAt);

  if (candidates.length === 0) return null;

  const picked: BitgetOrder[] = [];
  let held = 0;
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const order = candidates[index];
    if (order.side === 'close') {
      held += order.qty;
      picked.unshift(order);
      continue;
    }
    // An open with nothing to close belongs to an earlier round.
    if (held <= EPSILON) break;
    held -= order.qty;
    picked.unshift(order);
    if (held <= EPSILON) break;
  }

  // Never returned to flat: the candidate list started mid-round, so this
  // window cannot describe the whole cycle.
  if (picked.length === 0 || held > EPSILON) return null;

  const openSum = sumQty(picked, 'open');
  const closeSum = sumQty(picked, 'close');
  if (!closeEnough(openSum, round.openTotalPos) || !closeEnough(closeSum, round.closeTotalPos)) return null;

  return picked;
}

function sumQty(orders: readonly BitgetOrder[], side: 'open' | 'close'): number {
  return orders.reduce((total, order) => (order.side === side ? total + order.qty : total), 0);
}

function closeEnough(a: number, b: number): boolean {
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) <= EPSILON * scale;
}
