import type { ViteDevServer } from 'vite';
import { isDrawingBoard } from '../domain/drawing';
import { reviewTimeframes, type ReviewTimeframe } from '../domain/trade';
import type { BinanceCandleSource } from './binance-candles';
import type { BitgetCandleSource } from './bitget-candles';
import type { binanceInstrumentMetadata } from './binance-instrument-metadata';
import type { CandlestickService } from './candlestick-service';
import type { DrawingStore } from './drawing-store';
import { fetchBinanceOnlyCandles, fetchReviewCandles, getBitgetCandles, getCandlesForMode } from './review-candle-source';
import { readBody, send } from './route-support';

export type ChartRoutesDependencies = {
  candleService: CandlestickService;
  binanceCandleSource: BinanceCandleSource;
  bitgetCandleSource: BitgetCandleSource;
  binanceMetadata: typeof binanceInstrumentMetadata;
  drawingStore: DrawingStore;
};

export function registerCandleRoutes(server: ViteDevServer, deps: ChartRoutesDependencies): void {
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
    const source = url.searchParams.get('source');
    try {
      // source=binance: candidate chain with OKX fallback. binance-only: strict
      // Binance for Free Replay. bitget: that venue's own candles. Default: OKX.
      const candles = source === 'binance'
        ? await fetchReviewCandles({
            binance: deps.binanceCandleSource,
            okx: deps.candleService,
            instrument,
            timeframe,
            entryTime,
            mode,
            anchor,
            binanceStatuses: () => deps.binanceMetadata().symbolStatuses(),
          })
        : source === 'binance-only'
          ? await fetchBinanceOnlyCandles({ binance: deps.binanceCandleSource, instrument, timeframe, entryTime, mode, anchor })
          : source === 'bitget'
            ? await getBitgetCandles({
                candleSource: deps.bitgetCandleSource,
                instrument,
                timeframe,
                entryTime,
                mode,
                anchor,
              })
            : await getCandlesForMode({ candleSource: deps.candleService, instrument, timeframe, entryTime, mode, anchor });
      send(res, 200, { candles });
    } catch (error) {
      send(res, 502, { error: error instanceof Error ? error.message : 'Failed to load candlesticks' });
    }
  });
}

export function registerDrawingRoutes(server: ViteDevServer, deps: ChartRoutesDependencies): void {
  const { drawingStore } = deps;
  server.middlewares.use('/api/drawings', async (req, res) => {
    const url = new URL(req.url ?? '', 'http://local');
    if (req.method === 'GET') {
      const instrument = url.searchParams.get('instrument') ?? '';
      if (!instrument) {
        return send(res, 400, { error: 'instrument is required' });
      }
      const board = url.searchParams.get('board');
      if (!isDrawingBoard(board)) {
        return send(res, 400, { error: 'board must be one of: scan, review' });
      }
      // Optional timeframe is a targeted query, not a visibility rule.
      const timeframe = url.searchParams.get('timeframe');
      const drawings = timeframe
        ? drawingStore.listDrawings({ instrument, board, timeframe })
        : drawingStore.listDrawings({ instrument, board });
      return send(res, 200, { drawings });
    }
    if (req.method === 'POST') {
      const parsed = JSON.parse(await readBody(req) || '{}');
      if (!isDrawingBoard(parsed?.board)) {
        return send(res, 400, { error: 'board must be one of: scan, review' });
      }
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
}
