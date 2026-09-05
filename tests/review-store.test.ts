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
});
