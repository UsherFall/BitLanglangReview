import { describe, expect, it, vi } from 'vitest';
import type { BitgetOrder } from '../src/domain/bitget-order';
import type { BitgetHistoryPosition } from '../src/domain/bitget-position';
import { BitgetPositionStore } from '../src/server/bitget-position-store';
import { BitgetSyncService, type BitgetSyncReader } from '../src/server/bitget-sync';

const DAY = 24 * 60 * 60 * 1000;

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

function order(orderId: string, tradedAt: number, overrides: Partial<BitgetOrder> = {}): BitgetOrder {
  return {
    orderId,
    symbol: 'BTCUSDT',
    posSide: 'long',
    side: 'open',
    qty: 1,
    price: 100,
    fee: -0.05,
    profit: 0,
    source: 'market',
    leverage: 30,
    tradedAt,
    placedAt: tradedAt - 20,
    ...overrides,
  };
}

function readerWith(positions: BitgetHistoryPosition[], orders: BitgetOrder[] = []): BitgetSyncReader {
  return {
    fetchHistoryPositionsPage: vi.fn(async () => positions),
    fetchOrdersPage: vi.fn(async () => orders),
  };
}

describe('Bitget Sync Service', () => {
  it('fetches, caches, and never duplicates on re-sync', async () => {
    const store = new BitgetPositionStore(':memory:');
    const reader = readerWith([
      row('BTCUSDT', '1700000000000', 'long'),
      row('ETHUSDT', '1700001000000', 'short'),
    ]);
    const service = new BitgetSyncService(reader, store, { orderPageDelayMs: 0 });

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
    const service = new BitgetSyncService({ fetchHistoryPositionsPage, fetchOrdersPage: vi.fn(async () => []) }, store, { orderPageDelayMs: 0 });

    await service.sync({ fromMs: 1700000000000, toMs: 1702600000000 });
    expect(fetchHistoryPositionsPage.mock.calls.length).toBeGreaterThan(1);
    expect(store.listAll().length).toBeGreaterThan(0);
  });

  it('wipes the cached range before re-fetching when requested', async () => {
    const store = new BitgetPositionStore(':memory:');
    const reader = readerWith([row('BTCUSDT', '1700000000000', 'long')]);
    const service = new BitgetSyncService(reader, store, { orderPageDelayMs: 0 });
    await service.sync({ fromMs: 1700000000000, toMs: 1702600000000 });

    // A wipe + empty exchange result removes the previously cached row.
    reader.fetchHistoryPositionsPage = vi.fn(async () => []);
    await service.sync({ fromMs: 1700000000000, toMs: 1702600000000, wipe: true });
    expect(store.listAll()).toHaveLength(0);
  });

  it('caches filled orders in seven-day slices and dedupes by order id', async () => {
    const store = new BitgetPositionStore(':memory:');
    // 10-day range => two 7-day windows; the same order appears in both.
    const fromMs = 1700000000000;
    const toMs = fromMs + 10 * DAY;
    const repeated = order('dup-1', fromMs + 1000);
    const fetchOrdersPage = vi.fn(async (input: { startTime: number }) => {
      if (input.startTime <= fromMs) return [repeated, order('a-1', fromMs + 2000)];
      return [repeated, order('b-1', fromMs + 8 * DAY)];
    });
    const service = new BitgetSyncService(
      { fetchHistoryPositionsPage: vi.fn(async () => [row('BTCUSDT', String(fromMs), 'long')]), fetchOrdersPage },
      store,
      { orderPageDelayMs: 0 },
    );

    const result = await service.sync({ fromMs, toMs });
    expect(fetchOrdersPage.mock.calls.length).toBe(2);
    expect(result.ordersFetched).toBe(3);
    expect(result.ordersError).toBeNull();
    expect([...store.listOrdersBySymbol().get('BTCUSDT') ?? []].map((item) => item.orderId)).toEqual(['dup-1', 'a-1', 'b-1']);
  });

  it('pages through a full order window with idLessThan', async () => {
    const store = new BitgetPositionStore(':memory:');
    const fromMs = 1700000000000;
    const toMs = fromMs + 2 * DAY;
    const fullPage = Array.from({ length: 100 }, (_, index) => order(`o-${index}`, fromMs + index * 1000));
    const fetchOrdersPage = vi.fn(async (input: { idLessThan?: string }) => {
      if (!input.idLessThan) return fullPage;
      return [order('older-1', fromMs + 100)];
    });
    const service = new BitgetSyncService(
      { fetchHistoryPositionsPage: vi.fn(async () => []), fetchOrdersPage },
      store,
      { orderPageDelayMs: 0 },
    );

    const result = await service.sync({ fromMs, toMs });
    expect(fetchOrdersPage.mock.calls.map((call) => call[0].idLessThan)).toEqual([undefined, 'o-99']);
    expect(result.ordersFetched).toBe(101);
  });

  it('keeps positions when the order pass fails, and surfaces the error', async () => {
    const store = new BitgetPositionStore(':memory:');
    const service = new BitgetSyncService(
      {
        fetchHistoryPositionsPage: vi.fn(async () => [row('BTCUSDT', '1700000000000', 'long')]),
        fetchOrdersPage: vi.fn(async () => {
          throw new Error('startTime and endTime interval cannot be greater than 7 days');
        }),
      },
      store,
      { orderPageDelayMs: 0 },
    );

    const result = await service.sync({ fromMs: 1700000000000, toMs: 1702600000000 });
    expect(result.uniqueRows).toBe(1);
    expect(store.listAll()).toHaveLength(1);
    expect(result.ordersFetched).toBe(0);
    expect(result.ordersError).toContain('7 days');
  });

  it('drops cached orders inside the wiped range', async () => {
    const store = new BitgetPositionStore(':memory:');
    const reader = readerWith([row('BTCUSDT', '1700000000000', 'long')], [order('o-1', 1700000500000)]);
    const service = new BitgetSyncService(reader, store, { orderPageDelayMs: 0 });
    await service.sync({ fromMs: 1700000000000, toMs: 1702600000000 });
    expect(store.listOrdersBySymbol().get('BTCUSDT')).toHaveLength(1);

    reader.fetchOrdersPage = vi.fn(async () => []);
    await service.sync({ fromMs: 1700000000000, toMs: 1702600000000, wipe: true });
    expect(store.listOrdersBySymbol().get('BTCUSDT')).toBeUndefined();
  });
});
