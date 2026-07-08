import type { SeriesMarker, UTCTimestamp } from 'lightweight-charts';
import type { Candlestick } from '../domain/candlestick';
import type { ReviewTimeframe } from '../domain/trade';
import { markerTimeForEvent } from './chart-time';

export const PAPER_ACCOUNT_EQUITY = 1000;

export type PaperDirection = 'long' | 'short';
export type PaperOrderKind = 'entry' | 'exit';

export type PaperTradingSettings = {
  direction: PaperDirection;
  positionRatioPercent: number;
  leverage: number;
};

export type PaperOrder = {
  id: string;
  kind: PaperOrderKind;
  direction: PaperDirection;
  limitPrice: number;
  positionRatioPercent: number;
  leverage: number;
  createdAtCursorTime: number;
};

export type PaperPosition = {
  id: string;
  direction: PaperDirection;
  entryPrice: number;
  entryTime: number;
  margin: number;
  notional: number;
  quantity: number;
  positionRatioPercent: number;
  leverage: number;
};

export type PaperTrade = PaperPosition & {
  exitPrice: number;
  exitTime: number;
  pnl: number;
  returnRate: number;
};

export type PaperTradingSession = {
  active: boolean;
  startedAtCursorTime: number | null;
  nextId: number;
  pendingEntry: PaperOrder | null;
  pendingExit: PaperOrder | null;
  position: PaperPosition | null;
  trades: PaperTrade[];
};

export type PaperStats = {
  realizedPnl: number;
  totalReturnRate: number;
  winRate: number | null;
  profitLossRatio: number | null;
  tradeCount: number;
  floatingPnl: number | null;
};

export function initialPaperTradingSession(): PaperTradingSession {
  return {
    active: false,
    startedAtCursorTime: null,
    nextId: 1,
    pendingEntry: null,
    pendingExit: null,
    position: null,
    trades: [],
  };
}

export function startPaperTrading(session: PaperTradingSession, cursorTime: number): PaperTradingSession {
  return {
    ...session,
    active: true,
    startedAtCursorTime: cursorTime,
  };
}

export function openMarket(session: PaperTradingSession, candle: Candlestick, settings: PaperTradingSettings): PaperTradingSession {
  if (!session.active || session.position) return session;
  return openPosition(session, candle.close, candle.timestamp, settings);
}

export function placeEntryLimit(session: PaperTradingSession, limitPrice: number, settings: PaperTradingSettings, cursorTime: number): PaperTradingSession {
  if (!session.active || session.position || !isPositiveFinite(limitPrice)) return session;
  const normalized = normalizeSettings(settings);
  const order: PaperOrder = {
    id: nextId(session, 'entry'),
    kind: 'entry',
    direction: normalized.direction,
    limitPrice,
    positionRatioPercent: normalized.positionRatioPercent,
    leverage: normalized.leverage,
    createdAtCursorTime: cursorTime,
  };
  return { ...session, nextId: session.nextId + 1, pendingEntry: order };
}

export function closeMarket(session: PaperTradingSession, candle: Candlestick): PaperTradingSession {
  if (!session.active || !session.position) return session;
  return closePosition(session, candle.close, candle.timestamp);
}

export function placeExitLimit(session: PaperTradingSession, limitPrice: number, cursorTime: number): PaperTradingSession {
  if (!session.active || !session.position || !isPositiveFinite(limitPrice)) return session;
  const order: PaperOrder = {
    id: nextId(session, 'exit'),
    kind: 'exit',
    direction: session.position.direction,
    limitPrice,
    positionRatioPercent: session.position.positionRatioPercent,
    leverage: session.position.leverage,
    createdAtCursorTime: cursorTime,
  };
  return { ...session, nextId: session.nextId + 1, pendingExit: order };
}

export function cancelPendingOrder(session: PaperTradingSession, kind: PaperOrderKind): PaperTradingSession {
  return kind === 'entry' ? { ...session, pendingEntry: null } : { ...session, pendingExit: null };
}

export function processRevealedCandle(session: PaperTradingSession, candle: Candlestick): PaperTradingSession {
  if (!session.active) return session;
  if (!session.position && session.pendingEntry && limitTouched(candle, session.pendingEntry.limitPrice)) {
    return openPosition(session, session.pendingEntry.limitPrice, candle.timestamp, {
      direction: session.pendingEntry.direction,
      positionRatioPercent: session.pendingEntry.positionRatioPercent,
      leverage: session.pendingEntry.leverage,
    });
  }
  if (session.position && session.pendingExit && limitTouched(candle, session.pendingExit.limitPrice)) {
    return closePosition(session, session.pendingExit.limitPrice, candle.timestamp);
  }
  return session;
}

