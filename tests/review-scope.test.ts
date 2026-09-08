import { describe, expect, it } from 'vitest';
import { scopeReviewsToTrades, type TradeReview } from '../src/domain/review';

const review = (tradeId: string, tags: string[]): TradeReview => ({
  tradeId,
  tags,
  note: '',
  starred: false,
  updatedAt: '2026-09-08T00:00:00.000Z',
});

describe('scopeReviewsToTrades', () => {
  it('keeps only reviews attached to the given trade ids', () => {
    const reviews = [review('aaa', ['箱体']), review('bg-111', ['假突破']), review('bbb', ['箱体'])];
    const scoped = scopeReviewsToTrades(reviews, ['aaa', 'bbb']);
    expect(scoped.map((r) => r.tradeId)).toEqual(['aaa', 'bbb']);
  });

  it('is empty when no trade id matches', () => {
    expect(scopeReviewsToTrades([review('aaa', ['箱体'])], ['bg-999'])).toEqual([]);
  });

  it('keeps a tag shared across both modules inside each module scope', () => {
    const reviews = [review('aaa', ['箱体']), review('bg-111', ['箱体'])];
    const tradeSide = scopeReviewsToTrades(reviews, ['aaa']).flatMap((r) => r.tags);
    const bitgetSide = scopeReviewsToTrades(reviews, ['bg-111']).flatMap((r) => r.tags);
    expect(tradeSide).toEqual(['箱体']);
    expect(bitgetSide).toEqual(['箱体']);
  });
});
