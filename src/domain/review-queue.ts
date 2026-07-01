import type { Trade } from './trade';
import type { TradeReview } from './review';

export type ReviewedTrade = Trade & {
  review: TradeReview | null;
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
  noteState?: 'withNote' | 'withoutNote';
  sortField?: SortField;
  sortDirection?: SortDirection;
};
