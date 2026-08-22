import type { SeriesMarker, UTCTimestamp } from 'lightweight-charts';
import type { Candlestick } from '../domain/candlestick';
import type { ReviewedTrade } from '../domain/review-queue';
import type { ReviewTimeframe } from '../domain/trade';
import { markerTimeForEvent } from './chart-time';

const BUY_COLOR = '#22C55E';
const SELL_COLOR = '#EF4444';

export function tradeMarkers(trade: ReviewedTrade, timeframe: ReviewTimeframe, candles: Candlestick[], highlighted = true): SeriesMarker<UTCTimestamp>[] {
  const isLong = trade.direction === '多';
  const entryIsBuy = isLong;
  const exitIsBuy = !isLong;
  return [
    {
      time: markerTimeForEvent(trade.entryTime, timeframe, candles),
      position: 'atPriceBottom',
      price: trade.entryPrice,
      color: markerColor(entryIsBuy),
      shape: isLong ? 'arrowUp' : 'arrowDown',
      text: `${entryIsBuy ? 'B' : 'S'} ${trade.entryPrice}`,
      size: highlighted ? 2 : 1.2,
    },
    {
      time: markerTimeForEvent(trade.exitTime, timeframe, candles),
      position: 'atPriceTop',
      price: trade.exitPrice,
      color: markerColor(exitIsBuy),
      shape: isLong ? 'arrowDown' : 'arrowUp',
      text: `${exitIsBuy ? 'B' : 'S'} ${trade.exitPrice}`,
      size: highlighted ? 2 : 1.2,
    },
  ];
}

export function allTradeMarkers(trades: ReviewedTrade[], activeTradeId: string, timeframe: ReviewTimeframe, candles: Candlestick[]): SeriesMarker<UTCTimestamp>[] {
  return trades.flatMap((trade) => tradeMarkers(trade, timeframe, candles, trade.id === activeTradeId));
}

function markerColor(isBuy: boolean): string {
  return isBuy ? BUY_COLOR : SELL_COLOR;
}
