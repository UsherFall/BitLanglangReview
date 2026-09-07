import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { buildReviewQueue } from '../domain/build-review-queue';
import type { TradeReview } from '../domain/review';
import type { ReviewQueueOptions } from '../domain/review-queue';
import { reviewTimeframes, type ReviewTimeframe } from '../domain/trade';
import { BinanceCandleSource } from './binance-candles';
import { binanceInstrumentMetadata } from './binance-instrument-metadata';
import { BinanceTickerSource } from './binance-tickers';
import { BitgetClient } from './bitget-client';
import { historyPositionToTrade } from './bitget-import';
import { clearBitgetKeys, loadBitgetKeys, saveBitgetKeys } from './bitget-keys';
import { BitgetPositionStore } from './bitget-position-store';
import { BitgetSyncService } from './bitget-sync';
import { CandlestickService } from './candlestick-service';
import { CoinScanService } from './coin-scan-service';
import { CandlestickStore } from './candlestick-store';
import { DrawingStore } from './drawing-store';
import { freeReplayInstrumentPayload } from './free-replay-instruments';
import { FreeReplaySessionStore, type SaveFreeReplaySessionInput } from './free-replay-session-store';
import { MarketHeatService } from './market-heat-service';
import { OkxInstrumentService } from './okx-instrument-service';
import { OkxTickerSource } from './okx-tickers';
import { ReviewStore } from './review-store';
import { loadTradesFromWorkbook } from './trade-import';

const workbookPath = findSourceWorkbook();

export type TradingReviewApiPluginOptions = {
  /** Coin-scan ticker + candle data source. Defaults to Binance. */
  marketDataSource?: 'binance' | 'okx';
};

