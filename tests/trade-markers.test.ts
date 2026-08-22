import { describe, expect, it } from 'vitest';
import type { Candlestick } from '../src/domain/candlestick';
import type { ReviewedTrade } from '../src/domain/review-queue';
import { allTradeMarkers, tradeMarkers } from '../src/ui/trade-markers';

describe('Trade Markers', () => {
  it('places entry and exit markers on existing review timeframe candlesticks', () => {
    const candles = [
      makeCandle('2024-05-21T00:00:00+08:00'),
      makeCandle('2024-05-21T04:00:00+08:00'),
      makeCandle('2024-05-21T08:00:00+08:00'),
    ];

    const markers = tradeMarkers(makeTrade(), '4H', candles);

    expect(markers.map((marker) => marker.time)).toEqual([
      Date.parse('2024-05-21T00:00:00+08:00') / 1000,
      Date.parse('2024-05-21T04:00:00+08:00') / 1000,
    ]);
    expect(candles.map((candle) => candle.timestamp / 1000)).toEqual(expect.arrayContaining(markers.map((marker) => marker.time)));
  });

  it('renders all trades entry and exit markers with the active trade highlighted', () => {
    const candles = [
      makeCandle('2024-05-21T00:00:00+08:00'),
      makeCandle('2024-05-21T04:00:00+08:00'),
      makeCandle('2024-05-21T08:00:00+08:00'),
    ];
    const trades = [
      makeTrade({ id: 't1' }),
      makeTrade({ id: 't2', entryTime: '2024-05-21T04:10:00.000+08:00', exitTime: '2024-05-21T08:20:00.000+08:00', entryPrice: 3200, exitPrice: 3300, direction: '空' }),
    ];

    const markers = allTradeMarkers(trades, 't1', '4H', candles);

    expect(markers).toHaveLength(4);
    expect(markers.map((marker) => marker.time)).toEqual([
      Date.parse('2024-05-21T00:00:00+08:00') / 1000,
      Date.parse('2024-05-21T04:00:00+08:00') / 1000,
      Date.parse('2024-05-21T04:00:00+08:00') / 1000,
      Date.parse('2024-05-21T08:00:00+08:00') / 1000,
    ]);
    const [activeEntry, activeExit, otherEntry, otherExit] = markers;
    expect(activeEntry.color).toBe('#22C55E');
    expect(activeExit.color).toBe('#EF4444');
    expect(otherEntry.color).toBe('#EF4444');
    expect(otherExit.color).toBe('#22C55E');
    expect(activeEntry.position).toBe('atPriceBottom');
    expect(activeEntry.price).toBe(3100);
    expect(activeExit.position).toBe('atPriceTop');
    expect(activeExit.price).toBe(3500);
    expect(activeEntry.text).toBe('开 3100');
    expect(activeExit.text).toBe('平 3500');
    expect(otherEntry.text).toBe('开 3200');
    expect(otherExit.text).toBe('平 3300');
  });
});

function makeCandle(time: string): Candlestick {
  return {
    instrument: 'ETH-USDT-SWAP',
    timeframe: '4H',
    timestamp: Date.parse(time),
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 1,
  };
}

function makeTrade(overrides: Partial<ReviewedTrade> = {}): ReviewedTrade {
  return {
    id: 't1',
    sequence: 1,
    instrument: 'ETH-USDT-SWAP',
    direction: '多',
    entryTime: '2024-05-21T01:17:00.000+08:00',
    exitTime: '2024-05-21T05:30:00.000+08:00',
    entryPrice: 3100,
    exitPrice: 3500,
    profit: 1,
    leverage: 1,
    margin: 1,
    returnRate: 0.1,
    turnover: 1,
    size: 1,
    maxPositionValue: 1,
    fee: 0,
    holdingMinutes: 253,
    amplitude: null,
    sourceNote: '',
    review: null,
    ...overrides,
  };
}
