import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { buildReviewQueue } from '../domain/build-review-queue';
import type { ReviewQueueOptions } from '../domain/review-queue';
import { reviewTimeframes, type ReviewTimeframe } from '../domain/trade';
import { CandlestickService } from './candlestick-service';
import { CandlestickStore } from './candlestick-store';
import { DrawingStore } from './drawing-store';
import { ReviewStore } from './review-store';
import { loadTradesFromWorkbook } from './trade-import';

const workbookPath = findSourceWorkbook();

export function tradingReviewApiPlugin(): Plugin {
  return {
    name: 'trading-review-api',
    configureServer(server) {
      fs.mkdirSync(path.resolve('data'), { recursive: true });
      const trades = loadTradesFromWorkbook(workbookPath);
      const reviewStore = new ReviewStore(path.resolve('data/review.sqlite'));
      const candleStore = new CandlestickStore(path.resolve('data/review.sqlite'));
      const candleService = new CandlestickService(candleStore);
      const drawingStore = new DrawingStore(path.resolve('data/review.sqlite'));

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
        const parsed = JSON.parse(body || '{}') as { tradeId?: string; tags?: string[]; note?: string };
        if (!parsed.tradeId) return send(res, 400, { error: 'tradeId is required' });
        send(res, 200, reviewStore.saveReview({ tradeId: parsed.tradeId, tags: parsed.tags ?? [], note: parsed.note ?? '' }));
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
    },
  };
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
