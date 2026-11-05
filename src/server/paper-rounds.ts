import {
  filterPaperRounds,
  groupFillsIntoRounds,
  isPaperReviewId,
  type PaperRound,
  type PaperRoundFilters,
  type PaperRoundLibraryResponse,
  type PaperRoundSessionRow,
} from '../domain/paper-round';
import { normalizePaperTrades } from '../domain/paper-trading';
import type { TradeReview } from '../domain/review';

/**
 * One replay session with at least one closed Paper Round — the library's
 * 「来源会话」 filter options.
 */
export type PaperRoundSession = PaperRoundSessionRow;

/** Derivation always returns every review; API tags/counts are added downstream. */
export type PaperRoundLibrary = Pick<Required<PaperRoundLibraryResponse>, 'rounds' | 'sessions' | 'reviews'>;

/**
 * Builds the Paper Round library from the persisted sessions plus the saved
 * reviews (11/04).
 *
 * Pure: the route hands in `listSessions()` and `listReviews()` results, so the
 * derivation rules stay testable without a database or an HTTP server.
 *
 * - Rounds come from the session blob via `groupFillsIntoRounds`, which drops
 *   the still-open round (R2): a round enters the library only once fully closed.
 * - Annotations are joined by the round's `paper:` id, so one review row serves
 *   both the in-replay row and the library row (same data, two entries).
 * - Filtering happens AFTER the join (tag/starred need the review) and the
 *   session list is computed BEFORE filtering, so narrowing the list never
 *   empties the source-session dropdown.
 */
export function buildPaperRoundLibrary(
  sessions: readonly { instrument: string; startTime: string; updatedAt: string; paperTrading: unknown }[],
  reviews: readonly TradeReview[],
  filters: PaperRoundFilters = {},
): PaperRoundLibrary {
  const reviewsById = new Map(
    reviews.filter((review) => isPaperReviewId(review.tradeId)).map((review) => [review.tradeId, review]),
  );

  const rounds: PaperRound[] = [];
  const sessionRows: PaperRoundSession[] = [];
  for (const session of sessions) {
    const paper = session.paperTrading as { position?: { id?: unknown } | null; trades?: unknown } | null | undefined;
    const trades = normalizePaperTrades(paper?.trades);
    if (trades.length === 0) continue;
    const openPositionId = typeof paper?.position?.id === 'string' ? paper.position.id : null;
    const sessionRounds = groupFillsIntoRounds(trades, {
      instrument: session.instrument,
      startTime: session.startTime,
      openPositionId,
    }).map((round) => {
      const review = reviewsById.get(round.id);
      return review ? { ...round, review } : round;
    });
    if (sessionRounds.length === 0) continue;
    rounds.push(...sessionRounds);
    sessionRows.push({
      instrument: session.instrument,
      startTime: session.startTime,
      updatedAt: session.updatedAt,
      roundCount: sessionRounds.length,
    });
  }

  return {
    rounds: filterPaperRounds(rounds, filters),
    sessions: sessionRows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    reviews: [...reviewsById.values()],
  };
}
