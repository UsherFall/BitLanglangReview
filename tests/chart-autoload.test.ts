import { describe, expect, it } from 'vitest';
import { isSameVisibleRange, shouldLoadEarlier, shouldLoadLater } from '../src/ui/chart-autoload';

describe('Chart Autoload', () => {
  it('loads later when the visible range approaches the loaded right edge', () => {
    expect(shouldLoadLater({ from: 800, to: 990 }, { first: 0, last: 1000 }, 100)).toBe(true);
  });

  it('loads later when the viewport has moved into right-side blank space', () => {
    expect(shouldLoadLater({ from: 1100, to: 1290 }, { first: 0, last: 1000 }, 400)).toBe(true);
  });

  it('loads earlier when the visible range approaches the loaded left edge', () => {
    expect(shouldLoadEarlier({ from: 10, to: 200 }, { first: 0, last: 1000 }, 100)).toBe(true);
  });

  it('loads earlier when the viewport has moved into left-side blank space', () => {
    expect(shouldLoadEarlier({ from: -290, to: -100 }, { first: 0, last: 1000 }, 400)).toBe(true);
  });

  it('recognizes the same visible range so one drag cannot cascade through multiple pages', () => {
    expect(isSameVisibleRange({ from: 1100, to: 1290 }, { from: 1100.4, to: 1289.7 })).toBe(true);
    expect(isSameVisibleRange({ from: 1100, to: 1290 }, { from: 1200, to: 1390 })).toBe(false);
  });
});
