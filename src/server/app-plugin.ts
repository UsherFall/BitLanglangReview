import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { buildReviewQueue } from '../domain/build-review-queue';
import { DEFAULT_BOX_WINDOW, DEFAULT_MAX_BOX_RATIO, scanTimeframes } from '../domain/coin-scan';
import type { ReviewQueueOptions } from '../domain/review-queue';
import { reviewTimeframes, type ReviewTimeframe } from '../domain/trade';
import { AlertMonitor } from './alert-monitor';
import { AlertStore } from './alert-store';
import { CandlestickService } from './candlestick-service';
import { CoinScanService } from './coin-scan-service';
import { CandlestickStore } from './candlestick-store';
import { DrawingStore } from './drawing-store';
import { freeReplayInstrumentPayload } from './free-replay-instruments';
import { FreeReplaySessionStore, type SaveFreeReplaySessionInput } from './free-replay-session-store';
import { NoopNotifier, ServerChanNotifier } from './notify';
import { OkxInstrumentService } from './okx-instrument-service';
import { ReviewStore } from './review-store';
import { loadTradesFromWorkbook } from './trade-import';

const workbookPath = findSourceWorkbook();

const alertMonitorIntervalMs = 60_000;

export type TradingReviewApiPluginOptions = {
  serverChanKey?: string;
};

export function tradingReviewApiPlugin(options: TradingReviewApiPluginOptions = {}): Plugin {
  return {
    name: 'trading-review-api',
    configureServer(server) {
      fs.mkdirSync(path.resolve('data'), { recursive: true });
      const trades = loadTradesFromWorkbook(workbookPath);
      const reviewStore = new ReviewStore(path.resolve('data/review.sqlite'));
      const candleStore = new CandlestickStore(path.resolve('data/review.sqlite'));
      const candleService = new CandlestickService(candleStore);
      const coinScanService = new CoinScanService(candleService);
      const drawingStore = new DrawingStore(path.resolve('data/review.sqlite'));
      const freeReplaySessionStore = new FreeReplaySessionStore(path.resolve('data/review.sqlite'));
      const instrumentService = new OkxInstrumentService();

      const serverChanKey = options.serverChanKey ?? process.env.SERVERCHAN_KEY ?? '';
      const alertStore = new AlertStore(path.resolve('data/review.sqlite'));
      const notifier = serverChanKey ? new ServerChanNotifier(serverChanKey) : new NoopNotifier();
      const alertMonitor = new AlertMonitor({ store: alertStore, notifier, intervalMs: alertMonitorIntervalMs });
      alertMonitor.start();

      server.middlewares.use('/api/trades', async (req, res) => {
        if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
        const url = new URL(req.url ?? '', 'http://local');
        const options = toQueueOptions(url.searchParams);
        send(res, 200, {
          trades: buildReviewQueue(trades, reviewStore.listReviews(), options),
          instruments: [...new Set(trades.map((trade) => trade.instrument))].sort(),
          tags: [...new Set(reviewStore.listReviews().flatMap((review) => review.tags))].sort(),
        });
      });

      server.middlewares.use('/api/reviews', async (req, res) => {
        if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
        const body = await readBody(req);
        const parsed = JSON.parse(body || '{}') as { tradeId?: string; tags?: string[]; note?: string; starred?: boolean };
        if (!parsed.tradeId) return send(res, 400, { error: 'tradeId is required' });
        send(res, 200, reviewStore.saveReview({ tradeId: parsed.tradeId, tags: parsed.tags ?? [], note: parsed.note ?? '', starred: parsed.starred ?? false }));
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
        const timeframe = url.searchParams.get('timeframe') as ReviewTimeframe | null;
        if (!timeframe || !scanTimeframes.includes(timeframe)) {
          return send(res, 400, { error: 'timeframe must be one of 5m, 15m, 1H, 4H, 1D' });
        }
        const topN = parseScanParam(url.searchParams.get('topN'), 50);
        const consecutive = parseScanParam(url.searchParams.get('consecutive'), 3);
        const window = parseScanParam(url.searchParams.get('window'), 20);
        const ratioThreshold = parseScanParam(url.searchParams.get('ratioThreshold'), 0.7);
        const minQuoteVolume24h = parseScanParam(url.searchParams.get('minQuoteVolume24h'), 10_000_000);
        // boxWindow/maxBoxRatio are optional. parseScanParam's Number(null) === 0
        // defect would turn an absent param into 0 and trip the guard, so parse
        // them with an optional parser that maps null/empty/NaN → undefined.
        const boxWindow = parseOptionalNumber(url.searchParams.get('boxWindow'));
        const maxBoxRatio = parseOptionalNumber(url.searchParams.get('maxBoxRatio'));
        if (topN < 1 || consecutive < 1 || window < 1 || ratioThreshold <= 0 || minQuoteVolume24h < 0) {
          return send(res, 400, { error: 'Invalid scan parameters' });
        }
        if (boxWindow !== undefined && boxWindow <= 0) {
          return send(res, 400, { error: 'Invalid scan parameters' });
        }
        if (maxBoxRatio !== undefined && maxBoxRatio <= 0) {
          return send(res, 400, { error: 'Invalid scan parameters' });
        }
        try {
          const result = await coinScanService.scanShrink({
            method: 'shrink',
            timeframe,
            topN,
            ratioThreshold,
            consecutive,
            window,
            minQuoteVolume24h,
            boxWindow: boxWindow ?? DEFAULT_BOX_WINDOW,
            maxBoxRatio: maxBoxRatio ?? DEFAULT_MAX_BOX_RATIO,
          });
          send(res, 200, result);
        } catch (error) {
          send(res, 502, { error: error instanceof Error ? error.message : 'Scan failed' });
        }
      });

      server.middlewares.use('/api/alerts', async (req, res) => {
        const url = new URL(req.url ?? '', 'http://local');
        if (req.method === 'GET') {
          return send(res, 200, {
            alerts: alertStore.listAlerts(),
            config: { notifierConfigured: serverChanKey.length > 0, monitorIntervalMs: alertMonitorIntervalMs },
          });
        }
        if (req.method === 'POST') {
          // This middleware is mounted at /api/alerts, so connect strips that
          // prefix from req.url and the pathname below is '/reactivate'.
          if (url.pathname === '/reactivate') {
            const id = Number(url.searchParams.get('id'));
            if (!Number.isInteger(id) || id < 1) return send(res, 400, { error: 'id is required' });
            alertStore.reactivate(id);
            return send(res, 200, { ok: true });
          }
          const body = JSON.parse((await readBody(req)) || '{}') as {
            instrument?: string;
            direction?: string;
            targetPrice?: number;
          };
          if (!body.instrument || (body.direction !== 'above' && body.direction !== 'below')) {
            return send(res, 400, { error: 'instrument and a valid direction are required' });
          }
          if (typeof body.targetPrice !== 'number' || !Number.isFinite(body.targetPrice) || body.targetPrice <= 0) {
            return send(res, 400, { error: 'targetPrice must be a positive number' });
          }
          const alert = alertStore.saveAlert({ instrument: body.instrument, direction: body.direction, targetPrice: body.targetPrice });
          return send(res, 200, alert);
        }
        if (req.method === 'DELETE') {
          const id = Number(url.searchParams.get('id'));
          if (!Number.isInteger(id) || id < 1) return send(res, 400, { error: 'id is required' });
          alertStore.deleteAlert(id);
          return send(res, 200, { ok: true });
        }
        return send(res, 405, { error: 'Method not allowed' });
      });
    },
  };
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