export function paperTradingStats(session: PaperTradingSession, currentCandle: Candlestick | null): PaperStats {
  const realizedPnl = session.trades.reduce((sum, trade) => sum + trade.pnl, 0);
  const winningTrades = session.trades.filter((trade) => trade.pnl > 0);
  const losingTrades = session.trades.filter((trade) => trade.pnl < 0);
  const averageWin = average(winningTrades.map((trade) => trade.pnl));
  const averageLoss = average(losingTrades.map((trade) => Math.abs(trade.pnl)));
  const floatingPnl = session.position && currentCandle ? pnlFor(session.position, currentCandle.close) : null;
  return {
    realizedPnl,
    totalReturnRate: realizedPnl / PAPER_ACCOUNT_EQUITY,
    winRate: session.trades.length ? winningTrades.length / session.trades.length : null,
    profitLossRatio: averageWin !== null && averageLoss !== null ? averageWin / averageLoss : null,
    tradeCount: session.trades.length,
    floatingPnl,
  };
}

export function currentCursorCandle(candles: Candlestick[], cursorTime: number): Candlestick | null {
  const cursorTimestamp = cursorTime * 1000;
  return candles.find((candle) => candle.timestamp === cursorTimestamp) ?? null;
}

export function paperTradeMarkers(trades: PaperTrade[], timeframe: ReviewTimeframe, candles: Candlestick[]): SeriesMarker<UTCTimestamp>[] {
  return trades.flatMap((trade) => {
    const isLong = trade.direction === 'long';
    return [
      {
        time: markerTimeForEvent(new Date(trade.entryTime).toISOString(), timeframe, candles),
        position: isLong ? 'belowBar' : 'aboveBar',
        color: '#FACC15',
        shape: isLong ? 'arrowUp' : 'arrowDown',
        text: `开 ${trade.entryPrice}`,
      },
      {
        time: markerTimeForEvent(new Date(trade.exitTime).toISOString(), timeframe, candles),
        position: isLong ? 'aboveBar' : 'belowBar',
        color: '#38BDF8',
        shape: isLong ? 'arrowDown' : 'arrowUp',
        text: `平 ${trade.exitPrice}`,
      },
    ];
  });
}

function openPosition(session: PaperTradingSession, entryPrice: number, entryTime: number, settings: PaperTradingSettings): PaperTradingSession {
  const normalized = normalizeSettings(settings);
  const margin = PAPER_ACCOUNT_EQUITY * normalized.positionRatioPercent / 100;
  const notional = margin * normalized.leverage;
  const position: PaperPosition = {
    id: nextId(session, 'position'),
    direction: normalized.direction,
    entryPrice,
    entryTime,
    margin,
    notional,
    quantity: notional / entryPrice,
    positionRatioPercent: normalized.positionRatioPercent,
    leverage: normalized.leverage,
  };
  return {
    ...session,
    nextId: session.nextId + 1,
    pendingEntry: null,
    position,
  };
}

function closePosition(session: PaperTradingSession, exitPrice: number, exitTime: number): PaperTradingSession {
  if (!session.position) return session;
  const pnl = pnlFor(session.position, exitPrice);
  const trade: PaperTrade = {
    ...session.position,
    exitPrice,
    exitTime,
    pnl,
    returnRate: pnl / session.position.margin,
  };
  return {
    ...session,
    pendingExit: null,
    position: null,
    trades: [...session.trades, trade],
  };
}

function normalizeSettings(settings: PaperTradingSettings): PaperTradingSettings {
  return {
    direction: settings.direction,
    positionRatioPercent: clamp(settings.positionRatioPercent, 1, 100),
    leverage: clamp(settings.leverage, 1, 125),
  };
}

function pnlFor(position: PaperPosition, exitPrice: number): number {
  const delta = position.direction === 'long' ? exitPrice - position.entryPrice : position.entryPrice - exitPrice;
  return delta * position.quantity;
}

function limitTouched(candle: Candlestick, limitPrice: number): boolean {
  return candle.low <= limitPrice && limitPrice <= candle.high;
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function nextId(session: PaperTradingSession, prefix: string): string {
  return `${prefix}-${session.nextId}`;
}
