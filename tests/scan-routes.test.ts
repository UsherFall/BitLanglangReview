import { describe, expect, it, vi } from 'vitest';
import type { MarketDataSource } from '../src/domain/scan-scope';
import { registerScanRoutes, type ScanRoutesDependencies } from '../src/server/scan-routes';
import { captureRoutes, invokeRoute } from './route-test-utils';

function dependencies() {
  const scanShrink = vi.fn(async (params: unknown) => ({ scanned: [], params }));
  const computeHeat = vi.fn(async (params: unknown) => ({ tier: 'neutral', params }));
  const coinScanServices = {
    bitget: { scanShrink },
    binance: { scanShrink },
    okx: { scanShrink },
  } as unknown as ScanRoutesDependencies['coinScanServices'];
  const marketHeatServices = {
    bitget: { computeHeat },
    binance: { computeHeat },
    okx: { computeHeat },
  } as unknown as ScanRoutesDependencies['marketHeatServices'];
  return { defaultSource: 'bitget' as MarketDataSource, coinScanServices, marketHeatServices, scanShrink, computeHeat };
}

describe('registerScanRoutes', () => {
  it('keeps config before scan, answers config locally and preserves parsing', async () => {
    const deps = dependencies();
    const { handlers, order } = captureRoutes((server) => registerScanRoutes(server, deps));
    expect(order).toEqual(['/api/scan/config', '/api/scan', '/api/market-heat']);

    const config = await invokeRoute(handlers.get('/api/scan/config')!);
    expect(config.json).toEqual({ source: 'bitget' });
    expect(deps.scanShrink).not.toHaveBeenCalled();

    const response = await invokeRoute(handlers.get('/api/scan')!, {
      url: '/?method=shrink&source=okx&scope=equity&topN=5&minQuoteVolume24h=100&anchor=123',
    });
    expect(response.status).toBe(200);
    expect(deps.scanShrink).toHaveBeenCalledWith({
      method: 'shrink',
      scope: 'equity',
      source: 'okx',
      topN: 5,
      minQuoteVolume24h: 100,
      anchor: 123,
    });

    const beforeInvalid = deps.scanShrink.mock.calls.length;
    const invalid = await invokeRoute(handlers.get('/api/scan')!, { url: '/?method=shrink&scope=invalid' });
    expect(invalid.status).toBe(400);
    expect(deps.scanShrink.mock.calls.length).toBe(beforeInvalid);
  });

  it('validates heat scope and market-heat required fields', async () => {
    const deps = dependencies();
    const { handlers } = captureRoutes((server) => registerScanRoutes(server, deps));
    const heat = await invokeRoute(handlers.get('/api/scan')!, { url: '/?method=heat&scope=equity' });
    expect(heat.status).toBe(400);
    expect(deps.computeHeat).not.toHaveBeenCalled();

    const missingAnchor = await invokeRoute(handlers.get('/api/market-heat')!, { url: '/?instrument=BTCUSDT' });
    expect(missingAnchor.status).toBe(400);
    expect(missingAnchor.json).toEqual({ error: 'anchor is required' });
  });
});
