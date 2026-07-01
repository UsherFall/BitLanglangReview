import { describe, expect, it } from 'vitest';
import type { Candlestick } from '../src/domain/candlestick';
import type { ReviewedTrade } from '../src/domain/review-queue';
import { tradeMarkers } from '../src/ui/trade-markers';

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

function makeTrade(): ReviewedTrade {
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
  };
}
