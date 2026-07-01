export type VisibleTimeRange = {
  from: number;
  to: number;
};

export type LoadedTimeRange = {
  first: number;
  last: number;
};

export function shouldLoadEarlier(visible: VisibleTimeRange, loaded: LoadedTimeRange, threshold: number): boolean {
  return visible.from - loaded.first < threshold;
}

export function shouldLoadLater(visible: VisibleTimeRange, loaded: LoadedTimeRange, threshold: number): boolean {
  return loaded.last - visible.to < threshold;
}

export function isSameVisibleRange(a: VisibleTimeRange | null, b: VisibleTimeRange, tolerance = 1): boolean {
  return !!a && Math.abs(a.from - b.from) <= tolerance && Math.abs(a.to - b.to) <= tolerance;
}
