import { describe, expect, it } from 'vitest';
import { buildReviewQueue } from '../src/domain/build-review-queue';
import type { TradeReview } from '../src/domain/review';
import type { Trade } from '../src/domain/trade';

describe('Review Queue', () => {
  it('defaults to entry time ascending and can filter by result, tag, note state, instrument, direction, and time range', () => {
    const queue = buildReviewQueue(sampleTrades, sampleReviews, {
      result: 'loss',
      tag: '追高',
      noteState: 'withNote',
      instrument: 'BTC-USDT-SWAP',
      direction: '多',
      startDate: '2022-05-24',
      endDate: '2022-05-25',
    });

    expect(queue.map((trade) => trade.id)).toEqual(['t2']);
    expect(buildReviewQueue(sampleTrades, sampleReviews).map((trade) => trade.id)).toEqual(['t1', 't2', 't3']);
  });

  it('sorts by return rate, profit, or holding duration in either direction', () => {
    expect(buildReviewQueue(sampleTrades, sampleReviews, { sortField: 'returnRate', sortDirection: 'desc' }).map((trade) => trade.id)).toEqual(['t3', 't1', 't2']);
    expect(buildReviewQueue(sampleTrades, sampleReviews, { sortField: 'holdingMinutes', sortDirection: 'desc' }).map((trade) => trade.id)).toEqual(['t3', 't1', 't2']);
  });

  it('filters starred and unstarred trades', () => {
    expect(buildReviewQueue(sampleTrades, sampleReviews, { starred: 'yes' }).map((trade) => trade.id)).toEqual(['t2']);
    expect(buildReviewQueue(sampleTrades, sampleReviews, { starred: 'no' }).map((trade) => trade.id)).toEqual(['t1', 't3']);
  });
});

const sampleTrades: Trade[] = [
  makeTrade({ id: 't2', instrument: 'BTC-USDT-SWAP', direction: '多', entryTime: '2022-05-24T12:00:00.000+08:00', profit: -20, returnRate: -0.05, holdingMinutes: 30 }),
  makeTrade({ id: 't1', instrument: 'ETH-USDT-SWAP', direction: '空', entryTime: '2022-05-24T10:00:00.000+08:00', profit: -1, returnRate: -0.01, holdingMinutes: 40 }),
  makeTrade({ id: 't3', instrument: 'BTC-USDT-SWAP', direction: '空', entryTime: '2022-05-26T10:00:00.000+08:00', profit: 99, returnRate: 0.12, holdingMinutes: 90 }),
];

const sampleReviews: TradeReview[] = [
  { tradeId: 't2', tags: ['追高'], note: '进早了', starred: true, updatedAt: '2026-01-01T00:00:00.000Z' },
  { tradeId: 't3', tags: ['突破'], note: '', starred: false, updatedAt: '2026-01-01T00:00:00.000Z' },
];

function makeTrade(overrides: Partial<Trade>): Trade {
  return {
    id: 't',
    sequence: 1,
    instrument: 'BTC-USDT-SWAP',
    direction: '多',
    leverage: 10,
    margin: 100,
    entryPrice: 1,
    exitPrice: 1,
    returnRate: 0,
    profit: 0,
    turnover: 0,
    size: 0,
    maxPositionValue: 0,
    fee: 0,
    entryTime: '2022-05-24T00:00:00.000+08:00',
    exitTime: '2022-05-24T00:01:00.000+08:00',
    holdingMinutes: 1,
    amplitude: null,
    sourceNote: '',
    ...overrides,
  };
}
