import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { scopeReviewsToPaperRounds } from '../domain/paper-round';
import { scopeReviewsToTrades, type TradeReview } from '../domain/review';
import {
  DEFAULT_MARKET_DATA_SOURCE,
  isMarketDataSource,
  type MarketDataSource,
} from '../domain/scan-scope';
import { BinanceCandleSource } from './binance-candles';
import { BitgetCandleSource, purgeBitgetCandleCacheOnce } from './bitget-candles';
import { bitgetInstrumentMetadata } from './bitget-instrument-metadata';
import { BitgetTickerSource } from './bitget-tickers';
import { resolveDataPath } from './data-root';
import { binanceInstrumentMetadata } from './binance-instrument-metadata';
import { BinanceTickerSource } from './binance-tickers';
import { BitgetClient } from './bitget-client';
import { historyPositionToTrade } from './bitget-import';
import { clearBitgetKeys, loadBitgetKeys, saveBitgetKeys } from './bitget-keys';
import { BitgetPositionStore } from './bitget-position-store';
import { registerBitgetRoutes, type BitgetRoutesDependencies } from './bitget-routes';
import { BitgetSyncService } from './bitget-sync';
import { CandlestickService } from './candlestick-service';
import { registerCandleRoutes, registerDrawingRoutes, type ChartRoutesDependencies } from './chart-routes';
import { CoinScanService } from './coin-scan-service';
import { CandlestickStore } from './candlestick-store';
import { DrawingStore } from './drawing-store';
import { FreeReplaySessionStore } from './free-replay-session-store';
import { registerFreeReplayInstrumentRoutes, registerFreeReplaySessionRoutes } from './free-replay-routes';
import { MarketHeatService } from './market-heat-service';
import { OkxInstrumentService } from './okx-instrument-service';
import { OkxTickerSource } from './okx-tickers';
import { ReviewStore } from './review-store';
import { registerReviewRoutes } from './review-routes';
import { registerScanRoutes } from './scan-routes';
import { loadTradesFromWorkbook } from './trade-import';
import { binanceRateGate, bitgetMarketRateGate, type RateGate } from './http';
import type { CandleSource, TickerSource } from './market-data';

const workbookPath = findSourceWorkbook();

export type TradingReviewApiPluginOptions = {
  /** Coin-scan ticker + candle data source. Defaults to `MARKET_DATA_SOURCE`, then Bitget. */
  marketDataSource?: MarketDataSource;
};

