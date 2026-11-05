import { afterEach, describe, expect, it, vi } from 'vitest';
import { paperSessionReviewPrefix } from '../src/domain/paper-round';
import { registerFreeReplayInstrumentRoutes, registerFreeReplaySessionRoutes } from '../src/server/free-replay-routes';
import type { FreeReplaySessionStore } from '../src/server/free-replay-session-store';
import { ReviewStore } from '../src/server/review-store';
import { captureRoutes, invokeRoute } from './route-test-utils';

let reviewStore: ReviewStore | undefined;
afterEach(() => {
  reviewStore?.close();
  reviewStore = undefined;
});

describe('Free Replay routes', () => {
  it('serves instruments through the injected source Adapter', async () => {
    const { handlers, order } = captureRoutes((server) => registerFreeReplayInstrumentRoutes(server, {
      createBinanceInstruments: () => ({ listTradableUsdtSymbols: async () => ['BTCUSDT'] }),
      okxInstruments: { listSwapInstruments: async () => ['BTC-USDT-SWAP'] },
      bitgetSymbols: async () => ['ETHUSDT'],
    }));
    expect(order).toEqual(['/api/free-replay/instruments']);

    const bitget = await invokeRoute(handlers.get('/api/free-replay/instruments')!, { url: '/?source=bitget' });
    expect(bitget.json).toEqual({ instruments: ['ETHUSDT'] });
    const okx = await invokeRoute(handlers.get('/api/free-replay/instruments')!, { url: '/?source=okx' });
    expect(okx.json).toEqual({ instruments: ['BTC-USDT-SWAP'] });
  });

  it('wires DELETE to exactly one atomic cascade with the trailing session prefix', async () => {
    reviewStore = new ReviewStore(':memory:');
    const deleteSessionWithPaperReviews = vi.fn(() => ({ deletedReviews: 2 }));
    const sessionStore = {
      deleteSessionWithPaperReviews,
      listSessions: vi.fn(() => []),
    } as unknown as FreeReplaySessionStore;
    const { handlers, order } = captureRoutes((server) => registerFreeReplaySessionRoutes(server, {
      freeReplaySessionStore: sessionStore,
      reviewStore: reviewStore!,
      scopedReviewsForModule: () => [],
    }));
    expect(order).toEqual(['/api/free-replay/sessions', '/api/paper/rounds']);

    const response = await invokeRoute(handlers.get('/api/free-replay/sessions')!, {
      method: 'DELETE',
      url: '/?instrument=BTCUSDT&startTime=2024-05-21+10%3A00',
    });
    expect(deleteSessionWithPaperReviews).toHaveBeenCalledTimes(1);
    expect(deleteSessionWithPaperReviews).toHaveBeenCalledWith(
      'BTCUSDT',
      '2024-05-21 10:00',
      paperSessionReviewPrefix('BTCUSDT', '2024-05-21 10:00'),
    );
    expect(response.status).toBe(200);
    expect(response.json).toEqual({ ok: true, deletedReviews: 2 });
  });
});
