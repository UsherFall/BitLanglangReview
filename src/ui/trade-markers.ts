import type { SeriesMarker, UTCTimestamp } from 'lightweight-charts';
import type { Candlestick } from '../domain/candlestick';
import type { ReviewedTrade } from '../domain/review-queue';
import type { ReviewTimeframe } from '../domain/trade';
import { markerTimeForEvent } from './chart-time';

const BUY_COLOR = '#22C55E';
const SELL_COLOR = '#EF4444';
const MUTED_BUY_COLOR = 'rgba(34, 197, 94, 0.65)';
const MUTED_SELL_COLOR = 'rgba(239, 68, 68, 0.65)';

export function tradeMarkers(trade: ReviewedTrade, timeframe: ReviewTimeframe, candles: Candlestick[], highlighted = true): SeriesMarker<UTCTimestamp>[] {
  const isLong = trade.direction === '多';
  const entryColor = markerColor(trade.direction, true, highlighted);
  const exitColor = markerColor(trade.direction, false, highlighted);
  return [
    {
      time: markerTimeForEvent(trade.entryTime, timeframe, candles),
      position: 'atPriceBottom',
      price: trade.entryPrice,
      color: entryColor,
      shape: isLong ? 'arrowUp' : 'arrowDown',
      text: `开 ${trade.entryPrice}`,
      size: highlighted ? 2 : 1.2,
    },
    {
      time: markerTimeForEvent(trade.exitTime, timeframe, candles),
      position: 'atPriceTop',
      price: trade.exitPrice,
      color: exitColor,
      shape: isLong ? 'arrowDown' : 'arrowUp',
      text: `平 ${trade.exitPrice}`,
      size: highlighted ? 2 : 1.2,
    },
  ];
}

export function allTradeMarkers(trades: ReviewedTrade[], activeTradeId: string, timeframe: ReviewTimeframe, candles: Candlestick[]): SeriesMarker<UTCTimestamp>[] {
  return trades.flatMap((trade) => tradeMarkers(trade, timeframe, candles, trade.id === activeTradeId));
}

function markerColor(direction: ReviewedTrade['direction'], isEntry: boolean, highlighted: boolean): string {
  const isBuy = (direction === '多') === isEntry;
  if (highlighted) return isBuy ? BUY_COLOR : SELL_COLOR;
  return isBuy ? MUTED_BUY_COLOR : MUTED_SELL_COLOR;
}
