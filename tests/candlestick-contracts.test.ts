import { describe, expect, it } from 'vitest';
import { mergeCandles, timeframeMs } from '../src/domain/candlestick';
import { reviewTimeframes } from '../src/domain/trade';

describe('Candlestick neutral contracts', () => {
  it('maps every Review Timeframe to its exact nominal duration', () => {
    const expected = {
      '1m': 60_000,
      '5m': 300_000,
      '15m': 900_000,
      '1H': 3_600_000,
      '4H': 14_400_000,
      '1D': 86_400_000,
      '1W': 604_800_000,
      '1M': 2_592_000_000,
    } as const;
    expect(reviewTimeframes).toEqual(Object.keys(expected));
    for (const timeframe of reviewTimeframes) {
      expect(timeframeMs(timeframe)).toBe(expected[timeframe]);
    }
  });

  it('merges by timestamp with last write wins and ascending output without mutating input', () => {
    const first = { timestamp: 300, payload: 'first' };
    const duplicate = { timestamp: 100, payload: 'old' };
    const input = [first, duplicate, { timestamp: 200, payload: 'middle' }, { timestamp: 100, payload: 'winner' }];
    const original = [...input];

    const merged = mergeCandles(input);

    expect(merged).toEqual([
      { timestamp: 100, payload: 'winner' },
      { timestamp: 200, payload: 'middle' },
      { timestamp: 300, payload: 'first' },
    ]);
    expect(merged[0]?.payload).toBe('winner');
    expect(input).toEqual(original);
    expect(input[0]).toBe(first);
    expect(input[1]).toBe(duplicate);
  });
});
