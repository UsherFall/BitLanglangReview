import type { Candlestick } from '../domain/candlestick';
import type { ReviewedTrade } from '../domain/review-queue';
import type { Direction, ReviewTimeframe, TradePoint } from '../domain/trade';
import { containingCandleTimestamp } from './chart-time';

/** Chart colours. Teal reads as the long side's colour, rose as the short
 * side's. */
export const LONG_COLOR = '#2DD4BF';
export const SHORT_COLOR = '#FB7185';

/**
 * Colour of a point's dot and its hover badge. An entry wears its trade's
 * direction colour and an exit the opposite one, so a long opens teal and
 * closes rose, while a short opens rose and closes teal.
 */
export function pointColor(kind: 'open' | 'close', direction: Direction): string {
  const own = direction === '空' ? SHORT_COLOR : LONG_COLOR;
  const opposite = direction === '空' ? LONG_COLOR : SHORT_COLOR;
  return kind === 'open' ? own : opposite;
}

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
  /** Direction of the trade this action belongs to. Decides which side of the
   * candle the dot hangs on and the colour it is painted with. */
  direction: Direction;
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
      .map((point): MarkerPoint | null => {
        const time = snapToLoadedCandle(point.timeMs, timeframe, candles);
        if (time === null) return null;
        return {
          key: `${trade.id}#${point.timeMs}#${point.kind}`,
          tradeId: trade.id,
          time,
          timeMs: point.timeMs,
          price: point.price,
          kind: point.kind,
          direction: trade.direction,
          muted,
          detail: point,
        };
      })
      .filter((point): point is MarkerPoint => point !== null);
  }

  return [
    fallbackPoint(trade, 'open', trade.entryTime, trade.entryPrice, timeframe, candles, muted),
    fallbackPoint(trade, 'close', trade.exitTime, trade.exitPrice, timeframe, candles, muted),
  ].filter((point): point is MarkerPoint => point !== null);
}

function fallbackPoint(
  trade: ReviewedTrade,
  kind: 'open' | 'close',
  eventTime: string,
  price: number,
  timeframe: ReviewTimeframe,
  candles: Candlestick[],
  muted: boolean,
): MarkerPoint | null {
  const time = snapToLoadedCandle(Date.parse(eventTime), timeframe, candles);
  if (time === null) return null;
  return {
    key: `${trade.id}#${kind}`,
    tradeId: trade.id,
    time,
    timeMs: Date.parse(eventTime),
    price,
    kind,
    direction: trade.direction,
    muted,
    detail: null,
  };
}

/**
 * Chart time (seconds) of the loaded candlestick that contains `timeMs`, or
 * `null` when no loaded candlestick does.
 *
 * Returning `null` instead of a floored grid time is deliberate: the renderer
 * anchors a point's price to that same candlestick's low/high, so a point whose
 * time was floored onto an unloaded slot would end up drawn at one time and
 * another candle's price — the drift this guards against. Actions outside the
 * loaded range simply appear once the reviewer scrolls that range into view.
 */
function snapToLoadedCandle(timeMs: number, timeframe: ReviewTimeframe, candles: Candlestick[]): number | null {
  if (!Number.isFinite(timeMs)) return null;
  const containing = containingCandleTimestamp(timeMs, timeframe, candles);
  return containing === null ? null : Math.floor(containing / 1000);
}
