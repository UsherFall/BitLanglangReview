import type { TradeReview } from '../domain/review';
import type { ReviewQueueOptions } from '../domain/review-queue';
import type { ReviewStore } from './review-store';

export function send(res: { statusCode: number; setHeader(name: string, value: string): void; end(body: string): void }, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export function readBody(req: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export function toQueueOptions(params: URLSearchParams): ReviewQueueOptions {
  return {
    instrument: params.get('instrument') || undefined,
    direction: (params.get('direction') as ReviewQueueOptions['direction']) || undefined,
    startDate: params.get('startDate') || undefined,
    endDate: params.get('endDate') || undefined,
    result: (params.get('result') as ReviewQueueOptions['result']) || undefined,
    tag: params.get('tag') || undefined,
    starred: (params.get('starred') as ReviewQueueOptions['starred']) || undefined,
    noteState: (params.get('noteState') as ReviewQueueOptions['noteState']) || undefined,
    sortField: (params.get('sortField') as ReviewQueueOptions['sortField']) || undefined,
    sortDirection: (params.get('sortDirection') as ReviewQueueOptions['sortDirection']) || undefined,
  };
}

/** The global tag list plus its per-tag usage counts for the supplied scope. */
export function tagPayload(store: ReviewStore, reviews: readonly TradeReview[]) {
  return {
    tags: [...new Set(reviews.flatMap((review) => review.tags))].sort(),
    tagCounts: store.listTagCounts(reviews),
  };
}
