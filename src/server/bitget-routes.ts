import type { ViteDevServer } from 'vite';
import { buildReviewQueue } from '../domain/build-review-queue';
import { ordersForRound } from '../domain/bitget-round-orders';
import { scopeReviewsToTrades, type TradeReview } from '../domain/review';
import type { BitgetKeyConfig } from './bitget-keys';
import { attachRoundOrders, historyPositionToTrade, toClosedRound } from './bitget-import';
import type { BitgetPositionStore } from './bitget-position-store';
import type { BitgetSyncResult } from './bitget-sync';
import type { ReviewStore } from './review-store';
import { readBody, send, tagPayload, toQueueOptions } from './route-support';

export type BitgetRoutesDependencies = {
  reviewStore: ReviewStore;
  bitgetPositionStore: BitgetPositionStore;
  scopedReviewsForModule: (module?: string) => TradeReview[];
  keys: {
    load: () => BitgetKeyConfig | null;
    save: (config: BitgetKeyConfig) => void;
    clear: () => void;
  };
  createSyncService: (keys: BitgetKeyConfig) => {
    sync: (input: { fromMs: number; wipe?: boolean }) => Promise<BitgetSyncResult>;
  };
};

function trimOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function registerBitgetRoutes(server: ViteDevServer, deps: BitgetRoutesDependencies): void {
  const { reviewStore, bitgetPositionStore, scopedReviewsForModule, keys, createSyncService } = deps;
  server.middlewares.use('/api/bitget/config', async (req, res) => {
    const url = new URL(req.url ?? '', 'http://local');
    if (req.method === 'GET') {
      return send(res, 200, { configured: keys.load() !== null });
    }
    if (req.method === 'POST') {
      const parsed = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>;
      const apiKey = trimOrEmpty(parsed.apiKey);
      const secret = trimOrEmpty(parsed.secret);
      const passphrase = trimOrEmpty(parsed.passphrase);
      if (!apiKey || !secret || !passphrase || apiKey.length > 256 || secret.length > 256 || passphrase.length > 256) {
        return send(res, 400, { error: 'apiKey, secret, and passphrase are all required (≤256 chars)' });
      }
      try {
        keys.save({ apiKey, secret, passphrase });
        return send(res, 200, { configured: true });
      } catch (error) {
        return send(res, 500, { error: error instanceof Error ? error.message : 'Failed to save Bitget API key' });
      }
    }
    if (req.method === 'DELETE') {
      keys.clear();
      return send(res, 200, { configured: false });
    }
    return send(res, 405, { error: 'Method not allowed' });
  });

  server.middlewares.use('/api/bitget/sync', async (req, res) => {
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    const configuredKeys = keys.load();
    if (!configuredKeys) return send(res, 400, { error: '尚未配置 Bitget API key' });
    const parsed = JSON.parse((await readBody(req)) || '{}') as { startTime?: unknown; wipe?: unknown };
    const fromMs = typeof parsed.startTime === 'number' && Number.isFinite(parsed.startTime)
      ? parsed.startTime
      : Date.now() - 90 * 24 * 60 * 60 * 1000;
    if (fromMs < 0) return send(res, 400, { error: 'Invalid startTime' });
    try {
      const result = await createSyncService(configuredKeys).sync({ fromMs, wipe: parsed.wipe === true });
      send(res, 200, result);
    } catch (error) {
      send(res, 502, { error: error instanceof Error ? error.message : 'Bitget sync failed' });
    }
  });

  server.middlewares.use('/api/bitget/trades', async (req, res) => {
    if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
    const url = new URL(req.url ?? '', 'http://local');
    const options = toQueueOptions(url.searchParams);
    const reviews = reviewStore.listReviews();
    const configured = keys.load() !== null;
    try {
      const ordersBySymbol = bitgetPositionStore.listOrdersBySymbol();
      const trades = configured
        ? bitgetPositionStore
            .listAll()
            .map((cached, sequence) => ({ cached, trade: historyPositionToTrade(cached.row, sequence) }))
            .map(({ cached, trade }) => {
              if (!trade) return null;
              const matched = ordersForRound(toClosedRound(cached.row), ordersBySymbol.get(cached.row.symbol) ?? []);
              return matched ? attachRoundOrders(trade, matched) : trade;
            })
            .filter((trade): trade is NonNullable<ReturnType<typeof historyPositionToTrade>> => trade !== null)
        : [];
      const queue = buildReviewQueue(trades, reviews, options);
      const scopedReviews = scopeReviewsToTrades(reviews, trades.map((trade) => trade.id));
      send(res, 200, {
        trades: queue,
        instruments: [...new Set(trades.map((trade) => trade.instrument))].sort(),
        configured,
        ...tagPayload(reviewStore, scopedReviews),
      });
    } catch (error) {
      send(res, 502, { error: error instanceof Error ? error.message : 'Failed to load Bitget trades' });
    }
  });
}
