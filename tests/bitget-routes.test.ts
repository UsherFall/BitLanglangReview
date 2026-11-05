import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerBitgetRoutes } from '../src/server/bitget-routes';
import type { BitgetPositionStore } from '../src/server/bitget-position-store';
import { ReviewStore } from '../src/server/review-store';
import { captureRoutes, invokeRoute } from './route-test-utils';

let reviewStore: ReviewStore | undefined;
afterEach(() => {
  reviewStore?.close();
  reviewStore = undefined;
});

describe('registerBitgetRoutes', () => {
  it('isolates key/sync Adapters and returns an empty unconfigured queue', async () => {
    reviewStore = new ReviewStore(':memory:');
    const save = vi.fn();
    const clear = vi.fn();
    const createSyncService = vi.fn();
    const listAll = vi.fn(() => { throw new Error('unconfigured queue must not list positions'); });
    const positionStore = {
      listAll,
      listOrdersBySymbol: vi.fn(() => new Map()),
    } as unknown as BitgetPositionStore;
    const { handlers, order } = captureRoutes((server) => registerBitgetRoutes(server, {
      reviewStore: reviewStore!,
      bitgetPositionStore: positionStore,
      scopedReviewsForModule: () => [],
      keys: { load: () => null, save, clear },
      createSyncService,
    }));
    expect(order).toEqual(['/api/bitget/config', '/api/bitget/sync', '/api/bitget/trades']);

    const queue = await invokeRoute(handlers.get('/api/bitget/trades')!);
    expect(queue.status).toBe(200);
    expect(queue.json).toMatchObject({ trades: [], instruments: [], configured: false, tags: [], tagCounts: {} });
    expect(listAll).not.toHaveBeenCalled();

    const invalid = await invokeRoute(handlers.get('/api/bitget/config')!, { method: 'POST', body: {} });
    expect(invalid.status).toBe(400);
    expect(save).not.toHaveBeenCalled();

    const validKeys = { apiKey: 'key', secret: 'secret', passphrase: 'pass' };
    const saved = await invokeRoute(handlers.get('/api/bitget/config')!, { method: 'POST', body: validKeys });
    expect(saved.status).toBe(200);
    expect(saved.json).toEqual({ configured: true });
    expect(save).toHaveBeenCalledWith(validKeys);

    const sync = await invokeRoute(handlers.get('/api/bitget/sync')!, { method: 'POST', body: {} });
    expect(sync.status).toBe(400);
    expect(createSyncService).not.toHaveBeenCalled();
  });
});
