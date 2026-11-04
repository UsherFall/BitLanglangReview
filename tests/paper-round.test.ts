import { describe, expect, it } from 'vitest';
import {
  filterPaperRounds,
  groupFillsIntoRounds,
  isPaperReviewId,
  paperRoundReviewId,
  paperSessionReviewPrefix,
  scopeReviewsToPaperRounds,
} from '../src/domain/paper-round';
import type { PaperTrade } from '../src/domain/paper-trading';

const fill = (overrides: Partial<PaperTrade> & { id: string; positionId: string }): PaperTrade => ({
  direction: 'long',
  entryPrice: 100,
  entryTime: 1_700_000_000_000,
  positionOpenPrice: 100,
  positionOpenTime: 1_700_000_000_000,
  exitPrice: 110,
  exitTime: 1_700_000_600_000,
  quantity: 1,
  margin: 100,
  notional: 100,
  leverage: 1,
  pnl: 10,
  returnRate: 0.1,
  ...overrides,
});

const session = { instrument: 'BTCUSDT', startTime: '2024-05-21 10:07' };

describe('paperRoundReviewId', () => {
  it('builds the paper-scoped, session-qualified round id', () => {
    expect(paperRoundReviewId('BTCUSDT', '2024-05-21 10:07', 'position-1')).toBe('paper:BTCUSDT:2024-05-21 10:07:position-1');
  });

  it('stays unique across sessions that share an instrument', () => {
    const a = paperRoundReviewId('BTCUSDT', '2024-05-21 10:07', 'position-1');
    const b = paperRoundReviewId('BTCUSDT', '2023-03-01 08:00', 'position-1');
    expect(a).not.toBe(b);
  });

  it('is recognisable as a paper review id and carries a cascade prefix', () => {
    expect(isPaperReviewId(paperRoundReviewId('BTCUSDT', '2024-05-21 10:07', 'position-1'))).toBe(true);
    expect(isPaperReviewId('bg-123')).toBe(false);
    expect(paperSessionReviewPrefix('BTCUSDT', '2024-05-21 10:07')).toBe('paper:BTCUSDT:2024-05-21 10:07:');
  });
});

describe('groupFillsIntoRounds', () => {
  it('merges partial closes of one position into a single round', () => {
    const rounds = groupFillsIntoRounds([
      fill({ id: 'fill-1', positionId: 'position-1', exitPrice: 105, exitTime: 1_700_000_100_000, pnl: 5, margin: 50, quantity: 0.5 }),
      fill({ id: 'fill-2', positionId: 'position-1', exitPrice: 110, exitTime: 1_700_000_600_000, pnl: 5, margin: 50, quantity: 0.5 }),
    ], session);

    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toMatchObject({
      id: 'paper:BTCUSDT:2024-05-21 10:07:position-1',
      positionId: 'position-1',
      fillCount: 2,
      tradeIds: ['fill-1', 'fill-2'],
      exitPrice: 110,
      quantity: 1,
      margin: 100,
      pnl: 10,
      returnRate: 0.1,
    });
  });

  it('excludes the still-open round (its partial fills included)', () => {
    const rounds = groupFillsIntoRounds([
      fill({ id: 'fill-1', positionId: 'position-1' }),
      fill({ id: 'fill-2', positionId: 'position-2', exitTime: 1_700_000_900_000 }),
    ], { ...session, openPositionId: 'position-2' });

    expect(rounds.map((round) => round.positionId)).toEqual(['position-1']);
  });

  it('orders rounds by closing time descending', () => {
    const rounds = groupFillsIntoRounds([
      fill({ id: 'fill-1', positionId: 'position-1', exitTime: 1_700_000_100_000 }),
      fill({ id: 'fill-2', positionId: 'position-2', exitTime: 1_700_000_900_000 }),
    ], session);

    expect(rounds.map((round) => round.positionId)).toEqual(['position-2', 'position-1']);
  });
});

describe('filterPaperRounds', () => {
  const rounds = groupFillsIntoRounds([
    fill({ id: 'fill-1', positionId: 'position-1', exitTime: 1_700_000_100_000 }),
    fill({ id: 'fill-2', positionId: 'position-2', exitTime: 1_700_000_900_000 }),
  ], session).map((round) => ({
    ...round,
    // Rounds come back newest-closed first, so position-2 leads the list.
    review: round.positionId === 'position-1'
      ? { tradeId: round.id, tags: ['追高'], note: '', starred: true, updatedAt: '2024-05-21T12:00:00.000Z' }
      : undefined,
  }));

  it('filters by tag', () => {
    expect(filterPaperRounds(rounds, { tag: '追高' }).map((round) => round.positionId)).toEqual(['position-1']);
  });

  it('filters by starred state', () => {
    expect(filterPaperRounds(rounds, { starred: 'yes' }).map((round) => round.positionId)).toEqual(['position-1']);
    expect(filterPaperRounds(rounds, { starred: 'no' }).map((round) => round.positionId)).toEqual(['position-2']);
  });

  it('filters by owning session', () => {
    expect(filterPaperRounds(rounds, { session: 'BTCUSDT:2024-05-21 10:07' })).toHaveLength(2);
    expect(filterPaperRounds(rounds, { session: 'BTCUSDT:2023-03-01 08:00' })).toHaveLength(0);
  });

  it('ANDS the conditions together', () => {
    expect(filterPaperRounds(rounds, { tag: '追高', starred: 'no' })).toHaveLength(0);
  });
});

describe('scopeReviewsToPaperRounds', () => {
  it('keeps paper round reviews only, so tag counts never mix modules', () => {
    const reviews = [
      { tradeId: 'paper:BTCUSDT:2024-05-21 10:07:position-1', tags: ['追高'], note: '', starred: false, updatedAt: '2024-05-21T12:00:00.000Z' },
      { tradeId: 'bg-123', tags: ['追高'], note: '', starred: false, updatedAt: '2024-05-21T12:00:00.000Z' },
      { tradeId: 'aaa', tags: ['箱体'], note: '', starred: false, updatedAt: '2024-05-21T12:00:00.000Z' },
    ];

    expect(scopeReviewsToPaperRounds(reviews).map((review) => review.tradeId)).toEqual([
      'paper:BTCUSDT:2024-05-21 10:07:position-1',
    ]);
  });
});
