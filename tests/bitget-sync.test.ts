import { describe, expect, it, vi } from 'vitest';
import type { BitgetHistoryPosition } from '../src/domain/bitget-position';
import { BitgetPositionStore } from '../src/server/bitget-position-store';
import { BitgetSyncService, type HistoryPositionsReader } from '../src/server/bitget-sync';

function row(symbol: string, ctime: string, holdSide: 'long' | 'short'): BitgetHistoryPosition {
  return {
    symbol,
    holdSide,
    openAvgPrice: '100',
    closeAvgPrice: '110',
    openTotalPos: '1',
    closeTotalPos: '1',
    pnl: '10',
    netProfit: '9.9',
    totalFunding: '0',
    openFee: '-0.05',
    closeFee: '-0.05',
    ctime,
    utime: String(Number(ctime) + 600000),
  };
}

describe('Bitget Sync Service', () => {
  it('fetches, caches, and never duplicates on re-sync', async () => {
    const store = new BitgetPositionStore(':memory:');
    const reader: HistoryPositionsReader = {
      fetchHistoryPositionsPage: vi.fn(async () => [
        row('BTCUSDT', '1700000000000', 'long'),
        row('ETHUSDT', '1700001000000', 'short'),
      ]),
    };
    const service = new BitgetSyncService(reader, store);

    const first = await service.sync({ fromMs: 1700000000000, toMs: 1702600000000 });
    expect(first.fetchedRows).toBe(2);
    expect(store.listAll()).toHaveLength(2);
    expect(store.listAll()[0].id).toMatch(/^bg-[a-f0-9]{64}$/);

    const second = await service.sync({ fromMs: 1700000000000, toMs: 1702600000000 });
    expect(second.uniqueRows).toBe(2);
    expect(store.listAll()).toHaveLength(2);
  });

  it('slices a full page into smaller windows until pages return short', async () => {
    const store = new BitgetPositionStore(':memory:');
    const fullRows = Array.from({ length: 100 }, (_, index) => row(`COIN${index}USDT`, String(1700000000000 + index * 1000), 'long'));
    const fetchHistoryPositionsPage = vi.fn(async (input: { startTime: number; endTime: number; limit?: number }) => {
      // A window at least 2 minutes wide looks truncated; narrower windows return a short page.
      if (input.endTime - input.startTime > 120_000) return fullRows;
      return [row('BTCUSDT', String(input.startTime), 'long')];
    });
    const service = new BitgetSyncService({ fetchHistoryPositionsPage }, store);

    await service.sync({ fromMs: 1700000000000, toMs: 1702600000000 });
    expect(fetchHistoryPositionsPage.mock.calls.length).toBeGreaterThan(1);
    expect(store.listAll().length).toBeGreaterThan(0);
  });

  it('wipes the cached range before re-fetching when requested', async () => {
    const store = new BitgetPositionStore(':memory:');
    const reader: HistoryPositionsReader = {
      fetchHistoryPositionsPage: vi.fn(async () => [row('BTCUSDT', '1700000000000', 'long')]),
    };
    const service = new BitgetSyncService(reader, store);
    await service.sync({ fromMs: 1700000000000, toMs: 1702600000000 });

    // A wipe + empty exchange result removes the previously cached row.
    reader.fetchHistoryPositionsPage = vi.fn(async () => []);
    await service.sync({ fromMs: 1700000000000, toMs: 1702600000000, wipe: true });
    expect(store.listAll()).toHaveLength(0);
  });
});
