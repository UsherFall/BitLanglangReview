import type { Trade } from './trade';
import type { TradeReview } from './review';

export type ReviewedTrade = Trade & {
  review: TradeReview | null;
};

/** Shared `/api/trades` and `/api/bitget/trades` response contract. */
export type TradeResponse = {
  trades: ReviewedTrade[];
  instruments: string[];
  tags: string[];
  tagCounts: Record<string, number>;
  /** Present on the Bitget source; false until keys are configured. */
  configured?: boolean;
};

export type SortField = 'entryTime' | 'returnRate' | 'profit' | 'holdingMinutes';
export type SortDirection = 'asc' | 'desc';

export type ReviewQueueOptions = {
  instrument?: string;
  direction?: Trade['direction'];
  startDate?: string;
  endDate?: string;
  result?: 'profit' | 'loss' | 'flat';
  tag?: string;
  starred?: 'yes' | 'no';
  noteState?: 'withNote' | 'withoutNote';
  sortField?: SortField;
  sortDirection?: SortDirection;
};
