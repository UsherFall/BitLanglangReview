import type { ReviewedTrade } from '../domain/review-queue';

export type ReviewProgress = {
  total: number;
  reviewed: number;
  current: number;
  reviewedProfit: number;
};

export function isReviewedTrade(trade: ReviewedTrade): boolean {
  return (trade.review?.tags.length ?? 0) > 0;
}

export function reviewProgress(trades: ReviewedTrade[], selectedTradeId: string): ReviewProgress {
  const selectedIndex = trades.findIndex((trade) => trade.id === selectedTradeId);
  const reviewedTrades = trades.filter(isReviewedTrade);
  return {
    total: trades.length,
    reviewed: reviewedTrades.length,
    current: selectedIndex >= 0 ? selectedIndex + 1 : 0,
    reviewedProfit: reviewedTrades.reduce((sum, trade) => sum + trade.profit, 0),
  };
}

export function firstUnreviewedTrade(trades: ReviewedTrade[]): ReviewedTrade | null {
  return trades.find((trade) => !isReviewedTrade(trade)) ?? null;
}
