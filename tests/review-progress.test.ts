import { describe, expect, it } from 'vitest';
import type { ReviewedTrade } from '../src/domain/review-queue';
import { firstUnreviewedTrade, isReviewedTrade, reviewProgress } from '../src/ui/review-progress';

describe('Review Progress', () => {
  it('counts only trades with at least one Review Tag as reviewed', () => {
    expect(isReviewedTrade(makeTrade({ id: 'tagged', tags: ['breakout'], note: '' }))).toBe(true);
    expect(isReviewedTrade(makeTrade({ id: 'note-only', tags: [], note: 'reviewed in prose' }))).toBe(false);
    expect(isReviewedTrade(makeTrade({ id: 'empty', tags: [], note: '' }))).toBe(false);
  });

  it('reports total, reviewed count, and selected Trade position in the current Review Queue', () => {
    const queue = [
      makeTrade({ id: 't1', tags: ['breakout'], note: '' }),
      makeTrade({ id: 't2', tags: [], note: 'note only' }),
      makeTrade({ id: 't3', tags: ['late'], note: '' }),
    ];

    expect(reviewProgress(queue, 't2')).toEqual({ total: 3, reviewed: 2, current: 2 });
    expect(reviewProgress(queue, 'missing')).toEqual({ total: 3, reviewed: 2, current: 0 });
  });

  it('finds the first unreviewed Trade in the current Review Queue', () => {
    const queue = [
      makeTrade({ id: 't1', tags: ['breakout'], note: '' }),
      makeTrade({ id: 't2', tags: [], note: 'note only' }),
      makeTrade({ id: 't3', tags: [], note: '' }),
    ];

    expect(firstUnreviewedTrade(queue)?.id).toBe('t2');
    expect(firstUnreviewedTrade([makeTrade({ id: 'done', tags: ['breakout'], note: '' })])).toBeNull();
  });
});

function makeTrade(input: { id: string; tags: string[]; note: string }): ReviewedTrade {
  return {
    id: input.id,
    sequence: 1,
    instrument: 'BTC-USDT-SWAP',
    direction: '多',
    leverage: 1,
    margin: 1,
    entryPrice: 1,
    exitPrice: 1,
    returnRate: 0,
    profit: 0,
    turnover: 0,
    size: 0,
    maxPositionValue: 0,
    fee: 0,
    entryTime: '2024-05-21T10:00:00.000+08:00',
    exitTime: '2024-05-21T10:05:00.000+08:00',
    holdingMinutes: 5,
    amplitude: null,
    sourceNote: '',
    review: { tradeId: input.id, tags: input.tags, note: input.note, updatedAt: '2024-05-21T00:00:00.000Z' },
  };
}
