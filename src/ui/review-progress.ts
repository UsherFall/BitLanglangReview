import type { ReviewedTrade } from '../domain/review-queue';

export type ReviewProgress = {
  total: number;
  reviewed: number;
  current: number;
};

export function isReviewedTrade(trade: ReviewedTrade): boolean {
  return (trade.review?.tags.length ?? 0) > 0;
}

export function reviewProgress(trades: ReviewedTrade[], selectedTradeId: string): ReviewProgress {
  const selectedIndex = trades.findIndex((trade) => trade.id === selectedTradeId);
  return {
    total: trades.length,
    reviewed: trades.filter(isReviewedTrade).length,
    current: selectedIndex >= 0 ? selectedIndex + 1 : 0,
  };
}

export function firstUnreviewedTrade(trades: ReviewedTrade[]): ReviewedTrade | null {
  return trades.find((trade) => !isReviewedTrade(trade)) ?? null;
}
