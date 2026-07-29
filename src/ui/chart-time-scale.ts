import type { NumericVisibleRange } from './chart-navigation-anchor';

const DEFAULT_VISIBLE_BARS = 160;
const MIN_VISIBLE_BARS = 20;

export function visibleBarCountForWidth(width: number | null | undefined, barSpacing: number | null | undefined, fallback = DEFAULT_VISIBLE_BARS): number {
  if (!Number.isFinite(width) || !Number.isFinite(barSpacing) || !width || !barSpacing || barSpacing <= 0) return fallback;
  return Math.max(MIN_VISIBLE_BARS, Math.round(width / barSpacing));
}

export function visibleBarCountForLogicalRange(range: { from: number; to: number } | null | undefined, fallback = DEFAULT_VISIBLE_BARS): number {
  if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to) || range.to <= range.from) return fallback;
  return Math.max(MIN_VISIBLE_BARS, Math.round(range.to - range.from));
}

export function centeredTimeRange(centerTime: number, stepSeconds: number, visibleBars: number): NumericVisibleRange {
  const span = normalizedVisibleBars(visibleBars) * stepSeconds;
  return {
    from: centerTime - span / 2,
    to: centerTime + span / 2,
  };
}

export function centeredLogicalRange(centerIndex: number, visibleBars: number): NumericVisibleRange {
  const span = normalizedVisibleBars(visibleBars);
  return {
    from: centerIndex - span / 2,
    to: centerIndex + span / 2,
  };
}

export function cursorAnchoredTimeRange(cursorTime: number, stepSeconds: number, visibleBars: number, rightPaddingBars = 10): NumericVisibleRange {
  const bars = normalizedVisibleBars(visibleBars);
  const right = Math.min(Math.max(rightPaddingBars, 1), Math.max(1, bars - 1));
  return {
    from: cursorTime - (bars - right) * stepSeconds,
    to: cursorTime + right * stepSeconds,
  };
}

export function cursorAnchoredLogicalRange(cursorIndex: number, visibleBars: number, rightPaddingBars = 10): NumericVisibleRange {
  const bars = normalizedVisibleBars(visibleBars);
  const right = Math.min(Math.max(rightPaddingBars, 1), Math.max(1, bars - 1));
  return {
    from: cursorIndex - (bars - right),
    to: cursorIndex + right,
  };
}

function normalizedVisibleBars(value: number): number {
  return Math.max(MIN_VISIBLE_BARS, Math.round(value));
}
