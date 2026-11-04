import type { TradeReview } from '../domain/review';

/** Map of round review id → saved review, i.e. the paper module's annotation cache. */
export type PaperReviewMap = Record<string, TradeReview>;

/** Applies a global tag rename (`to` set) or delete (`to` null) to local paper reviews. */
export function rewritePaperReviewTags(reviews: PaperReviewMap, from: string, to: string | null): PaperReviewMap {
  const next: PaperReviewMap = {};
  for (const [id, review] of Object.entries(reviews)) {
    if (!review.tags.includes(from)) {
      next[id] = review;
      continue;
    }
    const tags = to === null
      ? review.tags.filter((tag) => tag !== from)
      : [...new Set(review.tags.map((tag) => (tag === from ? to : tag)))];
    next[id] = { ...review, tags };
  }
  return next;
}
