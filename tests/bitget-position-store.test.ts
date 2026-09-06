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

  it('deletes rows inside a time range', () => {
    const store = new BitgetPositionStore(':memory:');
    store.upsertRows([cached(rowA, 'id-a'), cached(rowB, 'id-b')]);
    const deleted = store.deleteByTime(1699999000000, 1700000500000);
    expect(deleted).toBe(1);
    expect(store.listAll().map((item) => item.id)).toEqual(['id-b']);
  });
});
