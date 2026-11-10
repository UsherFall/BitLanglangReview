import type { ViteDevServer } from 'vite';
import { paperSessionReviewPrefix, scopeReviewsToPaperRounds } from '../domain/paper-round';
import type { TradeReview } from '../domain/review';
import { reviewTimeframes, type ReviewTimeframe } from '../domain/trade';
import { freeReplayInstrumentPayload } from './free-replay-instruments';
import type { FreeReplaySessionStore, SaveFreeReplaySessionInput } from './free-replay-session-store';
import { buildPaperRoundLibrary } from './paper-rounds';
import type { ReviewStore } from './review-store';
import { readBody, send, tagPayload } from './route-support';

export type FreeReplayInstrumentRoutesDependencies = {
  createBinanceInstruments: () => Parameters<typeof freeReplayInstrumentPayload>[0];
  okxInstruments: { listSwapInstruments: () => Promise<string[]> };
  bitgetSymbols: () => Promise<string[]>;
};

export function registerFreeReplayInstrumentRoutes(server: ViteDevServer, deps: FreeReplayInstrumentRoutesDependencies): void {
  server.middlewares.use('/api/free-replay/instruments', async (req, res) => {
    if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
    const url = new URL(req.url ?? '', 'http://local');
    try {
      const raw = url.searchParams.get('source');
      const source: 'okx' | 'bitget' | 'binance' = raw === 'okx' || raw === 'bitget' ? raw : 'binance';
      const service = source === 'okx'
        ? { listTradableUsdtSymbols: () => Promise.resolve([]), listSwapInstruments: () => deps.okxInstruments.listSwapInstruments() }
        : deps.createBinanceInstruments();
      const bitgetSymbols = source === 'bitget' ? deps.bitgetSymbols : undefined;
      send(res, 200, await freeReplayInstrumentPayload(service, source, bitgetSymbols));
    } catch (error) {
      send(res, 502, { error: error instanceof Error ? error.message : 'Failed to load instruments' });
    }
  });
}

export type FreeReplaySessionRoutesDependencies = {
  freeReplaySessionStore: FreeReplaySessionStore;
  reviewStore: ReviewStore;
  scopedReviewsForModule: (module?: string) => TradeReview[];
};

export function registerFreeReplaySessionRoutes(server: ViteDevServer, deps: FreeReplaySessionRoutesDependencies): void {
  const { freeReplaySessionStore, reviewStore, scopedReviewsForModule } = deps;
  server.middlewares.use('/api/free-replay/sessions', async (req, res) => {
    const url = new URL(req.url ?? '', 'http://local');
    if (req.method === 'GET') {
      return send(res, 200, { sessions: freeReplaySessionStore.listSessions() });
    }
    if (req.method === 'PUT') {
      const parsed = JSON.parse(await readBody(req) || '{}') as SaveFreeReplaySessionInput;
      if (!parsed.instrument || !parsed.startTime || !reviewTimeframes.includes(parsed.timeframe as ReviewTimeframe)) {
        return send(res, 400, { error: 'instrument, startTime, and a valid timeframe are required' });
      }
      // 11/10 结束/恢复复盘：状态缺省按 active，仅接受 active | ended。
      if (parsed.reviewStatus !== undefined && parsed.reviewStatus !== 'active' && parsed.reviewStatus !== 'ended') {
        return send(res, 400, { error: 'reviewStatus must be active or ended' });
      }
      return send(res, 200, freeReplaySessionStore.saveSession({ ...parsed, reviewStatus: parsed.reviewStatus ?? 'active' }));
    }
    if (req.method === 'DELETE') {
      const instrument = url.searchParams.get('instrument') ?? '';
      const startTime = url.searchParams.get('startTime') ?? '';
      if (!instrument || !startTime) {
        return send(res, 400, { error: 'instrument and startTime are required' });
      }
      // One SQLite transaction owns both deletions; the trailing colon protects
      // a session whose start time merely shares the leading digits.
      const { deletedReviews } = freeReplaySessionStore.deleteSessionWithPaperReviews(
        instrument,
        startTime,
        paperSessionReviewPrefix(instrument, startTime),
      );
      return send(res, 200, { ok: true, deletedReviews });
    }
    return send(res, 405, { error: 'Method not allowed' });
  });

  server.middlewares.use('/api/paper/rounds', async (req, res) => {
    if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
    const url = new URL(req.url ?? '', 'http://local');
    const { rounds, sessions, reviews } = buildPaperRoundLibrary(
      freeReplaySessionStore.listSessions(),
      reviewStore.listReviews(),
      {
        tag: url.searchParams.get('tag') || undefined,
        starred: (url.searchParams.get('starred') as 'yes' | 'no' | null) || undefined,
        session: url.searchParams.get('session') || undefined,
      },
    );
    send(res, 200, {
      rounds,
      sessions,
      reviews,
      ...tagPayload(reviewStore, scopedReviewsForModule('paper')),
    });
  });
}
