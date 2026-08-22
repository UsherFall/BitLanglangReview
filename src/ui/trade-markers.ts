import type { SeriesMarker, UTCTimestamp } from 'lightweight-charts';
import type { Candlestick } from '../domain/candlestick';
import type { ReviewedTrade } from '../domain/review-queue';
import type { ReviewTimeframe } from '../domain/trade';
import { markerTimeForEvent } from './chart-time';

const HIGHLIGHT_ENTRY_COLOR = '#FACC15';
const HIGHLIGHT_EXIT_COLOR = '#38BDF8';
const MUTED_COLOR = '#6B7280';

export function tradeMarkers(trade: ReviewedTrade, timeframe: ReviewTimeframe, candles: Candlestick[], highlighted = true): SeriesMarker<UTCTimestamp>[] {
  const isLong = trade.direction === '多';
  const entryColor = highlighted ? HIGHLIGHT_ENTRY_COLOR : MUTED_COLOR;
  const exitColor = highlighted ? HIGHLIGHT_EXIT_COLOR : MUTED_COLOR;
  return [
    {
      time: markerTimeForEvent(trade.entryTime, timeframe, candles),
      position: isLong ? 'belowBar' : 'aboveBar',
      color: entryColor,
      shape: isLong ? 'arrowUp' : 'arrowDown',
      text: `开 ${trade.entryPrice}`,
    },
    {
      time: markerTimeForEvent(trade.exitTime, timeframe, candles),
      position: isLong ? 'aboveBar' : 'belowBar',
      color: exitColor,
      shape: isLong ? 'arrowDown' : 'arrowUp',
      text: `平 ${trade.exitPrice}`,
    },
  ];
}

export function allTradeMarkers(trades: ReviewedTrade[], activeTradeId: string, timeframe: ReviewTimeframe, candles: Candlestick[]): SeriesMarker<UTCTimestamp>[] {
  return trades.flatMap((trade) => tradeMarkers(trade, timeframe, candles, trade.id === activeTradeId));
}
