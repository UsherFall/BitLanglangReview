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

  it('validates and persists reviewStatus while keeping legacy PUT payloads active', async () => {
    const saveSession = vi.fn((input: { reviewStatus?: string }) => ({
      ...input,
      reviewStatus: input.reviewStatus ?? 'active',
      updatedAt: '2024-05-21T12:00:00+08:00',
    }));
    const sessionStore = {
      saveSession,
      listSessions: vi.fn(() => []),
    } as unknown as FreeReplaySessionStore;
    reviewStore = new ReviewStore(':memory:');
    const { handlers } = captureRoutes((server) => registerFreeReplaySessionRoutes(server, {
      freeReplaySessionStore: sessionStore,
      reviewStore: reviewStore!,
      scopedReviewsForModule: () => [],
    }));
    const body = {
      instrument: 'BTCUSDT',
      startTime: '2024-05-21 10:00',
      dataAnchorTime: '2024-05-21 10:00',
      startCursorTime: 1716267600,
      startProgressTime: 1716268800,
      progressTime: 1716269400,
      cursorTime: 1716268800,
      timeframe: '5m',
      paperTrading: { active: false, trades: [] },
    };
    const route = handlers.get('/api/free-replay/sessions')!;

    const legacy = await invokeRoute(route, { method: 'PUT', body });
    expect(legacy.status).toBe(200);
    expect(legacy.json.reviewStatus).toBe('active');
    const ended = await invokeRoute(route, { method: 'PUT', body: { ...body, reviewStatus: 'ended' } });
    expect(ended.status).toBe(200);
    expect(ended.json.reviewStatus).toBe('ended');
    expect(saveSession).toHaveBeenCalledTimes(2);

    const invalid = await invokeRoute(route, { method: 'PUT', body: { ...body, reviewStatus: 'completed' } });
    expect(invalid.status).toBe(400);
    expect(invalid.json.error).toContain('reviewStatus');
    expect(saveSession).toHaveBeenCalledTimes(2);
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
