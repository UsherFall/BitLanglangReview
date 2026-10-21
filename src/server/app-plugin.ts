import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { buildReviewQueue } from '../domain/build-review-queue';
import { scopeReviewsToTrades, type TradeReview } from '../domain/review';
import type { ReviewQueueOptions } from '../domain/review-queue';
import { reviewTimeframes, type ReviewTimeframe } from '../domain/trade';
import {
  DEFAULT_MARKET_DATA_SOURCE,
  defaultScanParams,
  isMarketDataSource,
  isScanScope,
  type MarketDataSource,
  type ScanScope,
} from '../domain/scan-scope';
import { BinanceCandleSource } from './binance-candles';
import { BitgetCandleSource } from './bitget-candles';
import { bitgetInstrumentMetadata } from './bitget-instrument-metadata';
import { BitgetTickerSource } from './bitget-tickers';
import { resolveDataPath } from './data-root';
import { binanceInstrumentMetadata } from './binance-instrument-metadata';
import { BinanceTickerSource } from './binance-tickers';
import { BitgetClient } from './bitget-client';
import { ordersForRound } from '../domain/bitget-round-orders';
import { attachRoundOrders, historyPositionToTrade, toClosedRound } from './bitget-import';
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
import { fetchBinanceOnlyCandles, fetchReviewCandles, getBitgetCandles, getCandlesForMode } from './review-candle-source';
import { loadTradesFromWorkbook } from './trade-import';
import { binanceRateGate, bitgetMarketRateGate, type RateGate } from './http';
import type { CandleSource, TickerSource } from './market-data';
import type { CandleSourceId } from '../domain/candlestick';

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
      // Review-chart candlesticks: FreeReplay and the workbook TradeReview keep
      // the OKX source by default; the personal review mode (Bitget-sourced
      // trades) requests source=binance — Bitget's own public candles only keep
      // a rolling window (5m ≈ 30 days up to 4H ≈ a few months), so old trades
      // would have empty intraday charts. The source parameter decides which
      // CandleSource a request hits.
      const candleService = new CandlestickService(candleStore);
      // The coin scan runs against the switchable market-data source: the plugin
      // option, then process.env (vite.config injects MARKET_DATA_SOURCE from
      // `.env` when the shell has none), then Bitget. That value is the DEFAULT
      // SELECTION only — `/api/scan` re-resolves the source per request, so the
      // panel can switch venues without a restart. The equity scope works on
      // every source now — Bitget classifies via the contracts endpoint's isRwa
      // flag (two buckets: CRYPTO vs US_EQUITY) — so `.env` is purely a
      // preference. An ILLEGAL value degrades to the Bitget default rather than
      // to the old Binance one, keeping "no source" and "bad source" identical.
      const requestedSource = options.marketDataSource ?? process.env.MARKET_DATA_SOURCE;
      const defaultSource: MarketDataSource = isMarketDataSource(requestedSource) ? requestedSource : DEFAULT_MARKET_DATA_SOURCE;
      // Market heat (市场热度) follows the SAME source as the scan (10/12): the
      // whole 选品 module moves together, and in Binance mode the instances are
      // still shared with the scan so the 30s ticker TTL / 6h metadata cache
      // stay shared. Bitget candles keep their `bitget:` store-key namespace,
      // so heat and scan rows never mix across sources.
      const binanceTickerSource = new BinanceTickerSource(undefined, binanceInstrumentMetadata());
      const binanceCandleSource = new BinanceCandleSource(candleStore);
      // Bitget market sources (public, no API key): USDT-FUTURES tickers +
      // candles for the coin scan. Candle store keys are namespaced with
      // `bitget:` inside BitgetCandleSource, so they never collide with the
      // Binance rows sharing the same base+USDT vocabulary.
      const bitgetTickerSource = new BitgetTickerSource(undefined, bitgetInstrumentMetadata());
      const bitgetCandleSource = new BitgetCandleSource(candleStore);
      const okxTickerSource = new OkxTickerSource();
      // One trio per source. The scan surfaces rate-limit warnings from its
      // gate, so the gate must belong to the venue actually being hit (OKX has
      // no gate of its own — it shares the Binance one, matching the pre-10/12
      // behaviour of that path; OKX candles are additionally unpaced).
      const marketSources: Record<MarketDataSource, { tickerSource: TickerSource; candleSource: CandleSource; gate: RateGate }> = {
        binance: { tickerSource: binanceTickerSource, candleSource: binanceCandleSource, gate: binanceRateGate },
        okx: { tickerSource: okxTickerSource, candleSource: candleService, gate: binanceRateGate },
        bitget: { tickerSource: bitgetTickerSource, candleSource: bitgetCandleSource, gate: bitgetMarketRateGate },
      };
      // Both services are stateless across requests, so one instance per source
      // is enough — and `MarketHeatService`'s anchor cache is per source by
      // construction, which is the isolation the scan's source switching needs.
      // The drawing store comes first: both the shrink scan and the 标线监控
      // view measure 距线 (the distance to the user's drawn levels), so they need
      // the store at construction time.
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
      // OKX instruments back the Other Coin Panel when it reads OKX candles
      // (交割单复盘); Free Replay lists Binance symbols instead.
      const okxInstrumentService = new OkxInstrumentService();

      // Module-scoped reviews for tag payloads: 'trade' = xlsx universe,
      // 'bitget' = mapped bg- universe, absent = every review (legacy global).
      const scopedReviewsForModule = (module?: string): TradeReview[] => {
        const allReviews = reviewStore.listReviews();
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

      server.middlewares.use('/api/trades', async (req, res) => {
        if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
        const url = new URL(req.url ?? '', 'http://local');
        const options = toQueueOptions(url.searchParams);
        const reviews = reviewStore.listReviews();
        const scopedReviews = scopeReviewsToTrades(reviews, trades.map((trade) => trade.id));
        send(res, 200, {
          trades: buildReviewQueue(trades, reviews, options),
          instruments: [...new Set(trades.map((trade) => trade.instrument))].sort(),
          ...tagPayload(reviewStore, scopedReviews),
        });
      });

      // Saving answers with the saved review PLUS the module-scoped tag list and
      // per-tag counts, so the UI patches `tagCounts` in place after an add or
      // remove instead of leaving a stale "N 笔". Same scope helper the tag
      // rename/delete routes use.
      server.middlewares.use('/api/reviews', async (req, res) => {
        if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
        const body = await readBody(req);
        const parsed = JSON.parse(body || '{}') as { tradeId?: string; tags?: string[]; note?: string; starred?: boolean; module?: string };
        if (!parsed.tradeId) return send(res, 400, { error: 'tradeId is required' });
        const review = reviewStore.saveReview({ tradeId: parsed.tradeId, tags: parsed.tags ?? [], note: parsed.note ?? '', starred: parsed.starred ?? false });
        send(res, 200, { review, ...tagPayload(reviewStore, scopedReviewsForModule(parsed.module)) });
      });

      // Tag names are shared across every review, so renaming / deleting is a
      // global operation: it rewrites all reviews carrying the tag. Both routes
      // answer with the recomputed global tag list + counts so the UI can patch
      // its state instead of refetching /api/trades.
      server.middlewares.use('/api/tags/rename', async (req, res) => {
        if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
        const parsed = JSON.parse((await readBody(req)) || '{}') as { from?: string; to?: string; module?: string };
        const from = parsed.from?.trim() ?? '';
        const to = parsed.to?.trim() ?? '';
        if (!from || !to) return send(res, 400, { error: 'from and to are required' });
        const affected = reviewStore.renameTag(from, to);
        send(res, 200, { affected, ...tagPayload(reviewStore, scopedReviewsForModule(parsed.module)) });
      });

      server.middlewares.use('/api/tags/delete', async (req, res) => {
        if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
        const parsed = JSON.parse((await readBody(req)) || '{}') as { tag?: string; module?: string };
        const tag = parsed.tag?.trim() ?? '';
        if (!tag) return send(res, 400, { error: 'tag is required' });
        const affected = reviewStore.deleteTag(tag);
        send(res, 200, { affected, ...tagPayload(reviewStore, scopedReviewsForModule(parsed.module)) });
      });

      server.middlewares.use('/api/free-replay/instruments', async (req, res) => {
        if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
        const url = new URL(req.url ?? '', 'http://local');
        try {
          // The Other Coin Panel reads from the same venue as the chart it sits
          // beside, so the list has to be named in that venue's vocabulary.
          const raw = url.searchParams.get('source');
          const source: CandleSourceId = raw === 'okx' || raw === 'bitget' ? raw : 'binance';
          const service = source === 'okx'
            ? { listTradableUsdtSymbols: () => Promise.resolve([]), listSwapInstruments: () => okxInstrumentService.listSwapInstruments() }
            : binanceInstrumentMetadata();
          // 10/21: the Bitget list is the ticker snapshot the coin scan already
          // caches (30s TTL) - listing it costs no extra request.
          const bitgetSymbols = source === 'bitget'
            ? async () => (await bitgetTickerSource.listTickers()).map((ticker) => ticker.instrument)
            : undefined;
          send(res, 200, await freeReplayInstrumentPayload(service, source, bitgetSymbols));
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
        // Select the exchange whose candles to serve. Defaults to OKX so the
        // workbook review and its other-coin panel are unchanged.
        //
        // `source=binance` is the personal review mode: a Bitget symbol does not
        // always have a tradable Binance counterpart, so that chart runs through
        // the candidate chain (see `review-candle-source.ts`) with OKX as the
        // fallback. `source=binance-only` is Free Replay, which is bound to
        // Binance and lists Binance symbols, so it needs neither a symbol
        // translation nor a fallback — and must not silently get one, since a
        // rate limit has to be visible rather than papered over with another
        // venue's prices.
        const source = url.searchParams.get('source');
        try {
          const candles = source === 'binance'
            ? await fetchReviewCandles({
                binance: binanceCandleSource,
                okx: candleService,
                instrument,
                timeframe,
                entryTime,
                mode,
                anchor,
                binanceStatuses: () => binanceInstrumentMetadata().symbolStatuses(),
              })
            : source === 'binance-only'
              ? await fetchBinanceOnlyCandles({ binance: binanceCandleSource, instrument, timeframe, entryTime, mode, anchor })
              : source === 'bitget'
                ? await getBitgetCandles({
                    candleSource: bitgetCandleSource,
                    instrument,
                    timeframe,
                    entryTime,
                    mode,
                    anchor,
                  })
                : await getCandlesForMode({ candleSource: candleService, instrument, timeframe, entryTime, mode, anchor });
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
          // The timeframe filter is optional: a chart wants the levels of ITS
          // own timeframe (each level is measured with its own volatility
          // scale), while the 选品 scan asks for every timeframe at once.
          const timeframe = url.searchParams.get('timeframe');
          const drawings = timeframe
            ? drawingStore.listDrawings({ instrument, timeframe })
            : drawingStore.listDrawings({ instrument });
          return send(res, 200, { drawings });
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

      // Bootstrap for the panel's 行情源 selector: the server's startup source.
      // MUST stay registered BEFORE `/api/scan` — connect matches middlewares by
      // path PREFIX, so `/api/scan` would otherwise swallow `/api/scan/config`.
      server.middlewares.use('/api/scan/config', async (req, res) => {
        if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
        // Answers from config only — never touches the network.
        send(res, 200, { source: defaultSource });
      });

      server.middlewares.use('/api/scan', async (req, res) => {
        if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
        const url = new URL(req.url ?? '', 'http://local');
        const method = url.searchParams.get('method') ?? '';
        // 选品 sub-module: `crypto` (default — keeps every pre-09/16 caller
        // unchanged) or `equity`. An unknown value is a caller error rather than a
        // silent fallback, because the two scopes rank different universes.
        const scopeParam = url.searchParams.get('scope');
        if (scopeParam !== null && scopeParam.trim() !== '' && !isScanScope(scopeParam)) {
          return send(res, 400, { error: 'Invalid scan parameters' });
        }
        const scope: ScanScope = scopeParam === null || scopeParam.trim() === '' ? 'crypto' : (scopeParam as ScanScope);
        // 行情源 (10/12): resolved PER REQUEST so the panel can switch venues.
        // Absent or illegal → the server's startup source, so every pre-10/12
        // caller keeps hitting exactly the source it used to.
        const sourceParam = url.searchParams.get('source');
        const source: MarketDataSource = isMarketDataSource(sourceParam) ? sourceParam : defaultSource;
        if (method === 'heat') {
          // 热度 reads the crypto 场子 (crypto + indices + commodities); the equity
          // sub-module deliberately has no heat reading.
          if (scope !== 'crypto') {
            return send(res, 400, { error: 'Invalid scan parameters' });
          }
          // 选品「热度」: 复用复盘的市场热度能力(固定 Top80 + 池子策略), 展示整体场子读数。
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
          // 标线监控 (10/21): the row set is the user's own drawn lines, so
          // scope / topN / the volume floor do not apply — only the source and
          // an optional anchor do. The scope param is still legality-checked
          // above, but it is not part of the watch contract.
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
        // The volume floor is per `source × scope` (`SCAN_PARAM_DEFAULTS`); an
        // absent or unparsable value falls back to that pair's default (never to
        // 0, which would 400).
        const scopeDefaults = defaultScanParams(source, scope);
        // `topN` is an optional CAP since 10/13 (the pool is the whole open
        // universe, because the approved labels sit as deep as rank #319):
        // absent/empty = no cap. A present value must still be >= 1 — `0` would
        // silently scan nothing instead of failing loudly.
        const topN = parseOptionalNumber(url.searchParams.get('topN'));
        const minQuoteVolume24h = parseOptionalNumber(url.searchParams.get('minQuoteVolume24h')) ?? scopeDefaults.minQuoteVolume24h;
        // anchor is optional: parse it with the optional parser that
        // maps null/empty/NaN → undefined, so an absent param never becomes 0 and
        // trips the guard below.
        const anchor = parseOptionalNumber(url.searchParams.get('anchor'));
        if ((topN !== undefined && topN < 1) || minQuoteVolume24h < 0) {
          return send(res, 400, { error: 'Invalid scan parameters' });
        }
        if (anchor !== undefined && anchor <= 0) {
          return send(res, 400, { error: 'Invalid scan parameters' });
        }
        if (method === 'box') {
          // 箱体蓄力: box shape knobs are optional and defaulted in the domain;
          // a present value must still be sane, so a typo cannot scan nothing.
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
          const result = await marketHeatServices[defaultSource].computeHeat({ anchor, reviewInstrument: instrument });
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
          // Read every cached order once, grouped by symbol, instead of one
          // query per round.
          const ordersBySymbol = bitgetPositionStore.listOrdersBySymbol();
          const trades = configured
            ? bitgetPositionStore
                .listAll()
                .map((cached, sequence) => ({ cached, trade: historyPositionToTrade(cached.row, sequence) }))
                .map(({ cached, trade }) => {
                  if (!trade) return null;
                  // Attach the individual orders when they can be proven to
                  // belong to this round; otherwise the chart shows entry/exit.
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
    },
  };
}

function trimOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Builds one value per market-data source. The object literal is what keeps the
 * keys exhaustive: adding a fourth source to `MarketDataSource` fails the return
 * type here instead of silently leaving a route without a service.
 */
function buildPerSource<T>(build: (source: MarketDataSource) => T): Record<MarketDataSource, T> {
  return {
    binance: build('binance'),
    okx: build('okx'),
    bitget: build('bitget'),
  };
}

function parseOptionalNumber(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
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
