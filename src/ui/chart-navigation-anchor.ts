export type NavigationAnchor = {
  time: number;
  ratio: number;
};

export type NumericVisibleRange = {
  from: number;
  to: number;
};

export function visibleRangeForAnchor(anchor: NavigationAnchor, span: number): NumericVisibleRange {
  return {
    from: anchor.time - span * anchor.ratio,
    to: anchor.time + span * (1 - anchor.ratio),
  };
}

export function visibleRangeForLatestAnchor(visibleRange: NumericVisibleRange, anchor: NavigationAnchor): NumericVisibleRange {
  return visibleRangeForAnchor(anchor, visibleRange.to - visibleRange.from);
}
