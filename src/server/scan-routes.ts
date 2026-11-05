import type { ViteDevServer } from 'vite';
import {
  defaultScanParams,
  isMarketDataSource,
  isScanScope,
  type MarketDataSource,
  type ScanScope,
} from '../domain/scan-scope';
import type { CoinScanService } from './coin-scan-service';
import type { MarketHeatService } from './market-heat-service';
import { send } from './route-support';

export type ScanRoutesDependencies = {
  defaultSource: MarketDataSource;
  coinScanServices: Record<MarketDataSource, CoinScanService>;
  marketHeatServices: Record<MarketDataSource, MarketHeatService>;
};

function parseOptionalNumber(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function registerScanRoutes(server: ViteDevServer, deps: ScanRoutesDependencies): void {
  const { defaultSource, coinScanServices, marketHeatServices } = deps;
  // Prefix matching requires config BEFORE the broader scan route.
  server.middlewares.use('/api/scan/config', async (req, res) => {
    if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
    send(res, 200, { source: defaultSource });
  });

  server.middlewares.use('/api/scan', async (req, res) => {
    if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
    const url = new URL(req.url ?? '', 'http://local');
    const method = url.searchParams.get('method') ?? '';
    const scopeParam = url.searchParams.get('scope');
    if (scopeParam !== null && scopeParam.trim() !== '' && !isScanScope(scopeParam)) {
      return send(res, 400, { error: 'Invalid scan parameters' });
    }
    const scope: ScanScope = scopeParam === null || scopeParam.trim() === '' ? 'crypto' : (scopeParam as ScanScope);
    const sourceParam = url.searchParams.get('source');
    const source: MarketDataSource = isMarketDataSource(sourceParam) ? sourceParam : defaultSource;
    if (method === 'heat') {
      if (scope !== 'crypto') {
        return send(res, 400, { error: 'Invalid scan parameters' });
      }
      const anchor = parseOptionalNumber(url.searchParams.get('anchor'));
      if (anchor !== undefined && anchor <= 0) {
        return send(res, 400, { error: 'Invalid scan parameters' });
      }
      try {
        send(res, 200, await marketHeatServices[source].computeHeat({ anchor: anchor ?? Date.now() }));
      } catch (error) {
        send(res, 502, { error: error instanceof Error ? error.message : 'Scan failed' });
      }
      return;
    }
    if (method === 'watch') {
      const anchor = parseOptionalNumber(url.searchParams.get('anchor'));
      if (anchor !== undefined && anchor <= 0) {
        return send(res, 400, { error: 'Invalid scan parameters' });
      }
      try {
        send(res, 200, await coinScanServices[source].scanWatch({ method: 'watch', source, anchor }));
      } catch (error) {
        send(res, 502, { error: error instanceof Error ? error.message : 'Scan failed' });
      }
      return;
    }
    if (method !== 'shrink' && method !== 'box') {
      return send(res, 400, { error: 'Unsupported scan method' });
    }
    const scopeDefaults = defaultScanParams(source, scope);
    const topN = parseOptionalNumber(url.searchParams.get('topN'));
    const minQuoteVolume24h = parseOptionalNumber(url.searchParams.get('minQuoteVolume24h')) ?? scopeDefaults.minQuoteVolume24h;
    const anchor = parseOptionalNumber(url.searchParams.get('anchor'));
    if ((topN !== undefined && topN < 1) || minQuoteVolume24h < 0) {
      return send(res, 400, { error: 'Invalid scan parameters' });
    }
    if (anchor !== undefined && anchor <= 0) {
      return send(res, 400, { error: 'Invalid scan parameters' });
    }
    if (method === 'box') {
      const minRun = parseOptionalNumber(url.searchParams.get('minRun'));
      const maxRun = parseOptionalNumber(url.searchParams.get('maxRun'));
      const maxHeightRatio = parseOptionalNumber(url.searchParams.get('maxHeightRatio'));
      if (
        (minRun !== undefined && minRun < 3) ||
        (maxRun !== undefined && maxRun < 3) ||
        (maxRun !== undefined && minRun !== undefined && maxRun < minRun) ||
        (maxHeightRatio !== undefined && (maxHeightRatio <= 0 || maxHeightRatio > 2))
      ) {
        return send(res, 400, { error: 'Invalid scan parameters' });
      }
      try {
        send(
          res,
          200,
          await coinScanServices[source].scanBoxBrace({
            scope,
            source,
            minQuoteVolume24h,
            anchor,
            minRun,
            maxRun,
            maxHeightRatio,
          }),
        );
      } catch (error) {
        send(res, 502, { error: error instanceof Error ? error.message : 'Scan failed' });
      }
      return;
    }
    try {
      const result = await coinScanServices[source].scanShrink({
        method: 'shrink',
        scope,
        source,
        topN,
        minQuoteVolume24h,
        anchor,
      });
      send(res, 200, result);
    } catch (error) {
      send(res, 502, { error: error instanceof Error ? error.message : 'Scan failed' });
    }
  });

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
      const result = await marketHeatServices[defaultSource].computeHeat({ anchor, reviewInstrument: instrument });
      send(res, 200, result);
    } catch (error) {
      send(res, 502, { error: error instanceof Error ? error.message : 'Market heat failed' });
    }
  });
}
