import type { SeriesMarker, UTCTimestamp } from 'lightweight-charts';
import type { Candlestick } from '../domain/candlestick';
import type { ReviewedTrade } from '../domain/review-queue';
import type { ReviewTimeframe } from '../domain/trade';
import { markerTimeForEvent } from './chart-time';

export function tradeMarkers(trade: ReviewedTrade, timeframe: ReviewTimeframe, candles: Candlestick[]): SeriesMarker<UTCTimestamp>[] {
  const isLong = trade.direction === '多';
  return [
    {
      time: markerTimeForEvent(trade.entryTime, timeframe, candles),
      position: isLong ? 'belowBar' : 'aboveBar',
      color: '#FACC15',
      shape: isLong ? 'arrowUp' : 'arrowDown',
      text: `开 ${trade.entryPrice}`,
    },
    {
      time: markerTimeForEvent(trade.exitTime, timeframe, candles),
      position: isLong ? 'aboveBar' : 'belowBar',
      color: '#38BDF8',
      shape: isLong ? 'arrowDown' : 'arrowUp',
      text: `平 ${trade.exitPrice}`,
    },
  ];
}
