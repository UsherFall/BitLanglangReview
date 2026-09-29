import { PriceScaleMode } from 'lightweight-charts';
import { describe, expect, it, vi } from 'vitest';
import { applyChartPriceScaleMode, defaultChartPriceScaleOptions, resetChartPriceScale } from '../src/ui/chart-scale';

describe('Chart Scale', () => {
  it('resets the right price scale to logarithmic autoscale defaults', () => {
    const chart = makeChart();

    resetChartPriceScale(chart as never);

    expect(chart.applyOptions).toHaveBeenCalledWith({
      ...defaultChartPriceScaleOptions,
      mode: PriceScaleMode.Logarithmic,
    });
  });

  it('applies the requested mode while keeping autoscale and default margins', () => {
    const chart = makeChart();

    applyChartPriceScaleMode(chart as never, PriceScaleMode.Normal);

    expect(chart.applyOptions).toHaveBeenCalledWith({
      ...defaultChartPriceScaleOptions,
      mode: PriceScaleMode.Normal,
    });
  });
});

function makeChart() {
  const applyOptions = vi.fn();
  return {
    applyOptions,
    priceScale: vi.fn(() => ({ applyOptions })),
  };
}
