import type { SeriesMarker, UTCTimestamp } from 'lightweight-charts';
import type { Candlestick } from '../domain/candlestick';
import type { ReviewTimeframe } from '../domain/trade';
import { freeReplayCursorTimeForProgress } from './chart-time';

export const PAPER_ACCOUNT_EQUITY = 1000;

export type PaperDirection = 'long' | 'short';
export type PaperOrderKind = 'entry' | 'exit';

export type PaperTradingSettings = {
  direction: PaperDirection;
  positionRatioPercent: number;
  leverage: number;
};

// One scale-in batch ("仓") of the aggregated position. Each batch owns its
// own stop-loss price; the stop size is always this batch's remaining
// quantity, so no separate stop-order quantity is needed.
export type PaperLeg = {
  id: string;
  entryPrice: number;
  entryTime: number;
  quantity: number;
  margin: number;
  notional: number;
  leverage: number;
  stopPrice?: number;
};

// Aggregated position: the displayed entry price is the quantity-weighted
// average of the remaining legs; realized pnl of manual/limit closes uses
// FIFO over the legs, while a leg's own stop closes exactly that leg.
export type PaperPosition = {
  id: string;
  direction: PaperDirection;
  // First-leg open of this position round (fixed at creation, marker anchor).
  originPrice: number;
  originTime: number;
  // Aggregates over the remaining legs.
  entryPrice: number;
  entryTime: number;
  quantity: number;
  margin: number;
  notional: number;
  leverage: number;
  legs: PaperLeg[];
};

export type PaperOrder = {
  id: string;
  kind: PaperOrderKind;
  direction: PaperDirection;
  limitPrice: number;
  // Entry orders size their margin at fill time: available * ratio / 100.
  positionRatioPercent?: number;
  leverage?: number;
  // The single global take-profit exit locks a fixed quantity at placement.
  quantity?: number;
  createdAtCursorTime: number;
};

