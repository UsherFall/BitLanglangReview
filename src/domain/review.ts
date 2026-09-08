export type TradeReview = {
  tradeId: string;
  tags: string[];
  note: string;
  starred: boolean;
  updatedAt: string;
};

/**
 * Keeps reviews attached to one module's trade universe (xlsx trade mode
 * vs `bg-` personal mode). Tag lists and per-tag counts must not span the
 * whole review store across review modules, while tag NAMES stay global.
 */
export function scopeReviewsToTrades(reviews: readonly TradeReview[], tradeIds: readonly string[]): TradeReview[] {
  const ids = new Set(tradeIds);
  return reviews.filter((review) => ids.has(review.tradeId));
}
