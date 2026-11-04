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

  it('renames a tag across every review that carries it', () => {
    const store = new ReviewStore(':memory:');
    store.saveReview({ tradeId: 't1', tags: ['breakout', 'late'], note: '' });
    store.saveReview({ tradeId: 't2', tags: ['breakout'], note: '' });
    store.saveReview({ tradeId: 't3', tags: ['scalp'], note: '' });

    expect(store.renameTag('breakout', '箱体突破')).toBe(2);

    expect(store.getReview('t1')?.tags).toEqual(['箱体突破', 'late']);
    expect(store.getReview('t2')?.tags).toEqual(['箱体突破']);
    expect(store.getReview('t3')?.tags).toEqual(['scalp']);
    expect(store.listTagCounts()).toEqual({ '箱体突破': 2, late: 1, scalp: 1 });
  });

  it('merges onto an existing tag when renaming onto a name that is already used', () => {
    const store = new ReviewStore(':memory:');
    store.saveReview({ tradeId: 't1', tags: ['old', 'new'], note: '' });
    store.saveReview({ tradeId: 't2', tags: ['old'], note: '' });

    expect(store.renameTag('old', 'new')).toBe(2);

    // The review that carried both ends up with only the merged name.
    expect(store.getReview('t1')?.tags).toEqual(['new']);
    expect(store.getReview('t2')?.tags).toEqual(['new']);
  });

  it('returns 0 when renaming a tag that does not exist, leaving data untouched', () => {
    const store = new ReviewStore(':memory:');
    store.saveReview({ tradeId: 't1', tags: ['keep'], note: 'note' });

    expect(store.renameTag('ghost', 'real')).toBe(0);
    expect(store.getReview('t1')).toMatchObject({ tags: ['keep'], note: 'note' });
  });

  it('rejects an empty target name without changing anything', () => {
    const store = new ReviewStore(':memory:');
    store.saveReview({ tradeId: 't1', tags: ['keep'], note: '' });

    expect(() => store.renameTag('keep', '   ')).toThrow();
    expect(store.getReview('t1')?.tags).toEqual(['keep']);
  });

  it('deletes a tag from every review that carries it', () => {
    const store = new ReviewStore(':memory:');
    store.saveReview({ tradeId: 't1', tags: ['a', 'b'], note: '' });
    store.saveReview({ tradeId: 't2', tags: ['b'], note: '' });

    expect(store.deleteTag('b')).toBe(2);

    expect(store.getReview('t1')?.tags).toEqual(['a']);
    expect(store.getReview('t2')?.tags).toEqual([]);
    expect(store.listTagCounts()).toEqual({ a: 1 });
  });

  it('keeps the database consistent when a rename fails midway', () => {
    const store = new ReviewStore(':memory:');
    store.saveReview({ tradeId: 't1', tags: ['x'], note: '' });
    store.saveReview({ tradeId: 't2', tags: ['x'], note: '' });

    // Force a throw inside the transaction (first rewrite) and confirm the whole
    // operation rolls back instead of leaving a half-renamed database.
    const original = store.saveReview.bind(store);
    let calls = 0;
    (store as unknown as { saveReview: typeof original }).saveReview = (input) => {
      calls += 1;
      if (calls === 1) throw new Error('boom');
      return original(input);
    };

    expect(() => store.renameTag('x', 'y')).toThrow('boom');
    expect(store.getReview('t1')?.tags).toEqual(['x']);
    expect(store.getReview('t2')?.tags).toEqual(['x']);
  });

  // 11/04: deleting a Free Replay session cascades its Paper Round reviews away.
  // The prefix must END with ':' — without it a session whose start time merely
  // starts with the same digits (`... 10:0` vs `... 10:07`) would be wiped too.
  describe('deleteReviewsByPrefix', () => {
    const round = (instrument: string, startTime: string, positionId: string) => `paper:${instrument}:${startTime}:${positionId}`;

    it('removes every review of the session and nothing else', () => {
      const store = new ReviewStore(':memory:');
      store.saveReview({ tradeId: round('BTCUSDT', '2024-05-21 10:07', 'position-1'), tags: ['追高'], note: '' });
      store.saveReview({ tradeId: round('BTCUSDT', '2024-05-21 10:07', 'position-2'), tags: [], note: '' });
      store.saveReview({ tradeId: round('BTCUSDT', '2023-03-01 08:00', 'position-1'), tags: ['箱体'], note: '' });
      store.saveReview({ tradeId: 'bg-123', tags: ['箱体'], note: '' });

      expect(store.deleteReviewsByPrefix('paper:BTCUSDT:2024-05-21 10:07:')).toBe(2);

      expect(store.getReview(round('BTCUSDT', '2024-05-21 10:07', 'position-1'))).toBeNull();
      expect(store.getReview(round('BTCUSDT', '2023-03-01 08:00', 'position-1'))?.tags).toEqual(['箱体']);
      expect(store.getReview('bg-123')?.tags).toEqual(['箱体']);
    });

    it('does not take down a session whose start time shares a prefix', () => {
      const store = new ReviewStore(':memory:');
      store.saveReview({ tradeId: round('BTCUSDT', '2024-05-21 10:0', 'position-1'), tags: [], note: '' });
      store.saveReview({ tradeId: round('BTCUSDT', '2024-05-21 10:07', 'position-1'), tags: [], note: '' });

      expect(store.deleteReviewsByPrefix('paper:BTCUSDT:2024-05-21 10:07:')).toBe(1);
      expect(store.getReview(round('BTCUSDT', '2024-05-21 10:0', 'position-1'))).not.toBeNull();
    });

    it('treats LIKE wildcards in the instrument literally', () => {
      const store = new ReviewStore(':memory:');
      // `_` is a LIKE wildcard; an instrument that contains one must not match
      // a neighbouring symbol.
      store.saveReview({ tradeId: round('A_B', '2024-05-21 10:07', 'position-1'), tags: [], note: '' });
      store.saveReview({ tradeId: round('AXB', '2024-05-21 10:07', 'position-1'), tags: [], note: '' });

      expect(store.deleteReviewsByPrefix('paper:A_B:2024-05-21 10:07:')).toBe(1);
      expect(store.getReview(round('AXB', '2024-05-21 10:07', 'position-1'))).not.toBeNull();
    });
  });
});
