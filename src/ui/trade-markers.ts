import type { Candlestick } from '../domain/candlestick';
import type { ReviewedTrade } from '../domain/review-queue';
import type { ReviewTimeframe, TradePoint } from '../domain/trade';
import { markerTimeForEvent } from './chart-time';

/**
 * One point to draw on the chart. A Bitget round expands to one point per
 * order; a workbook trade (or a round whose orders could not be matched)
 * yields just the entry and exit pair.
 */
export type MarkerPoint = {
  /** Stable identity for diffing/keys: trade id + action. */
  key: string;
  tradeId: string;
  /** Chart time in seconds, snapped to a loaded candlestick like the old markers. */
  time: number;
  timeMs: number;
  price: number;
  kind: 'open' | 'close';
  /** Non-active trades are drawn smaller and translucent. */
  muted: boolean;
  /** Per-action detail when the source has orders; null → tooltip falls back
   * to the round's own fields. */
  detail: TradePoint | null;
};

export function tradeChartPoints(
  trade: ReviewedTrade,
  timeframe: ReviewTimeframe,
  candles: Candlestick[],
  highlighted = true,
): MarkerPoint[] {
  return pointsForTrade(trade, timeframe, candles, !highlighted);
}

export function allTradeChartPoints(
  trades: ReviewedTrade[],
  activeTradeId: string,
  timeframe: ReviewTimeframe,
  candles: Candlestick[],
): MarkerPoint[] {
  return trades.flatMap((trade) => pointsForTrade(trade, timeframe, candles, trade.id !== activeTradeId));
}

function pointsForTrade(
  trade: ReviewedTrade,
  timeframe: ReviewTimeframe,
  candles: Candlestick[],
  muted: boolean,
): MarkerPoint[] {
  if (trade.points?.length) {
    return trade.points
      .map((point) => ({
        key: `${trade.id}#${point.timeMs}#${point.kind}`,
        tradeId: trade.id,
        time: Number(markerTimeForEvent(point.time, timeframe, candles)),
        timeMs: point.timeMs,
        price: point.price,
        kind: point.kind,
        muted,
        detail: point,
      }))
      .filter((point) => point.time > 0);
  }

  return [
    fallbackPoint(trade, 'open', trade.entryTime, trade.entryPrice, timeframe, candles, muted),
    fallbackPoint(trade, 'close', trade.exitTime, trade.exitPrice, timeframe, candles, muted),
  ].filter((point) => point.time > 0);
}

function fallbackPoint(
  trade: ReviewedTrade,
  kind: 'open' | 'close',
  eventTime: string,
  price: number,
  timeframe: ReviewTimeframe,
  candles: Candlestick[],
  muted: boolean,
): MarkerPoint {
  return {
    key: `${trade.id}#${kind}`,
    tradeId: trade.id,
    time: Number(markerTimeForEvent(eventTime, timeframe, candles)),
    timeMs: Date.parse(eventTime),
    price,
    kind,
    muted,
    detail: null,
  };
}
