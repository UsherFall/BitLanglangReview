import { afterEach, describe, expect, it } from 'vitest';
import { registerReviewRoutes } from '../src/server/review-routes';
import { ReviewStore } from '../src/server/review-store';
import { captureRoutes, invokeRoute } from './route-test-utils';

let store: ReviewStore | undefined;
afterEach(() => {
  store?.close();
  store = undefined;
});

describe('registerReviewRoutes', () => {
  it('registers the review workflow in order and composes a scoped save response', async () => {
    store = new ReviewStore(':memory:');
    const { handlers, order } = captureRoutes((server) => registerReviewRoutes(server, {
      trades: [],
      reviewStore: store!,
      scopedReviewsForModule: (module) => store!.listReviews().filter((review) => module === 'paper' ? review.tradeId.startsWith('paper:') : true),
    }));
    expect(order).toEqual(['/api/trades', '/api/reviews', '/api/tags/rename', '/api/tags/delete']);

    const saved = await invokeRoute(handlers.get('/api/reviews')!, {
      method: 'POST',
      body: { tradeId: 'paper:BTCUSDT:2024-05-21 10:00:position-1', tags: ['zeta', 'alpha'], note: '', module: 'paper' },
    });
    expect(saved.status).toBe(200);
    expect(saved.json.review.tradeId).toBe('paper:BTCUSDT:2024-05-21 10:00:position-1');
    expect(saved.json.tags).toEqual(['alpha', 'zeta']);
    expect(saved.json.tagCounts).toEqual({ alpha: 1, zeta: 1 });
    expect(saved.headers['content-type']).toBe('application/json; charset=utf-8');

    const wrongMethod = await invokeRoute(handlers.get('/api/reviews')!, { method: 'GET' });
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.json).toEqual({ error: 'Method not allowed' });
  });
});
