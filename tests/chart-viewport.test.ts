import { describe, expect, it, vi } from 'vitest';
import { captureViewport, restoreViewport, restoreViewportTimeRange } from '../src/ui/chart-viewport';

describe('Chart Viewport', () => {
  it('restores the visible logical range before falling back to the visible time range', () => {
    const chart = makeChart({ logicalRange: { from: 10, to: 30 }, timeRange: { from: 100 as never, to: 200 as never } });

    const viewport = captureViewport(chart as never);
    restoreViewport(chart as never, viewport);

    expect(chart.timeScaleApi.setVisibleLogicalRange).toHaveBeenCalledWith({ from: 10, to: 30 });
    expect(chart.timeScaleApi.setVisibleRange).not.toHaveBeenCalled();
  });

  it('falls back to the visible time range when there is no logical range', () => {
    const chart = makeChart({ logicalRange: null, timeRange: { from: 100 as never, to: 200 as never } });

    restoreViewport(chart as never, captureViewport(chart as never));

    expect(chart.timeScaleApi.setVisibleRange).toHaveBeenCalledWith({ from: 100, to: 200 });
  });

  it('can restore by visible time range before falling back to logical range', () => {
    const chart = makeChart({ logicalRange: { from: 10, to: 30 }, timeRange: { from: 100 as never, to: 200 as never } });

    restoreViewportTimeRange(chart as never, captureViewport(chart as never));

    expect(chart.timeScaleApi.setVisibleRange).toHaveBeenCalledWith({ from: 100, to: 200 });
    expect(chart.timeScaleApi.setVisibleLogicalRange).not.toHaveBeenCalled();
  });
});

function makeChart(input: { logicalRange: unknown; timeRange: unknown }) {
  const timeScaleApi = {
    getVisibleLogicalRange: vi.fn(() => input.logicalRange),
    getVisibleRange: vi.fn(() => input.timeRange),
    setVisibleLogicalRange: vi.fn(),
    setVisibleRange: vi.fn(),
  };
  return {
    timeScaleApi,
    timeScale: () => timeScaleApi,
  };
}
