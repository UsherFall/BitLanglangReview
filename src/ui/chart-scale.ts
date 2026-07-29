import { PriceScaleMode, type IChartApi } from 'lightweight-charts';

export type ChartPriceScaleMode = PriceScaleMode.Normal | PriceScaleMode.Logarithmic;

export const defaultChartPriceScaleOptions = {
  autoScale: true,
  mode: PriceScaleMode.Normal,
  scaleMargins: { top: 0.12, bottom: 0.12 },
};

export function resetChartPriceScale(chart: Pick<IChartApi, 'priceScale'>): void {
  chart.priceScale('right').applyOptions(defaultChartPriceScaleOptions);
}

export function applyChartPriceScaleMode(chart: Pick<IChartApi, 'priceScale'>, mode: ChartPriceScaleMode): void {
  chart.priceScale('right').applyOptions({
    ...defaultChartPriceScaleOptions,
    mode,
  });
}
