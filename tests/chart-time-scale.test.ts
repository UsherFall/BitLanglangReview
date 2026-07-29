import { describe, expect, it } from 'vitest';
import { centeredLogicalRange, centeredTimeRange, cursorAnchoredLogicalRange, cursorAnchoredTimeRange, visibleBarCountForLogicalRange, visibleBarCountForWidth } from '../src/ui/chart-time-scale';

describe('Chart Time Scale', () => {
  it('derives visible bar count from chart width and bar spacing', () => {
    expect(visibleBarCountForWidth(960, 8)).toBe(120);
  });

  it('uses a fallback when width or bar spacing is unavailable', () => {
    expect(visibleBarCountForWidth(0, 8, 144)).toBe(144);
    expect(visibleBarCountForWidth(960, 0, 144)).toBe(144);
  });

  it('derives visible bar count from the current logical range', () => {
    expect(visibleBarCountForLogicalRange({ from: 10.25, to: 88.75 })).toBe(79);
  });

  it('uses a fallback when the logical range is unavailable', () => {
    expect(visibleBarCountForLogicalRange(null, 96)).toBe(96);
  });

  it('keeps centered ranges around the previous visible center', () => {
    expect(centeredTimeRange(1_000, 60, 100)).toEqual({ from: -2_000, to: 4_000 });
  });

  it('keeps centered logical ranges around the previous visible center index', () => {
    expect(centeredLogicalRange(200, 100)).toEqual({ from: 150, to: 250 });
  });

  it('anchors the cursor near the right edge with future padding', () => {
    expect(cursorAnchoredTimeRange(10_000, 300, 120, 10)).toEqual({ from: -23_000, to: 13_000 });
  });

  it('anchors the cursor index near the right edge with future padding', () => {
    expect(cursorAnchoredLogicalRange(150, 120, 10)).toEqual({ from: 40, to: 160 });
  });
});
