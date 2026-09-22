import { describe, expect, it } from 'vitest';
import type { BitgetOrder } from '../src/domain/bitget-order';
import { ordersForRound, type ClosedRound } from '../src/domain/bitget-round-orders';

const T0 = 1789972881497;

function order(overrides: Partial<BitgetOrder> & { orderId: string; tradedAt: number }): BitgetOrder {
  return {
    symbol: 'BTCUSDT',
    posSide: 'long',
    side: 'open',
    qty: 1,
    price: 100,
    fee: -0.1,
    profit: 0,
    source: 'market',
    leverage: 30,
    placedAt: overrides.tradedAt - 20,
    ...overrides,
  };
}

/** Shapes one round + its orders from the verified real sequences. */
function roundOf(orders: BitgetOrder[]): ClosedRound {
  const last = orders[orders.length - 1];
  return {
    symbol: 'BTCUSDT',
    holdSide: 'long',
    ctime: orders[0].tradedAt - 16,
    utime: last.tradedAt + 24,
    openTotalPos: orders.filter((o) => o.side === 'open').reduce((t, o) => t + o.qty, 0),
    closeTotalPos: orders.filter((o) => o.side === 'close').reduce((t, o) => t + o.qty, 0),
  };
}

describe('ordersForRound', () => {
  it('matches the add / partial-close / add-again / flatten round', () => {
    // Verified against a real round: open .0029 -> add .0039 -> close .0029
    // -> add .0044 -> close .0083 (openTotalPos = closeTotalPos = 0.0112).
    const orders = [
      order({ orderId: 'o1', tradedAt: T0, side: 'open', qty: 0.0029, price: 80400.1 }),
      order({ orderId: 'o2', tradedAt: T0 + 47_957_000, side: 'open', qty: 0.0039, price: 81508.3, source: 'normal' }),
      order({ orderId: 'o3', tradedAt: T0 + 50_848_000, side: 'close', qty: 0.0029, price: 81145.2, source: 'loss_market', profit: 0.3176 }),
      order({ orderId: 'o4', tradedAt: T0 + 66_035_000, side: 'open', qty: 0.0044, price: 81543.7 }),
      order({ orderId: 'o5', tradedAt: T0 + 66_223_000, side: 'close', qty: 0.0083, price: 81390, source: 'loss_market', profit: -1.15 }),
    ];

    const matched = ordersForRound(roundOf(orders), orders);

    expect(matched?.map((item) => item.orderId)).toEqual(['o1', 'o2', 'o3', 'o4', 'o5']);
  });

  it('matches a round closed in two halves', () => {
    const orders = [
      order({ orderId: 'h1', tradedAt: T0, qty: 0.0198, price: 75450 }),
      order({ orderId: 'h2', tradedAt: T0 + 13_236_000, side: 'close', qty: 0.0099, price: 76079.8 }),
      order({ orderId: 'h3', tradedAt: T0 + 13_897_000, side: 'close', qty: 0.0099, price: 75928.9 }),
    ];

    expect(ordersForRound(roundOf(orders), orders)?.map((item) => item.orderId)).toEqual(['h1', 'h2', 'h3']);
  });

  it('matches a round built from two consecutive opens', () => {
    const orders = [
      order({ orderId: 'a1', tradedAt: T0, qty: 0.0013, price: 79938.2 }),
      order({ orderId: 'a2', tradedAt: T0 + 53_622, qty: 0.0021, price: 80258.2 }),
      order({ orderId: 'a3', tradedAt: T0 + 1_564_000, side: 'close', qty: 0.0034, price: 80462.4, profit: 1.1103 }),
    ];

    expect(ordersForRound(roundOf(orders), orders)?.map((item) => item.orderId)).toEqual(['a1', 'a2', 'a3']);
  });

  it('stops at the previous round instead of absorbing its orders', () => {
    const previous = [
      order({ orderId: 'p1', tradedAt: T0 - 500_000, qty: 0.005, price: 75000 }),
      order({ orderId: 'p2', tradedAt: T0 - 400_000, side: 'close', qty: 0.005, price: 75100 }),
    ];
    const current = [
      order({ orderId: 'c1', tradedAt: T0, qty: 0.0029, price: 80400.1 }),
      order({ orderId: 'c2', tradedAt: T0 + 60_000, side: 'close', qty: 0.0029, price: 81145.2 }),
    ];

    const matched = ordersForRound(roundOf(current), [...previous, ...current]);

    expect(matched?.map((item) => item.orderId)).toEqual(['c1', 'c2']);
  });

  it('ignores orders from the next round and the other hold side', () => {
    const current = [
      order({ orderId: 'c1', tradedAt: T0, qty: 0.0029, price: 80400.1 }),
      order({ orderId: 'c2', tradedAt: T0 + 60_000, side: 'close', qty: 0.0029, price: 81145.2 }),
    ];
    const noise = [
      order({ orderId: 'n1', tradedAt: T0 + 900_000, qty: 0.01, price: 82000 }),
      order({ orderId: 'n2', tradedAt: T0 + 30_000, posSide: 'short', qty: 0.5, price: 81000 }),
      order({ orderId: 'n3', tradedAt: T0 + 30_000, symbol: 'ETHUSDT', qty: 0.5, price: 2600 }),
    ];

    const matched = ordersForRound(roundOf(current), [...current, ...noise]);

    expect(matched?.map((item) => item.orderId)).toEqual(['c1', 'c2']);
  });

  it('returns null when a needed order is missing from the window', () => {
    const round: ClosedRound = {
      symbol: 'BTCUSDT',
      holdSide: 'long',
      ctime: T0 - 16,
      utime: T0 + 60_000 + 24,
      openTotalPos: 0.0029,
      closeTotalPos: 0.0029,
    };
    // Only the close survived the window; the open is outside the fetched range.
    const orders = [order({ orderId: 'c2', tradedAt: T0 + 60_000, side: 'close', qty: 0.0029, price: 81145.2 })];

    expect(ordersForRound(round, orders)).toBeNull();
  });

  it('returns null when the totals disagree with the exchange row', () => {
    const orders = [
      order({ orderId: 'c1', tradedAt: T0, qty: 0.0029, price: 80400.1 }),
      order({ orderId: 'c2', tradedAt: T0 + 60_000, side: 'close', qty: 0.0029, price: 81145.2 }),
    ];
    const round = { ...roundOf(orders), closeTotalPos: 0.003 };

    expect(ordersForRound(round, orders)).toBeNull();
  });

  it('returns null when there is nothing to match', () => {
    const round: ClosedRound = {
      symbol: 'BTCUSDT',
      holdSide: 'long',
      ctime: T0,
      utime: T0 + 1000,
      openTotalPos: 1,
      closeTotalPos: 1,
    };

    expect(ordersForRound(round, [])).toBeNull();
  });
});
