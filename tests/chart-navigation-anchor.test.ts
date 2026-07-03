import { describe, expect, it } from 'vitest';
import { visibleRangeForLatestAnchor, visibleRangeForAnchor } from '../src/ui/chart-navigation-anchor';

describe('Chart Navigation Anchor', () => {
  it('keeps the anchor time at the same horizontal ratio', () => {
    expect(visibleRangeForAnchor({ time: 1_000, ratio: 0.25 }, 400)).toEqual({ from: 900, to: 1_300 });
  });

  it('uses the center ratio when there is no pointer anchor', () => {
    expect(visibleRangeForAnchor({ time: 1_000, ratio: 0.5 }, 400)).toEqual({ from: 800, to: 1_200 });
  });

  it('restores the latest anchor using the current visible range span', () => {
    expect(visibleRangeForLatestAnchor({ from: 500, to: 1_100 }, { time: 1_000, ratio: 0.25 })).toEqual({ from: 850, to: 1_450 });
  });
});
