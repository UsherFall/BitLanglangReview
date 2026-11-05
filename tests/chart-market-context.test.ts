import { describe, expect, it } from 'vitest';
import type { ChartCandleSource } from '../src/domain/candlestick';
import { chartMarketContext } from '../src/ui/chart-market-context';

// 11/05: the ONE mapping that decides a chart's instrument-list venue, the
// `/api/candles?source=` policy, and the candle day grid. `binance` and
// `binance-only` share a venue and grid but MUST stay distinct request
// policies; the rest must not drift either.
const matrix: Array<{
  source: ChartCandleSource;
  venue: 'okx' | 'binance' | 'bitget';
  requestSource: ChartCandleSource;
  grid: 'utc' | 'shanghai';
}> = [
  { source: 'binance', venue: 'binance', requestSource: 'binance', grid: 'utc' },
  { source: 'binance-only', venue: 'binance', requestSource: 'binance-only', grid: 'utc' },
  { source: 'okx', venue: 'okx', requestSource: 'okx', grid: 'shanghai' },
  { source: 'bitget', venue: 'bitget', requestSource: 'bitget', grid: 'shanghai' },
];

describe('chartMarketContext', () => {
  it.each(matrix)('maps $source → venue $venue / request $requestSource / grid $grid', ({ source, venue, requestSource, grid }) => {
    expect(chartMarketContext(source)).toEqual({ venue, requestSource, grid });
  });

  it('keeps binance and binance-only on one venue and grid but two request policies', () => {
    const binance = chartMarketContext('binance');
    const strictBinance = chartMarketContext('binance-only');

    expect(binance.venue).toBe(strictBinance.venue);
    expect(binance.grid).toBe(strictBinance.grid);
    // The candidate chain vs. strict Binance: never collapse these.
    expect(binance.requestSource).toBe('binance');
    expect(strictBinance.requestSource).toBe('binance-only');
    expect(binance.requestSource).not.toBe(strictBinance.requestSource);
  });
});
