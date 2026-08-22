import type { SeriesMarker, UTCTimestamp } from 'lightweight-charts';
import type { Candlestick } from '../domain/candlestick';
import type { ReviewedTrade } from '../domain/review-queue';
import type { ReviewTimeframe } from '../domain/trade';
import { markerTimeForEvent } from './chart-time';

const ENTRY_COLOR = '#FACC15';
const EXIT_COLOR = '#38BDF8';

export function tradeMarkers(trade: ReviewedTrade, timeframe: ReviewTimeframe, candles: Candlestick[], _highlighted = true): SeriesMarker<UTCTimestamp>[] {
  const isLong = trade.direction === '多';
  return [
    {
      time: markerTimeForEvent(trade.entryTime, timeframe, candles),
      position: isLong ? 'belowBar' : 'aboveBar',
      color: ENTRY_COLOR,
      shape: isLong ? 'arrowUp' : 'arrowDown',
      text: `开 ${trade.entryPrice}`,
    },
    {
      time: markerTimeForEvent(trade.exitTime, timeframe, candles),
      position: isLong ? 'aboveBar' : 'belowBar',
      color: EXIT_COLOR,
      shape: isLong ? 'arrowDown' : 'arrowUp',
      text: `平 ${trade.exitPrice}`,
    },
  ];
}

export function allTradeMarkers(trades: ReviewedTrade[], activeTradeId: string, timeframe: ReviewTimeframe, candles: Candlestick[]): SeriesMarker<UTCTimestamp>[] {
  return trades.flatMap((trade) => tradeMarkers(trade, timeframe, candles, trade.id === activeTradeId));
}
