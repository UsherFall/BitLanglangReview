import { describe, expect, it } from 'vitest';
import { ReviewStore } from '../src/server/review-store';

describe('Review Store', () => {
  it('saves and reloads custom review tags and one review note for a trade', () => {
    const store = new ReviewStore(':memory:');

    store.saveReview({
      tradeId: 'trade-1',
      tags: ['追高', '止损慢'],
      note: '突破后追进去，回踩没有等确认。',
      starred: true,
    });

    expect(store.getReview('trade-1')).toMatchObject({
      tradeId: 'trade-1',
      tags: ['追高', '止损慢'],
      note: '突破后追进去，回踩没有等确认。',
      starred: true,
    });
    expect(store.getReview('missing')).toBeNull();
  });

  it('defaults reviews to not starred when no starred value is saved', () => {
    const store = new ReviewStore(':memory:');

    store.saveReview({ tradeId: 'trade-1', tags: [], note: '' });

    expect(store.getReview('trade-1')?.starred).toBe(false);
  });
});
