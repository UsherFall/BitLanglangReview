import { afterEach, describe, expect, it } from 'vitest';
import { registerCandleRoutes, registerDrawingRoutes, type ChartRoutesDependencies } from '../src/server/chart-routes';
import { DrawingStore } from '../src/server/drawing-store';
import { captureRoutes, invokeRoute } from './route-test-utils';

let drawingStore: DrawingStore | undefined;
afterEach(() => {
  drawingStore?.close();
  drawingStore = undefined;
});

function dependencies(): ChartRoutesDependencies {
  drawingStore = new DrawingStore(':memory:');
  return {
    candleService: {} as ChartRoutesDependencies['candleService'],
    binanceCandleSource: {} as ChartRoutesDependencies['binanceCandleSource'],
    bitgetCandleSource: {} as ChartRoutesDependencies['bitgetCandleSource'],
    binanceMetadata: () => { throw new Error('metadata must not be read by validation tests'); },
    drawingStore,
  };
}

describe('chart routes', () => {
  it('rejects an incomplete candle request before touching a market Adapter', async () => {
    const { handlers, order } = captureRoutes((server) => registerCandleRoutes(server, dependencies()));
    expect(order).toEqual(['/api/candles']);
    const response = await invokeRoute(handlers.get('/api/candles')!, { url: '/?instrument=BTCUSDT&timeframe=5m' });
    expect(response.status).toBe(400);
    expect(response.json).toEqual({ error: 'instrument, timeframe, and entryTime are required' });
  });

  it('keeps Drawing boards isolated through the real route and in-memory Store', async () => {
    const { handlers, order } = captureRoutes((server) => registerDrawingRoutes(server, dependencies()));
    expect(order).toEqual(['/api/drawings']);
    const body = {
      tradeId: null,
      instrument: 'BTCUSDT',
      board: 'review',
      timeframe: '5m',
      kind: 'horizontal',
      points: [{ time: 1653381000, price: 29300 }],
    };
    const saved = await invokeRoute(handlers.get('/api/drawings')!, { method: 'POST', body });
    expect(saved.status).toBe(200);
    expect(saved.json.board).toBe('review');

    const review = await invokeRoute(handlers.get('/api/drawings')!, { url: '/?instrument=BTCUSDT&board=review' });
    expect(review.json.drawings).toHaveLength(1);
    const scan = await invokeRoute(handlers.get('/api/drawings')!, { url: '/?instrument=BTCUSDT&board=scan' });
    expect(scan.json.drawings).toEqual([]);
    const invalid = await invokeRoute(handlers.get('/api/drawings')!, { url: '/?instrument=BTCUSDT' });
    expect(invalid.status).toBe(400);
  });
});
