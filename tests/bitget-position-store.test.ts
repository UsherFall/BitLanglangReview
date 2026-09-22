import { describe, expect, it } from 'vitest';
import { BitgetPositionStore } from '../src/server/bitget-position-store';
import type { BitgetHistoryPosition } from '../src/domain/bitget-position';

const rowA: BitgetHistoryPosition = {
  symbol: 'BTCUSDT',
  holdSide: 'long',
  openAvgPrice: '100',
  closeAvgPrice: '110',
  openTotalPos: '0.1',
  closeTotalPos: '0.1',
  pnl: '1',
  netProfit: '0.9',
  totalFunding: '0',
  openFee: '-0.05',
  closeFee: '-0.05',
  ctime: '1700000000000',
  utime: '1700000600000',
};

const rowB: BitgetHistoryPosition = {
  ...rowA,
  symbol: 'ETHUSDT',
  holdSide: 'short',
  ctime: '1700001000000',
  utime: '1700001600000',
};

function cached(row: BitgetHistoryPosition, id: string) {
  return { id, row, ctime: Number(row.ctime), utime: Number(row.utime), fetchedAt: '2026-09-06T00:00:00.000Z' };
}

describe('Bitget Position Store', () => {
  it('upserts rows idempotently and lists them by open time', () => {
    const store = new BitgetPositionStore(':memory:');
    store.upsertRows([cached(rowA, 'id-a'), cached(rowB, 'id-b')]);
    expect(store.listAll().map((item) => item.id)).toEqual(['id-a', 'id-b']);

    // Re-inserting the same ids refreshes instead of duplicating.
    store.upsertRows([cached(rowA, 'id-a')]);
    expect(store.listAll()).toHaveLength(2);
  });

  it('reports the newest close time for incremental sync decisions', () => {
    const store = new BitgetPositionStore(':memory:');
    expect(store.maxUtime()).toBeNull();
    store.upsertRows([cached(rowA, 'id-a'), cached(rowB, 'id-b')]);
    expect(store.maxUtime()).toBe(1700001600000);
  });

  it('upserts orders idempotently and groups them by symbol in traded order', () => {
    const store = new BitgetPositionStore(':memory:');
    const base = {
      symbol: 'BTCUSDT',
      posSide: 'long' as const,
      side: 'open' as const,
      qty: 1,
      price: 100,
      fee: -0.05,
      profit: 0,
      source: 'market',
      leverage: 30,
      placedAt: 1699999999999,
      fetchedAt: '2026-09-22T00:00:00.000Z',
    };
    store.upsertOrders([
      { ...base, orderId: 'o-2', tradedAt: 1700000200000, symbol: 'ETHUSDT' },
      { ...base, orderId: 'o-1', tradedAt: 1700000100000 },
    ]);
    store.upsertOrders([{ ...base, orderId: 'o-2', tradedAt: 1700000200000, symbol: 'ETHUSDT' }]);

    const grouped = store.listOrdersBySymbol();
    expect([...grouped.keys()].sort()).toEqual(['BTCUSDT', 'ETHUSDT']);
    expect(grouped.get('BTCUSDT')?.map((order) => order.orderId)).toEqual(['o-1']);
    expect(grouped.get('ETHUSDT')?.[0].leverage).toBe(30);
    expect(store.maxOrderTradedAt()).toBe(1700000200000);
  });

  it('deletes cached orders inside a traded-time range', () => {
    const store = new BitgetPositionStore(':memory:');
    const base = {
      symbol: 'BTCUSDT',
      posSide: 'long' as const,
      side: 'open' as const,
      qty: 1,
      price: 100,
      fee: -0.05,
      profit: 0,
      source: 'market',
      leverage: null,
      placedAt: null,
      fetchedAt: '2026-09-22T00:00:00.000Z',
    };
    store.upsertOrders([
      { ...base, orderId: 'o-1', tradedAt: 1700000100000 },
      { ...base, orderId: 'o-2', tradedAt: 1700000900000 },
    ]);
    expect(store.deleteOrdersByTime(1700000000000, 1700000500000)).toBe(1);
    expect(store.listOrdersBySymbol().get('BTCUSDT')?.map((order) => order.orderId)).toEqual(['o-2']);
  });

  it('deletes rows inside a time range', () => {
    const store = new BitgetPositionStore(':memory:');
    store.upsertRows([cached(rowA, 'id-a'), cached(rowB, 'id-b')]);
    const deleted = store.deleteByTime(1699999000000, 1700000500000);
    expect(deleted).toBe(1);
    expect(store.listAll().map((item) => item.id)).toEqual(['id-b']);
  });
});
