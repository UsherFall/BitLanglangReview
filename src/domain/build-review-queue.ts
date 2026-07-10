import type { TradeReview } from './review';
import type { ReviewQueueOptions, ReviewedTrade, SortField } from './review-queue';
import type { Trade } from './trade';

export function buildReviewQueue(trades: Trade[], reviews: TradeReview[], options: ReviewQueueOptions = {}): ReviewedTrade[] {
  const reviewsByTradeId = new Map(reviews.map((review) => [review.tradeId, review]));
  const sortField = options.sortField ?? 'entryTime';
  const sortDirection = options.sortDirection ?? 'asc';

  return trades
    .map((trade) => ({ ...trade, review: reviewsByTradeId.get(trade.id) ?? null }))
    .filter((trade) => matchesOptions(trade, options))
    .sort((a, b) => compareByField(a, b, sortField) * (sortDirection === 'asc' ? 1 : -1));
}

function matchesOptions(trade: ReviewedTrade, options: ReviewQueueOptions): boolean {
  if (options.instrument && trade.instrument !== options.instrument) return false;
  if (options.direction && trade.direction !== options.direction) return false;
  if (options.startDate && trade.entryTime.slice(0, 10) < options.startDate) return false;
  if (options.endDate && trade.entryTime.slice(0, 10) > options.endDate) return false;
  if (options.result === 'profit' && trade.profit <= 0) return false;
  if (options.result === 'loss' && trade.profit >= 0) return false;
  if (options.result === 'flat' && trade.profit !== 0) return false;
  if (options.tag && !(trade.review?.tags.includes(options.tag))) return false;
  if (options.starred === 'yes' && !trade.review?.starred) return false;
  if (options.starred === 'no' && trade.review?.starred) return false;
  if (options.noteState === 'withNote' && !trade.review?.note.trim()) return false;
  if (options.noteState === 'withoutNote' && trade.review?.note.trim()) return false;
  return true;
}

function compareByField(a: ReviewedTrade, b: ReviewedTrade, field: SortField): number {
  if (field === 'entryTime') return a.entryTime.localeCompare(b.entryTime);
  return a[field] - b[field];
}
