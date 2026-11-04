import { describe, expect, it } from 'vitest';
import type { PaperTrade } from '../src/domain/paper-trading';
import type { TradeReview } from '../src/domain/review';
import { buildPaperRoundLibrary } from '../src/server/paper-rounds';

const fill = (overrides: Partial<PaperTrade> & { id: string; positionId: string }): PaperTrade => ({
  direction: 'long',
  entryPrice: 100,
  entryTime: Date.parse('2024-05-21T10:00:00+08:00'),
  positionOpenPrice: 100,
  positionOpenTime: Date.parse('2024-05-21T10:00:00+08:00'),
  exitPrice: 110,
  exitTime: Date.parse('2024-05-21T10:15:00+08:00'),
  quantity: 1,
  margin: 100,
  notional: 100,
  leverage: 1,
  pnl: 10,
  returnRate: 0.1,
  ...overrides,
});

const review = (tradeId: string, tags: string[], starred: boolean): TradeReview => ({
  tradeId,
  tags,
  note: '',
  starred,
  updatedAt: '2024-05-21T12:00:00.000Z',
});

const session = (overrides: Partial<{ instrument: string; startTime: string; updatedAt: string; paperTrading: unknown }> = {}) => ({
  instrument: 'BTCUSDT',
  startTime: '2024-05-21 10:07',
  updatedAt: '2024-05-21T09:00:00.000Z',
  paperTrading: { position: null, trades: [fill({ id: 'fill-1', positionId: 'position-1' })] },
  ...overrides,
});

describe('buildPaperRoundLibrary', () => {
  it('derives closed rounds across sessions with their annotations', () => {
    const library = buildPaperRoundLibrary(
      [
        session(),
        session({
          instrument: 'ETHUSDT',
          startTime: '2023-03-01 08:00',
          updatedAt: '2023-03-01T01:00:00.000Z',
          paperTrading: { position: null, trades: [fill({ id: 'fill-9', positionId: 'position-1', pnl: -5, margin: 50 })] },
        }),
      ],
      [review('paper:BTCUSDT:2024-05-21 10:07:position-1', ['追高'], true)],
    );

    expect(library.rounds).toHaveLength(2);
    expect(library.sessions).toHaveLength(2);
    const btc = library.rounds.find((round) => round.instrument === 'BTCUSDT');
    expect(btc?.review?.tags).toEqual(['追高']);
    expect(btc?.review?.starred).toBe(true);
    // The ETH round has no saved review, so it shows up unannotated.
    expect(library.rounds.find((round) => round.instrument === 'ETHUSDT')?.review).toBeUndefined();
  });

  it('leaves the still-open round out and keeps its session off the list when nothing closed', () => {
    const library = buildPaperRoundLibrary(
      [session({
        paperTrading: {
          position: { id: 'position-2' },
          trades: [fill({ id: 'fill-1', positionId: 'position-1' }), fill({ id: 'fill-2', positionId: 'position-2' })],
        },
      })],
      [],
    );

    expect(library.rounds.map((round) => round.positionId)).toEqual(['position-1']);
    expect(library.sessions[0]?.roundCount).toBe(1);
  });

  it('ignores sessions without paper trading', () => {
    const library = buildPaperRoundLibrary([session({ paperTrading: null })], []);
    expect(library.rounds).toEqual([]);
    expect(library.sessions).toEqual([]);
  });

  it('filters rounds but still lists every source session', () => {
    const library = buildPaperRoundLibrary(
      [
        session(),
        session({
          instrument: 'ETHUSDT',
          startTime: '2023-03-01 08:00',
          updatedAt: '2023-03-01T01:00:00.000Z',
          paperTrading: { position: null, trades: [fill({ id: 'fill-9', positionId: 'position-1' })] },
        }),
      ],
      [review('paper:BTCUSDT:2024-05-21 10:07:position-1', ['追高'], true)],
      { tag: '追高' },
    );

    expect(library.rounds.map((round) => round.instrument)).toEqual(['BTCUSDT']);
    expect(library.sessions.map((row) => row.instrument)).toEqual(['BTCUSDT', 'ETHUSDT']);
  });

  it('returns every paper review, including open-round ones the list omits', () => {
    const library = buildPaperRoundLibrary(
      [session({ paperTrading: { position: { id: 'position-2' }, trades: [fill({ id: 'fill-2', positionId: 'position-2' })] } })],
      [review('paper:BTCUSDT:2024-05-21 10:07:position-2', ['边练边记'], false)],
    );

    // The open round is not a library ROW, but its annotation must still reach
    // the in-replay 单子 rows after a restore.
    expect(library.rounds).toEqual([]);
    expect(library.reviews.map((review) => review.tradeId)).toEqual(['paper:BTCUSDT:2024-05-21 10:07:position-2']);
  });

  it('ignores reviews from the real-trade modules', () => {
    const library = buildPaperRoundLibrary(
      [session()],
      [review('bg-123', ['追高'], true), review('aaa', ['追高'], true)],
    );

    expect(library.rounds[0]?.review).toBeUndefined();
  });
});
