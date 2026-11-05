import type { ViteDevServer } from 'vite';
import { buildReviewQueue } from '../domain/build-review-queue';
import { scopeReviewsToTrades, type TradeReview } from '../domain/review';
import type { Trade } from '../domain/trade';
import type { TradeResponse } from '../domain/review-queue';
import type { ReviewStore } from './review-store';
import { readBody, send, tagPayload, toQueueOptions } from './route-support';

export type ReviewRoutesDependencies = {
  trades: Trade[];
  reviewStore: ReviewStore;
  scopedReviewsForModule: (module?: string) => TradeReview[];
};

/** Trade Review queue, annotations and global tag mutations (registration 1–4). */
export function registerReviewRoutes(server: ViteDevServer, deps: ReviewRoutesDependencies): void {
  const { trades, reviewStore, scopedReviewsForModule } = deps;
  server.middlewares.use('/api/trades', async (req, res) => {
    if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
    const url = new URL(req.url ?? '', 'http://local');
    const options = toQueueOptions(url.searchParams);
    const reviews = reviewStore.listReviews();
    const scopedReviews = scopeReviewsToTrades(reviews, trades.map((trade) => trade.id));
    const response: TradeResponse = {
      trades: buildReviewQueue(trades, reviews, options),
      instruments: [...new Set(trades.map((trade) => trade.instrument))].sort(),
      ...tagPayload(reviewStore, scopedReviews),
    };
    send(res, 200, response);
  });

  server.middlewares.use('/api/reviews', async (req, res) => {
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    const body = await readBody(req);
    const parsed = JSON.parse(body || '{}') as { tradeId?: string; tags?: string[]; note?: string; starred?: boolean; module?: string };
    if (!parsed.tradeId) return send(res, 400, { error: 'tradeId is required' });
    const review = reviewStore.saveReview({ tradeId: parsed.tradeId, tags: parsed.tags ?? [], note: parsed.note ?? '', starred: parsed.starred ?? false });
    send(res, 200, { review, ...tagPayload(reviewStore, scopedReviewsForModule(parsed.module)) });
  });

  server.middlewares.use('/api/tags/rename', async (req, res) => {
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    const parsed = JSON.parse((await readBody(req)) || '{}') as { from?: string; to?: string; module?: string };
    const from = parsed.from?.trim() ?? '';
    const to = parsed.to?.trim() ?? '';
    if (!from || !to) return send(res, 400, { error: 'from and to are required' });
    const affected = reviewStore.renameTag(from, to);
    send(res, 200, { affected, ...tagPayload(reviewStore, scopedReviewsForModule(parsed.module)) });
  });

  server.middlewares.use('/api/tags/delete', async (req, res) => {
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    const parsed = JSON.parse((await readBody(req)) || '{}') as { tag?: string; module?: string };
    const tag = parsed.tag?.trim() ?? '';
    if (!tag) return send(res, 400, { error: 'tag is required' });
    const affected = reviewStore.deleteTag(tag);
    send(res, 200, { affected, ...tagPayload(reviewStore, scopedReviewsForModule(parsed.module)) });
  });
}