// One closed portion. Each partial close records its own row.
export type PaperTrade = {
  id: string;
  positionId: string;
  direction: PaperDirection;
  // FIFO basis of the closed quantity (weighted when a fill spans legs).
  entryPrice: number;
  entryTime: number;
  // Origin of the position round this fill belongs to (marker anchor).
  positionOpenPrice: number;
  positionOpenTime: number;
  exitPrice: number;
  exitTime: number;
  quantity: number;
  margin: number;
  notional: number;
  leverage: number;
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

export function availableMargin(session: PaperTradingSession): number {
  const used = session.position?.legs.reduce((sum, leg) => sum + leg.margin, 0) ?? 0;
  return Math.max(0, PAPER_ACCOUNT_EQUITY - used);
}

export function openMarket(session: PaperTradingSession, candle: Candlestick, settings: PaperTradingSettings, eventTime: number): PaperTradingSession {
  if (!session.active) return session;
  return openPosition(session, candle.close, eventTime * 1000, settings);
}

export function placeEntryLimit(session: PaperTradingSession, limitPrice: number, settings: PaperTradingSettings, cursorTime: number): PaperTradingSession {
  if (!session.active || !isPositiveFinite(limitPrice)) return session;
  const normalized = normalizeSettings(settings);
  // Direction is locked while a position is open; opposite-direction entries
  // are rejected the same way reverse/hedge orders are not supported.
  if (session.position && session.position.direction !== normalized.direction) return session;
  // An add must have room to fill at placement; only a held position can
  // exhaust the baseline margin, so gate on that case (a fresh entry always
  // has the full baseline available).
  if (session.position && availableMargin(session) <= 0) return session;
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

export function closeMarket(session: PaperTradingSession, candle: Candlestick, eventTime: number, closeRatioPercent = 100): PaperTradingSession {
  if (!session.active || !session.position) return session;
  const closeQuantity = session.position.quantity * normalizeCloseRatio(closeRatioPercent) / 100;
  return closeQuantityFor(session, candle.close, eventTime * 1000, closeQuantity);
}

// Places or replaces the single take-profit exit limit. Its quantity is fixed
// at placement and must not exceed the current position size.
export function placeExitLimit(session: PaperTradingSession, limitPrice: number, quantity: number, cursorTime: number): PaperTradingSession {
  if (!session.active || !session.position || !isPositiveFinite(limitPrice) || !isPositiveFinite(quantity)) return session;
  if (quantity > session.position.quantity) return session;
  const order: PaperOrder = {
    id: nextId(session, 'exit'),
    kind: 'exit',
    direction: session.position.direction,
    limitPrice,
    quantity,
    createdAtCursorTime: cursorTime,
  };
  return { ...session, nextId: session.nextId + 1, pendingExit: order };
}

// Sets (creates or moves) the stop loss of one specific leg ("一仓一损").
// The stop always covers exactly that leg's remaining quantity.
export function placeStopLoss(session: PaperTradingSession, legId: string, stopPrice: number, currentPrice: number, cursorTime: number): PaperTradingSession {
  if (!session.active || !session.position) return session;
  if (!isValidStopLossPrice(session.position.direction, stopPrice, currentPrice)) return session;
  const leg = session.position.legs.find((item) => item.id === legId);
  if (!leg || leg.quantity <= 0) return session;
  const legs = session.position.legs.map((item) => (item.id === legId ? { ...item, stopPrice } : item));
  return { ...session, position: recomputePosition({ ...session.position, legs }) };
}

export function cancelStopLoss(session: PaperTradingSession, legId: string): PaperTradingSession {
  if (!session.position) return session;
  const legs = session.position.legs.map((item) => (item.id === legId ? { ...item, stopPrice: undefined } : item));
  return { ...session, position: recomputePosition({ ...session.position, legs }) };
}

export function cancelPendingOrder(session: PaperTradingSession, kind: PaperOrderKind): PaperTradingSession {
  return kind === 'entry' ? { ...session, pendingEntry: null } : { ...session, pendingExit: null };
}

export function processRevealedCandle(session: PaperTradingSession, candle: Candlestick, eventTime: number): PaperTradingSession {
  if (!session.active) return session;
  let next = session;
  // Fill a pending entry (initial open or add) when its limit is touched.
  if (next.pendingEntry && limitTouched(candle, next.pendingEntry.limitPrice)) {
    next = openPosition(next, next.pendingEntry.limitPrice, eventTime * 1000, {
      direction: next.pendingEntry.direction,
      positionRatioPercent: next.pendingEntry.positionRatioPercent ?? 100,
      leverage: next.pendingEntry.leverage ?? 1,
    });
  }
  // Close every leg whose own stop level this candle crossed (one leg = one
  // stop; each closes exactly that leg's remaining quantity at its price).
  if (next.position) {
    const touched = next.position.legs
      .filter((leg) => leg.stopPrice !== undefined && stopLossTouched(candle, next.position!.direction, leg.stopPrice!))
      .map((leg) => ({ id: leg.id, stopPrice: leg.stopPrice! }));
    for (const target of touched) {
      if (!next.position) break;
      const currentLeg = next.position.legs.find((leg) => leg.id === target.id);
      if (!currentLeg || currentLeg.quantity <= 0) continue;
      next = closeLegQuantity(next, target.id, target.stopPrice, eventTime * 1000, currentLeg.quantity);
    }
  }
  // A take-profit exit limit fires only if some position still remains.
  if (next.position && next.pendingExit && limitTouched(candle, next.pendingExit.limitPrice)) {
    const order = next.pendingExit;
    next = fillExitOrder({ ...next, pendingExit: null }, order, eventTime);
  }
  return next;
}

export function paperTradingStats(session: PaperTradingSession, currentCandle: Candlestick | null): PaperStats {
  const realizedPnl = session.trades.reduce((sum, trade) => sum + trade.pnl, 0);
  const winningTrades = session.trades.filter((trade) => trade.pnl > 0);
  const losingTrades = session.trades.filter((trade) => trade.pnl < 0);
  const averageWin = average(winningTrades.map((trade) => trade.pnl));
  const averageLoss = average(losingTrades.map((trade) => Math.abs(trade.pnl)));
  const floatingPnl = session.position && currentCandle ? pnlForPosition(session.position, currentCandle.close) : null;
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
  const byPosition = new Map<string, PaperTrade>();
  const markers: SeriesMarker<UTCTimestamp>[] = [];
  for (const trade of trades) {
    const isLong = trade.direction === 'long';
    if (!byPosition.has(trade.positionId)) {
      byPosition.set(trade.positionId, trade);
      markers.push({
        time: freeReplayCursorTimeForProgress(trade.positionOpenTime / 1000, timeframe),
        position: isLong ? 'belowBar' : 'aboveBar',
        color: '#FACC15',
        shape: isLong ? 'arrowUp' : 'arrowDown',
        text: `开 ${trade.positionOpenPrice}`,
      });
    }
    markers.push({
      time: freeReplayCursorTimeForProgress(trade.exitTime / 1000, timeframe),
      position: isLong ? 'aboveBar' : 'belowBar',
      color: '#38BDF8',
      shape: isLong ? 'arrowDown' : 'arrowUp',
      text: `平 ${trade.exitPrice}`,
    });
  }
  markers.sort((a, b) => Number(a.time) - Number(b.time));
  return markers;
}

export function normalizePaperTradingSession(stored: unknown): PaperTradingSession {
  const s = (stored ?? {}) as Partial<PaperTradingSession> & {
    pendingStopLoss?: Partial<PaperOrder> | null;
    pendingStops?: Array<Partial<PaperOrder>> | null;
  };
  const base = initialPaperTradingSession();
  const rawLegs = (s.position?.legs ?? []) as Array<Partial<PaperLeg>>;
  const legs = rawLegs.length > 0 ? rawLegs : legacyLegsFromPosition(s.position);
  // Legacy shapes kept stops separately (a single pendingStopLoss or a staged
  // pendingStops list). This version attaches one stop to each leg, so attach
  // them in leg order (oldest first) as a best-effort migration.
  const legacyStops = Array.isArray(s.pendingStops) && s.pendingStops.length > 0
    ? s.pendingStops
    : s.pendingStopLoss
      ? [s.pendingStopLoss]
      : [];
  const orderedStops = [...legacyStops].sort((a, b) => (a.createdAtCursorTime ?? 0) - (b.createdAtCursorTime ?? 0));
  const mappedLegs = legs.map((leg, index) => {
    const sourceStop = orderedStops[index];
    const stopPrice = typeof leg.stopPrice === 'number' ? leg.stopPrice
      : sourceStop && typeof sourceStop.limitPrice === 'number' && sourceStop.limitPrice > 0
        ? sourceStop.limitPrice
        : undefined;
    return { ...leg, stopPrice };
  });
  const position = s.position ? normalizePosition({ ...s.position, legs: mappedLegs }) : null;
  const positionQuantity = position?.quantity ?? 0;
  return {
    active: s.active === true,
    startedAtCursorTime: typeof s.startedAtCursorTime === 'number' ? s.startedAtCursorTime : null,
    nextId: typeof s.nextId === 'number' && s.nextId > 0 ? s.nextId : 1,
    pendingEntry: s.pendingEntry ? normalizeOrder(s.pendingEntry) : null,
    pendingExit: s.pendingExit ? normalizeExitOrder(s.pendingExit, positionQuantity) : null,
    position,
    trades: Array.isArray(s.trades) ? s.trades.map(normalizeTrade) : [],
  };
}

function openPosition(session: PaperTradingSession, entryPrice: number, entryTime: number, settings: PaperTradingSettings): PaperTradingSession {
  if (!session.active) return session;
  const normalized = normalizeSettings(settings);
  if (session.position && session.position.direction !== normalized.direction) return session;
  const margin = availableMargin(session) * normalized.positionRatioPercent / 100;
  if (margin <= 0) return session;
  const notional = margin * normalized.leverage;
  const quantity = notional / entryPrice;
  const leg: PaperLeg = {
    id: nextId(session, 'leg'),
    entryPrice,
    entryTime,
    quantity,
    margin,
    notional,
    leverage: normalized.leverage,
  };
  if (!session.position) {
    const position: PaperPosition = {
      id: nextId(session, 'position'),
      direction: normalized.direction,
      originPrice: entryPrice,
      originTime: entryTime,
      entryPrice,
      entryTime,
      quantity,
      margin,
      notional,
      leverage: normalized.leverage,
      legs: [leg],
    };
    return { ...session, nextId: session.nextId + 2, pendingEntry: null, position };
  }
  const position = recomputePosition({ ...session.position, legs: [...session.position.legs, leg] });
  return { ...session, nextId: session.nextId + 2, pendingEntry: null, position };
}

// Internal: fills the global take-profit limit. The order is already removed
// by the caller; its fixed quantity is capped by the remaining position.
function fillExitOrder(session: PaperTradingSession, order: PaperOrder, eventTime: number): PaperTradingSession {
  if (!session.position) return session;
  const closeQuantity = Math.min(order.quantity ?? 0, session.position.quantity);
  if (closeQuantity <= 0) return session;
  return closeQuantityFor(session, order.limitPrice, eventTime * 1000, closeQuantity);
}

// FIFO close over the aggregated legs (manual market close / take-profit).
function closeQuantityFor(session: PaperTradingSession, exitPrice: number, exitTime: number, closeQuantity: number): PaperTradingSession {
  if (!session.position || closeQuantity <= 0) return session;
  const position = session.position;
  let remaining = Math.min(closeQuantity, position.quantity);
  const legs: PaperLeg[] = [];
  let consumedQuantity = 0;
  let margin = 0;
  let notional = 0;
  let entrySum = 0;
  let pnl = 0;
  let firstConsumedEntryTime = 0;
  for (const leg of position.legs) {
    if (remaining <= 0) {
      legs.push(leg);
      continue;
    }
    const take = Math.min(remaining, leg.quantity);
    remaining -= take;
    if (firstConsumedEntryTime === 0) firstConsumedEntryTime = leg.entryTime;
    const delta = position.direction === 'long' ? exitPrice - leg.entryPrice : leg.entryPrice - exitPrice;
    pnl += delta * take;
    margin += leg.margin * (take / leg.quantity);
    notional += leg.notional * (take / leg.quantity);
    entrySum += leg.entryPrice * take;
    consumedQuantity += take;
    const leftoverQuantity = leg.quantity - take;
    if (leftoverQuantity > 0) {
      const fraction = leftoverQuantity / leg.quantity;
      legs.push({ ...leg, quantity: leftoverQuantity, margin: leg.margin * fraction, notional: leg.notional * fraction });
    }
  }
  if (consumedQuantity <= 0) return session;
  const trade: PaperTrade = {
    id: nextId(session, 'fill'),
    positionId: position.id,
    direction: position.direction,
    entryPrice: entrySum / consumedQuantity,
    entryTime: firstConsumedEntryTime,
    positionOpenPrice: position.originPrice,
    positionOpenTime: position.originTime,
    exitPrice,
    exitTime,
    quantity: consumedQuantity,
    margin,
    notional,
    leverage: notional / margin,
    pnl,
    returnRate: pnl / margin,
  };
  const totalQuantity = legs.reduce((sum, leg) => sum + leg.quantity, 0);
  const base: PaperTradingSession = { ...session, nextId: session.nextId + 1, trades: [...session.trades, trade] };
  if (totalQuantity <= 0) {
    return { ...base, position: null, pendingExit: null };
  }
  return { ...base, position: recomputePosition({ ...position, legs }) };
}

// Closes quantity out of one specific leg, used by the per-leg stop trigger
// (manual market closes are whole-position FIFO only). A partial close keeps
// the leg (and its own stop) with the remaining quantity; a full close removes
// the leg. The remaining aggregated position is recomputed.
function closeLegQuantity(session: PaperTradingSession, legId: string, exitPrice: number, exitTime: number, closeQuantity: number): PaperTradingSession {
  if (!session.position || closeQuantity <= 0) return session;
  const position = session.position;
  const leg = position.legs.find((item) => item.id === legId);
  if (!leg || leg.quantity <= 0) return session;
  const consumed = Math.min(closeQuantity, leg.quantity);
  const fraction = consumed / leg.quantity;
  const delta = position.direction === 'long' ? exitPrice - leg.entryPrice : leg.entryPrice - exitPrice;
  const pnl = delta * consumed;
  const marginConsumed = leg.margin * fraction;
  const trade: PaperTrade = {
    id: nextId(session, 'fill'),
    positionId: position.id,
    direction: position.direction,
    entryPrice: leg.entryPrice,
    entryTime: leg.entryTime,
    positionOpenPrice: position.originPrice,
    positionOpenTime: position.originTime,
    exitPrice,
    exitTime,
    quantity: consumed,
    margin: marginConsumed,
    notional: leg.notional * fraction,
    leverage: leg.leverage,
    pnl,
    returnRate: marginConsumed > 0 ? pnl / marginConsumed : 0,
  };
  const leftover = leg.quantity - consumed;
  const remainingLegs = leftover > 0
    ? position.legs.map((item) => (item.id === legId
        ? { ...leg, quantity: leftover, margin: leg.margin * (1 - fraction), notional: leg.notional * (1 - fraction) }
        : item))
    : position.legs.filter((item) => item.id !== legId);
  const base: PaperTradingSession = { ...session, nextId: session.nextId + 1, trades: [...session.trades, trade] };
  if (remainingLegs.length === 0) {
    return { ...base, position: null, pendingExit: null };
  }
  return { ...base, position: recomputePosition({ ...position, legs: remainingLegs }) };
}

function recomputePosition(position: PaperPosition): PaperPosition {
  const quantity = position.legs.reduce((sum, leg) => sum + leg.quantity, 0);
  const margin = position.legs.reduce((sum, leg) => sum + leg.margin, 0);
  const notional = position.legs.reduce((sum, leg) => sum + leg.notional, 0);
  const entryPrice = quantity > 0 ? position.legs.reduce((sum, leg) => sum + leg.entryPrice * leg.quantity, 0) / quantity : 0;
  return {
    ...position,
    entryPrice,
    quantity,
    margin,
    notional,
    leverage: margin > 0 ? notional / margin : 0,
  };
}

function isValidStopLossPrice(direction: PaperDirection, stopPrice: number, currentPrice: number): boolean {
  if (!isPositiveFinite(stopPrice) || !Number.isFinite(currentPrice) || currentPrice <= 0) return false;
  return direction === 'long' ? stopPrice < currentPrice : stopPrice > currentPrice;
}

function normalizeSettings(settings: PaperTradingSettings): PaperTradingSettings {
  return {
    direction: settings.direction,
    positionRatioPercent: clamp(settings.positionRatioPercent, 1, 100),
    leverage: clamp(settings.leverage, 1, 125),
  };
}

function normalizeCloseRatio(value: number): number {
  return clamp(value, 1, 100);
}

function legacyLegsFromPosition(position: Partial<Omit<PaperPosition, 'legs'>> | null | undefined): Array<Partial<PaperLeg>> {
  if (!position) return [];
  const source = position as Partial<Omit<PaperPosition, 'legs'>> & { entryPrice?: number; entryTime?: number; quantity?: number; margin?: number; notional?: number; leverage?: number };
  return [{
    id: 'leg-1',
    entryPrice: source.originPrice ?? source.entryPrice ?? 0,
    entryTime: source.originTime ?? source.entryTime ?? 0,
    quantity: source.quantity ?? 0,
    margin: source.margin ?? 0,
    notional: source.notional ?? 0,
    leverage: source.leverage ?? 1,
  }];
}

function normalizePosition(position: Partial<Omit<PaperPosition, 'legs'>> & { id?: string; direction?: PaperDirection; legs?: Array<Partial<PaperLeg>> }): PaperPosition {
  const source = (position ?? {}) as Partial<Omit<PaperPosition, 'legs'>> & { id?: string; direction?: PaperDirection; legs?: Array<Partial<PaperLeg>> };
  const direction = source.direction ?? 'long';
  const rawLegs = (Array.isArray(source.legs) && source.legs.length > 0 ? source.legs : legacyLegsFromPosition(source)) as Array<Partial<PaperLeg>>;
  const legs: PaperLeg[] = rawLegs.map((leg, index) => ({
    id: typeof leg.id === 'string' && leg.id ? leg.id : `leg-${index + 1}`,
    entryPrice: leg.entryPrice ?? 0,
    entryTime: leg.entryTime ?? 0,
    quantity: leg.quantity ?? 0,
    margin: leg.margin ?? 0,
    notional: leg.notional ?? 0,
    leverage: leg.leverage ?? 1,
    stopPrice: typeof leg.stopPrice === 'number' ? leg.stopPrice : undefined,
  }));
  const id = typeof source.id === 'string' ? source.id : 'position-1';
  const first = legs[0];
  return recomputePosition({
    id,
    direction,
    originPrice: source.originPrice ?? source.entryPrice ?? first?.entryPrice ?? 0,
    originTime: source.originTime ?? source.entryTime ?? first?.entryTime ?? 0,
    entryPrice: source.entryPrice ?? first?.entryPrice ?? 0,
    entryTime: source.entryTime ?? first?.entryTime ?? 0,
    quantity: source.quantity ?? 0,
    margin: source.margin ?? 0,
    notional: source.notional ?? 0,
    leverage: source.leverage ?? 1,
    legs,
  });
}

function normalizeOrder(order: PaperOrder): PaperOrder {
  return {
    ...order,
    limitPrice: order.limitPrice,
    positionRatioPercent: order.positionRatioPercent ?? 100,
    leverage: order.leverage ?? 1,
  };
}

// Legacy take-profit/exit orders carried a quantity or a closeRatioPercent.
function normalizeExitOrder(order: Partial<PaperOrder> & { closeRatioPercent?: number } | null | undefined, positionQuantity: number): PaperOrder | null {
  const raw = (order ?? {}) as Partial<PaperOrder> & { closeRatioPercent?: number };
  const limitPrice = raw.limitPrice;
  if (typeof limitPrice !== 'number' || !isPositiveFinite(limitPrice)) return null;
  let quantity = typeof raw.quantity === 'number' && raw.quantity > 0 ? raw.quantity : 0;
  if (quantity <= 0 && positionQuantity > 0) {
    quantity = positionQuantity * clamp(raw.closeRatioPercent ?? 100, 1, 100) / 100;
  }
  if (quantity <= 0) return null;
  return {
    id: typeof raw.id === 'string' ? raw.id : 'exit-0',
    kind: 'exit',
    direction: raw.direction ?? 'long',
    limitPrice,
    quantity,
    createdAtCursorTime: typeof raw.createdAtCursorTime === 'number' ? raw.createdAtCursorTime : 0,
  };
}

function normalizeTrade(trade: PaperTrade): PaperTrade {
  const source = (trade ?? {}) as Partial<PaperTrade>;
  const id = typeof source.id === 'string' ? source.id : 'fill-0';
  return {
    id,
    positionId: source.positionId ?? id,
    direction: source.direction ?? 'long',
    entryPrice: source.entryPrice ?? 0,
    entryTime: source.entryTime ?? 0,
    positionOpenPrice: source.positionOpenPrice ?? source.entryPrice ?? 0,
    positionOpenTime: source.positionOpenTime ?? source.entryTime ?? 0,
    exitPrice: source.exitPrice ?? 0,
    exitTime: source.exitTime ?? 0,
    quantity: source.quantity ?? 0,
    margin: source.margin ?? 0,
    notional: source.notional ?? 0,
    leverage: source.leverage ?? 1,
    pnl: source.pnl ?? 0,
    returnRate: source.returnRate ?? 0,
  };
}

function pnlForPosition(position: PaperPosition, exitPrice: number): number {
  const delta = position.direction === 'long' ? exitPrice - position.entryPrice : position.entryPrice - exitPrice;
  return delta * position.quantity;
}

function limitTouched(candle: Candlestick, limitPrice: number): boolean {
  return candle.low <= limitPrice && limitPrice <= candle.high;
}

function stopLossTouched(candle: Candlestick, direction: PaperDirection, stopPrice: number): boolean {
  return direction === 'long' ? candle.low <= stopPrice : candle.high >= stopPrice;
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
