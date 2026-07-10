const highPriceFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const mediumPriceFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

const smallPriceFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 6,
  maximumFractionDigits: 6,
});

const microPriceFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 8,
});

export function formatChartPrice(value: number): string {
  const magnitude = Math.abs(value);

  if (magnitude >= 1000) return highPriceFormatter.format(value);
  if (magnitude >= 1) return mediumPriceFormatter.format(value);
  if (magnitude >= 0.01) return smallPriceFormatter.format(value);
  return microPriceFormatter.format(value);
}
