import type { PaperDirection, PaperTrade } from './paper-trading';
import type { TradeReview } from './review';

/**
 * One Paper Round (11/04) = one `PaperPosition` from open to fully closed.
 *
 * Annotation granularity is the ROUND, not the fill: a position closed in three
 * partial closes is ONE reviewable round with three fills. The round's market
 * data is derived from the session blob on demand (single source of truth stays
 * `free_replay_sessions.paper_trading_json`), so nothing here is persisted
 * except the review fields merged in by the server.
 */
export type PaperRound = {
  /** Globally stable review id, see `paperRoundReviewId`. */
  id: string;
  positionId: string;
  instrument: string;
  /** The owning session's start time (the other half of the session key). */
  startTime: string;
  direction: PaperDirection;
  /** FIFO basis of every fill in the round (quantity-weighted). */
  entryPrice: number;
  entryTime: number;
  /** Last fill's exit — the round's closing price. */
  exitPrice: number;
  /** Last fill's exit time (ms) — the round's closedAt, the library sort key. */
  exitTime: number;
  positionOpenPrice: number;
  positionOpenTime: number;
  quantity: number;
  margin: number;
  notional: number;
  leverage: number;
  pnl: number;
  /** Realized pnl over the round's consumed margin. */
  returnRate: number;
  /** How many fills (partial closes) make up this round. */
  fillCount: number;
  /** The fills' own ids, oldest first — used by the UI to focus the last one. */
  tradeIds: string[];
  /** Present once the round carries a saved review; absent otherwise. */
  review?: TradeReview;
};

/**
 * The round's review id: `paper:{instrument}:{startTime}:{positionId}`.
 *
 * `(instrument, startTime)` is the session primary key and `positionId` is
 * session-scoped-but-persisted (`position-N`), so the triple is stable across
 * restores. `paper:` keeps these rows out of the `trade` / `bitget` (bg-)
 * review scopes while tag NAMES stay global (R4).
 */
export function paperRoundReviewId(instrument: string, startTime: string, positionId: string): string {
  return `paper:${instrument}:${startTime}:${positionId}`;
}

/** The review prefix owned by ONE session — the cascade-delete boundary. */
export function paperSessionReviewPrefix(instrument: string, startTime: string): string {
  return `paper:${instrument}:${startTime}:`;
}

/** Whether a review id belongs to the paper module at all. */
export function isPaperReviewId(reviewId: string): boolean {
  return reviewId.startsWith('paper:');
}

/**
 * Keeps only the reviews attached to Paper Rounds (11/04).
 *
 * This is the paper module's review scope: tag LISTS and per-tag `N 笔` counts
 * for the paper module must not include real trades (`bg-` / workbook ids), and
 * the real modules' scopes exclude `paper:` ids by construction. Tag NAMES stay
 * global because they live inside each review row.
 */
export function scopeReviewsToPaperRounds(reviews: readonly TradeReview[]): TradeReview[] {
  return reviews.filter((review) => isPaperReviewId(review.tradeId));
}

/** The `{instrument}:{startTime}` session key used by list filters and React keys. */
export function paperSessionKey(instrument: string, startTime: string): string {
  return `${instrument}:${startTime}`;
}

/**
 * Groups a session's fills into rounds, EXCLUDING the still-open round.
 *
 * `openPositionId` is `session.position?.id`: its round has no closing price
 * yet, so it stays out of the library until fully closed (R2). `any` partial
 * closes of that open round are excluded too — a round is either closed or not.
 *
 * Rounds come back newest-closed first (the library's default order).
 */
export function groupFillsIntoRounds(
  trades: readonly PaperTrade[],
  options: { instrument: string; startTime: string; openPositionId?: string | null },
): PaperRound[] {
  const { instrument, startTime, openPositionId } = options;
  const byPosition = new Map<string, PaperTrade[]>();
  for (const trade of trades) {
    if (openPositionId && trade.positionId === openPositionId) continue;
    const bucket = byPosition.get(trade.positionId);
    if (bucket) bucket.push(trade);
    else byPosition.set(trade.positionId, [trade]);
  }

  const rounds: PaperRound[] = [];
  for (const [positionId, fills] of byPosition) {
    // Oldest first: FIFO basis and "last fill" both read naturally in this order.
    const ordered = [...fills].sort((a, b) => a.exitTime - b.exitTime);
    const quantity = ordered.reduce((sum, fill) => sum + fill.quantity, 0);
    const margin = ordered.reduce((sum, fill) => sum + fill.margin, 0);
    const notional = ordered.reduce((sum, fill) => sum + fill.notional, 0);
    const pnl = ordered.reduce((sum, fill) => sum + fill.pnl, 0);
    const last = ordered[ordered.length - 1];
    const first = ordered[0];
    rounds.push({
      id: paperRoundReviewId(instrument, startTime, positionId),
      positionId,
      instrument,
      startTime,
      direction: first.direction,
      entryPrice: quantity > 0
        ? ordered.reduce((sum, fill) => sum + fill.entryPrice * fill.quantity, 0) / quantity
        : first.entryPrice,
      entryTime: first.entryTime,
      exitPrice: last.exitPrice,
      exitTime: last.exitTime,
      positionOpenPrice: first.positionOpenPrice,
      positionOpenTime: first.positionOpenTime,
      quantity,
      margin,
      notional,
      // Leverage is constant inside a round (one settings pair per position).
      leverage: last.leverage,
      pnl,
      returnRate: margin > 0 ? pnl / margin : 0,
      fillCount: ordered.length,
      tradeIds: ordered.map((fill) => fill.id),
    });
  }
  return rounds.sort((a, b) => b.exitTime - a.exitTime);
}

export type PaperRoundFilters = {
  /** Tag name the round must carry. */
  tag?: string;
  /** `yes` = starred only, `no` = unstarred only; anything else = no filter. */
  starred?: 'yes' | 'no';
  /** `{instrument}:{startTime}` of the owning session. */
  session?: string;
};

/** Applies the library filters. All conditions AND together. */
export function filterPaperRounds(rounds: readonly PaperRound[], filters: PaperRoundFilters = {}): PaperRound[] {
  const { tag, starred, session } = filters;
  return rounds.filter((round) => {
    if (tag && !(round.review?.tags ?? []).includes(tag)) return false;
    if (starred === 'yes' && !round.review?.starred) return false;
    if (starred === 'no' && round.review?.starred) return false;
    if (session && paperSessionKey(round.instrument, round.startTime) !== session) return false;
    return true;
  });
}