export function tradingReviewApiPlugin(options: TradingReviewApiPluginOptions = {}): Plugin {
  return {
    name: 'trading-review-api',
    configureServer(server) {
      fs.mkdirSync(resolveDataPath(), { recursive: true });
      const trades = loadTradesFromWorkbook(workbookPath);
      const reviewStore = new ReviewStore(resolveDataPath('review.sqlite'));
      const candleStore = new CandlestickStore(resolveDataPath('review.sqlite'));
      // One-time cache purge: the marker makes this a per-database operation.
      purgeBitgetCandleCacheOnce(candleStore);
      const candleService = new CandlestickService(candleStore);
      // Startup default only; scan resolves its source again per request.
      const requestedSource = options.marketDataSource ?? process.env.MARKET_DATA_SOURCE;
      const defaultSource: MarketDataSource = isMarketDataSource(requestedSource) ? requestedSource : DEFAULT_MARKET_DATA_SOURCE;

      const binanceTickerSource = new BinanceTickerSource(undefined, binanceInstrumentMetadata());
      const binanceCandleSource = new BinanceCandleSource(candleStore);
      const bitgetTickerSource = new BitgetTickerSource(undefined, bitgetInstrumentMetadata());
      const bitgetCandleSource = new BitgetCandleSource(candleStore);
      const okxTickerSource = new OkxTickerSource();
      // One ticker/candle/gate trio per source. OKX shares Binance's gate.
      const marketSources: Record<MarketDataSource, { tickerSource: TickerSource; candleSource: CandleSource; gate: RateGate }> = {
        binance: { tickerSource: binanceTickerSource, candleSource: binanceCandleSource, gate: binanceRateGate },
        okx: { tickerSource: okxTickerSource, candleSource: candleService, gate: binanceRateGate },
        bitget: { tickerSource: bitgetTickerSource, candleSource: bitgetCandleSource, gate: bitgetMarketRateGate },
      };
      const drawingStore = new DrawingStore(resolveDataPath('review.sqlite'));
      const coinScanServices = buildPerSource((source) => {
        const { tickerSource, candleSource, gate } = marketSources[source];
        return new CoinScanService(tickerSource, candleSource, gate, drawingStore);
      });
      const marketHeatServices = buildPerSource((source) => {
        const { tickerSource, candleSource } = marketSources[source];
        return new MarketHeatService(tickerSource, candleSource);
      });
      const freeReplaySessionStore = new FreeReplaySessionStore(resolveDataPath('review.sqlite'));
      const bitgetPositionStore = new BitgetPositionStore(resolveDataPath('review.sqlite'));
      const okxInstrumentService = new OkxInstrumentService();

      // Tag NAMES stay global while counts remain module-scoped.
      const scopedReviewsForModule = (module?: string): TradeReview[] => {
        const allReviews = reviewStore.listReviews();
        if (module === 'paper') return scopeReviewsToPaperRounds(allReviews);
        if (module === 'trade') return scopeReviewsToTrades(allReviews, trades.map((trade) => trade.id));
        if (module === 'bitget') {
          const ids = bitgetPositionStore
            .listAll()
            .map((cached, sequence) => historyPositionToTrade(cached.row, sequence))
            .filter((trade): trade is NonNullable<ReturnType<typeof historyPositionToTrade>> => trade !== null)
            .map((trade) => trade.id);
          return scopeReviewsToTrades(allReviews, ids);
        }
        return allReviews;
      };

      // Registration order is an HTTP contract (Connect prefix matching), not
      // incidental file layout. Keep it in sync with the workflow Modules.
      registerReviewRoutes(server, { trades, reviewStore, scopedReviewsForModule });
      registerFreeReplayInstrumentRoutes(server, {
        createBinanceInstruments: binanceInstrumentMetadata,
        okxInstruments: okxInstrumentService,
        bitgetSymbols: async () => (await bitgetTickerSource.listTickers()).map((ticker) => ticker.instrument),
      });

      const chartDependencies: ChartRoutesDependencies = {
        candleService,
        binanceCandleSource,
        bitgetCandleSource,
        binanceMetadata: binanceInstrumentMetadata,
        drawingStore,
      };
      registerCandleRoutes(server, chartDependencies);
      registerDrawingRoutes(server, chartDependencies);

      registerFreeReplaySessionRoutes(server, { freeReplaySessionStore, reviewStore, scopedReviewsForModule });
      registerScanRoutes(server, { defaultSource, coinScanServices, marketHeatServices });

      const bitgetDependencies: BitgetRoutesDependencies = {
        reviewStore,
        bitgetPositionStore,
        scopedReviewsForModule,
        keys: { load: loadBitgetKeys, save: saveBitgetKeys, clear: clearBitgetKeys },
        createSyncService: (keys) => new BitgetSyncService(new BitgetClient(keys), bitgetPositionStore),
      };
      registerBitgetRoutes(server, bitgetDependencies);
    },
  };
}

/** Builds one value per market-data source with exhaustive keys. */
function buildPerSource<T>(build: (source: MarketDataSource) => T): Record<MarketDataSource, T> {
  return {
    binance: build('binance'),
    okx: build('okx'),
    bitget: build('bitget'),
  };
}

function findSourceWorkbook(): string {
  const xlsx = fs.readdirSync(process.cwd()).find((name) => name.toLowerCase().endsWith('.xlsx'));
  if (!xlsx) throw new Error('No source workbook found in the project folder.');
  return path.resolve(xlsx);
}
