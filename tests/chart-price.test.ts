import { describe, expect, it } from 'vitest';
import { formatChartPrice } from '../src/ui/chart-price';

describe('Chart Price', () => {
  it('formats chart axis prices by magnitude with explicit boundaries', () => {
    expect(formatChartPrice(60345)).toBe('60,345.00');
    expect(formatChartPrice(1000)).toBe('1,000.00');
    expect(formatChartPrice(999.9999)).toBe('999.9999');
    expect(formatChartPrice(1)).toBe('1.0000');
    expect(formatChartPrice(0.999999)).toBe('0.999999');
    expect(formatChartPrice(0.01)).toBe('0.010000');
    expect(formatChartPrice(0.00001234)).toBe('0.00001234');
    expect(formatChartPrice(0.0000123)).toBe('0.0000123');
  });
});
