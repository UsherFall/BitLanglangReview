import type { IChartApi, IRange, LogicalRange, Time } from 'lightweight-charts';

export type ChartViewport = {
  logicalRange: LogicalRange | null;
  timeRange: IRange<Time> | null;
};

export function captureViewport(chart: IChartApi): ChartViewport {
  return {
    logicalRange: chart.timeScale().getVisibleLogicalRange(),
    timeRange: chart.timeScale().getVisibleRange(),
  };
}

export function restoreViewport(chart: IChartApi, viewport: ChartViewport): void {
  if (viewport.logicalRange) {
    chart.timeScale().setVisibleLogicalRange(viewport.logicalRange);
    return;
  }

  if (viewport.timeRange) {
    chart.timeScale().setVisibleRange(viewport.timeRange);
  }
}

export function restoreViewportTimeRange(chart: IChartApi, viewport: ChartViewport): void {
  if (viewport.timeRange) {
    chart.timeScale().setVisibleRange(viewport.timeRange);
    return;
  }

  if (viewport.logicalRange) {
    chart.timeScale().setVisibleLogicalRange(viewport.logicalRange);
  }
}