export function tradingReviewApiPlugin(options: TradingReviewApiPluginOptions = {}): Plugin {
  return {
    name: 'trading-review-api',
    configureServer(server) {
      fs.mkdirSync(path.resolve('data'), { recursive: true });
      const trades = loadTradesFromWorkbook(workbookPath);
      const reviewStore = new ReviewStore(path.resolve('data/review.sqlite'));
      const candleStore = new CandlestickStore(path.resolve('data/review.sqlite'));
      // FreeReplay / TradeReview always use the OKX candle service.
      const candleService = new CandlestickService(candleStore);
      // The coin scan uses the switchable market-data source.
      const marketDataSource = options.marketDataSource ?? process.env.MARKET_DATA_SOURCE ?? 'binance';
      // Market heat (市场热度) always runs on Binance: its pool is defined as
      // Binance USDT-M top-N and only Binance metadata can session-gate TradFi
      // contracts. Binance instances are shared with the scan when it is in
      // Binance mode so the 30s ticker TTL / 6h metadata cache stay shared.
      const binanceTickerSource = new BinanceTickerSource(undefined, binanceInstrumentMetadata());
      const binanceCandleSource = new BinanceCandleSource(candleStore);
      const tickerSource = marketDataSource === 'okx' ? new OkxTickerSource() : binanceTickerSource;
      const scanCandleSource = marketDataSource === 'okx' ? candleService : binanceCandleSource;
      const coinScanService = new CoinScanService(tickerSource, scanCandleSource);
      const marketHeatService = new MarketHeatService(binanceTickerSource, binanceCandleSource);
      const drawingStore = new DrawingStore(path.resolve('data/review.sqlite'));
      const freeReplaySessionStore = new FreeReplaySessionStore(path.resolve('data/review.sqlite'));
      const bitgetPositionStore = new BitgetPositionStore(path.resolve('data/review.sqlite'));
      const instrumentService = new OkxInstrumentService();

      server.middlewares.use('/api/trades', async (req, res) => {
        if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
        const url = new URL(req.url ?? '', 'http://local');
        const options = toQueueOptions(url.searchParams);
        const reviews = reviewStore.listReviews();
        send(res, 200, {
          trades: buildReviewQueue(trades, reviews, options),
          instruments: [...new Set(trades.map((trade) => trade.instrument))].sort(),
          ...tagPayload(reviewStore, reviews),
        });
      });

      server.middlewares.use('/api/reviews', async (req, res) => {
        if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
        const body = await readBody(req);
        const parsed = JSON.parse(body || '{}') as { tradeId?: string; tags?: string[]; note?: string; starred?: boolean };
        if (!parsed.tradeId) return send(res, 400, { error: 'tradeId is required' });
        send(res, 200, reviewStore.saveReview({ tradeId: parsed.tradeId, tags: parsed.tags ?? [], note: parsed.note ?? '', starred: parsed.starred ?? false }));
      });

      // Tag names are shared across every review, so renaming / deleting is a
      // global operation: it rewrites all reviews carrying the tag. Both routes
      // answer with the recomputed global tag list + counts so the UI can patch
      // its state instead of refetching /api/trades.
      server.middlewares.use('/api/tags/rename', async (req, res) => {
        if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
        const parsed = JSON.parse((await readBody(req)) || '{}') as { from?: string; to?: string };
        const from = parsed.from?.trim() ?? '';
        const to = parsed.to?.trim() ?? '';
        if (!from || !to) return send(res, 400, { error: 'from and to are required' });
        const affected = reviewStore.renameTag(from, to);
        send(res, 200, { affected, ...tagPayload(reviewStore, reviewStore.listReviews()) });
      });

      server.middlewares.use('/api/tags/delete', async (req, res) => {
        if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
        const parsed = JSON.parse((await readBody(req)) || '{}') as { tag?: string };
        const tag = parsed.tag?.trim() ?? '';
        if (!tag) return send(res, 400, { error: 'tag is required' });
        const affected = reviewStore.deleteTag(tag);
        send(res, 200, { affected, ...tagPayload(reviewStore, reviewStore.listReviews()) });
      });

      server.middlewares.use('/api/free-replay/instruments', async (req, res) => {
        if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
        try {
          send(res, 200, await freeReplayInstrumentPayload(instrumentService));
        } catch (error) {
          send(res, 502, { error: error instanceof Error ? error.message : 'Failed to load instruments' });
        }
      });

      server.middlewares.use('/api/candles', async (req, res) => {
        if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
        const url = new URL(req.url ?? '', 'http://local');
        const instrument = url.searchParams.get('instrument') ?? '';
        const timeframe = url.searchParams.get('timeframe') as ReviewTimeframe | null;
        const mode = url.searchParams.get('mode') ?? 'initial';
        const anchor = Number(url.searchParams.get('anchor'));
        const entryTime = url.searchParams.get('entryTime') ?? '';
        if (!instrument || !timeframe || !reviewTimeframes.includes(timeframe) || !entryTime) {
          return send(res, 400, { error: 'instrument, timeframe, and entryTime are required' });
        }
        try {
          const candles = await getCandlesForMode({ candleService, instrument, timeframe, entryTime, mode, anchor });
          send(res, 200, { candles });
        } catch (error) {
          send(res, 502, { error: error instanceof Error ? error.message : 'Failed to load candlesticks' });
        }
      });

      server.middlewares.use('/api/drawings', async (req, res) => {
        const url = new URL(req.url ?? '', 'http://local');
        if (req.method === 'GET') {
          const instrument = url.searchParams.get('instrument') ?? '';
          if (!instrument) {
            return send(res, 400, { error: 'instrument is required' });
          }
          return send(res, 200, { drawings: drawingStore.listDrawings({ instrument }) });
        }
        if (req.method === 'POST') {
          const parsed = JSON.parse(await readBody(req) || '{}');
          return send(res, 200, drawingStore.saveDrawing(parsed));
        }
        if (req.method === 'DELETE') {
          const id = url.searchParams.get('id') ?? '';
          if (!id) return send(res, 400, { error: 'id is required' });
          drawingStore.deleteDrawing(id);
          return send(res, 200, { ok: true });
        }
        return send(res, 405, { error: 'Method not allowed' });
      });

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
          return send(res, 200, freeReplaySessionStore.saveSession(parsed));
        }
        if (req.method === 'DELETE') {
          const instrument = url.searchParams.get('instrument') ?? '';
          const startTime = url.searchParams.get('startTime') ?? '';
          if (!instrument || !startTime) {
            return send(res, 400, { error: 'instrument and startTime are required' });
          }
          freeReplaySessionStore.deleteSession(instrument, startTime);
          return send(res, 200, { ok: true });
        }
        return send(res, 405, { error: 'Method not allowed' });
      });

      server.middlewares.use('/api/scan', async (req, res) => {
        if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
        const url = new URL(req.url ?? '', 'http://local');
        if (url.searchParams.get('method') !== 'shrink') {
          return send(res, 400, { error: 'Unsupported scan method' });
        }
        const topN = parseScanParam(url.searchParams.get('topN'), 60);
        const minQuoteVolume24h = parseScanParam(url.searchParams.get('minQuoteVolume24h'), 10_000_000);
        // anchor/minScore are optional. parseScanParam's Number(null) === 0
        // defect would turn an absent param into 0 and trip the guard, so parse
        // them with an optional parser that maps null/empty/NaN → undefined.
        const anchor = parseOptionalNumber(url.searchParams.get('anchor'));
        const minScore = parseOptionalNumber(url.searchParams.get('minScore'));
        if (topN < 1 || minQuoteVolume24h < 0) {
          return send(res, 400, { error: 'Invalid scan parameters' });
        }
        if (anchor !== undefined && anchor <= 0) {
          return send(res, 400, { error: 'Invalid scan parameters' });
        }
        if (minScore !== undefined && minScore < 0) {
          return send(res, 400, { error: 'Invalid scan parameters' });
        }
        try {
          const result = await coinScanService.scanShrink({
            method: 'shrink',
            topN,
            minQuoteVolume24h,
            anchor,
            minScore,
          });
          send(res, 200, result);
        } catch (error) {
          send(res, 502, { error: error instanceof Error ? error.message : 'Scan failed' });
        }
      });

      // Market temperature at a historical anchor (a trade's entry/exit time).
      server.middlewares.use('/api/market-heat', async (req, res) => {
        if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
        const url = new URL(req.url ?? '', 'http://local');
        const anchor = Number(url.searchParams.get('anchor'));
        const instrument = url.searchParams.get('instrument') ?? '';
        if (!Number.isFinite(anchor) || anchor <= 0) {
          return send(res, 400, { error: 'anchor is required' });
        }
        if (!instrument) {
          return send(res, 400, { error: 'instrument is required' });
        }
        try {
          const result = await marketHeatService.computeHeat({ anchor, reviewInstrument: instrument });
          send(res, 200, result);
        } catch (error) {
          send(res, 502, { error: error instanceof Error ? error.message : 'Market heat failed' });
        }
      });

      server.middlewares.use('/api/bitget/config', async (req, res) => {
        const url = new URL(req.url ?? '', 'http://local');
        if (req.method === 'GET') {
          return send(res, 200, { configured: loadBitgetKeys() !== null });
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
            saveBitgetKeys({ apiKey, secret, passphrase });
            return send(res, 200, { configured: true });
          } catch (error) {
            return send(res, 500, { error: error instanceof Error ? error.message : 'Failed to save Bitget API key' });
          }
        }
        if (req.method === 'DELETE') {
          clearBitgetKeys();
          return send(res, 200, { configured: false });
        }
        return send(res, 405, { error: 'Method not allowed' });
      });

      server.middlewares.use('/api/bitget/sync', async (req, res) => {
        if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
        const keys = loadBitgetKeys();
        if (!keys) return send(res, 400, { error: '尚未配置 Bitget API key' });
        const parsed = JSON.parse((await readBody(req)) || '{}') as { startTime?: unknown; wipe?: unknown };
        const fromMs = typeof parsed.startTime === 'number' && Number.isFinite(parsed.startTime)
          ? parsed.startTime
          : Date.now() - 90 * 24 * 60 * 60 * 1000;
        if (fromMs < 0) return send(res, 400, { error: 'Invalid startTime' });
        try {
          const client = new BitgetClient(keys);
          const service = new BitgetSyncService(client, bitgetPositionStore);
          const result = await service.sync({ fromMs, wipe: parsed.wipe === true });
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
        const configured = loadBitgetKeys() !== null;
        try {
          const trades = configured
            ? bitgetPositionStore
                .listAll()
                .map((cached, sequence) => historyPositionToTrade(cached.row, sequence))
                .filter((trade): trade is NonNullable<ReturnType<typeof historyPositionToTrade>> => trade !== null)
            : [];
          const queue = buildReviewQueue(trades, reviews, options);
          send(res, 200, {
            trades: queue,
            instruments: [...new Set(trades.map((trade) => trade.instrument))].sort(),
            configured,
            ...tagPayload(reviewStore, reviews),
          });
        } catch (error) {
          send(res, 502, { error: error instanceof Error ? error.message : 'Failed to load Bitget trades' });
        }
      });
    },
  };
}

function trimOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseScanParam(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseOptionalNumber(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function getCandlesForMode(input: {
  candleService: CandlestickService;
  instrument: string;
  timeframe: ReviewTimeframe;
  entryTime: string;
  mode: string;
  anchor: number;
}) {
  if (input.mode === 'earlier') {
    if (!Number.isFinite(input.anchor)) throw new Error('anchor is required');
    return input.candleService.getCandlesticks({ instrument: input.instrument, timeframe: input.timeframe, anchor: input.anchor, direction: 'earlier', limit: 150 });
  }
  if (input.mode === 'later') {
    if (!Number.isFinite(input.anchor)) throw new Error('anchor is required');
    return input.candleService.getCandlesticks({ instrument: input.instrument, timeframe: input.timeframe, anchor: input.anchor, direction: 'later', limit: 150 });
  }

  const entry = Date.parse(input.entryTime);
  const earlier = await input.candleService.getCandlesticks({ instrument: input.instrument, timeframe: input.timeframe, anchor: entry, direction: 'earlier', limit: 150 });
  const later = await input.candleService.getCandlesticks({ instrument: input.instrument, timeframe: input.timeframe, anchor: entry - 1, direction: 'later', limit: 150 });
  return mergeCandles([...earlier, ...later]);
}

function mergeCandles<T extends { timestamp: number }>(candles: T[]): T[] {
  return [...new Map(candles.map((candle) => [candle.timestamp, candle])).values()].sort((a, b) => a.timestamp - b.timestamp);
}

function toQueueOptions(params: URLSearchParams): ReviewQueueOptions {
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

function findSourceWorkbook(): string {
  const xlsx = fs.readdirSync(process.cwd()).find((name) => name.toLowerCase().endsWith('.xlsx'));
  if (!xlsx) throw new Error('No source workbook found in the project folder.');
  return path.resolve(xlsx);
}

/**
 * The global tag list plus its per-tag usage counts. Both tag routes return this
 * after a rewrite so the UI can patch its state instead of refetching /api/trades.
 */
function tagPayload(store: ReviewStore, reviews: readonly TradeReview[]) {
  return {
    tags: [...new Set(reviews.flatMap((review) => review.tags))].sort(),
    tagCounts: store.listTagCounts(reviews),
  };
}

function send(res: { statusCode: number; setHeader(name: string, value: string): void; end(body: string): void }, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function readBody(req: NodeJS.ReadableStream): Promise<string> {
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
