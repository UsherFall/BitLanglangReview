/**
 * Paper trading types (11/04), moved down from `src/ui/free-replay-paper-trading.ts`.
 *
 * The server derives Paper Rounds from the persisted session blob
 * (`free_replay_sessions.paper_trading_json`), so it needs the shapes without
 * pulling in the UI runtime. ONLY types live here: every runtime helper (fill
 * pricing, FIFO closing, stats) stays in the UI module that owns the behaviour,
 * which re-exports these names so existing callers keep compiling.
 */

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

/**
 * Defensive shape for ONE stored fill (11/04).
 *
 * Two readers now parse the persisted session blob: the UI session normalizer
 * and the server's Paper Round derivation. They must agree on defaults, so the
 * rule lives here instead of being copied. Unknown/incomplete fills become
 * zeros rather than `NaN` (a `NaN` pnl would poison every round aggregate).
 */
export function normalizePaperTrade(trade: unknown): PaperTrade {
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

/** Every fill of a stored session blob, normalized; non-arrays read as none. */
export function normalizePaperTrades(trades: unknown): PaperTrade[] {
  return Array.isArray(trades) ? trades.map(normalizePaperTrade) : [];
}
