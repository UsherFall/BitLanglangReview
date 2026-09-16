import { defaultBinanceFetchJson, type FetchJson } from './http';
import { BinanceInstrumentMetadataSource } from './binance-instrument-metadata';
import type { MarketClass } from '../domain/market-class';
import type { Ticker, TickerSource } from './market-data';

/**
 * Exact USDT-M perpetual symbols to exclude from the scan pool. These are
 * stablecoin / synthetic pairs whose "price discovery" is not meaningful for a
 * volume-shrink scan. Extend this list as new stablecoin pairs appear.
 */
export const STABLECOIN_QUOTE_PAIRS = new Set<string>([
  'USDCUSDT',
  'FDUSDUSDT',
  'DAIUSDT',
  'TUSDUSDT',
  'USDDUSDT',
  'USDPUSDT',
  'USD1USDT',
  'USD0USDT',
]);

type BinanceTicker24hr = {
  symbol?: string;
  lastPrice?: string;
  openPrice?: string;
  priceChangePercent?: string;
  quoteVolume?: string;
};

/**
 * Binance USDT-M perpetual tickers from `fapi/v1/ticker/24hr`. A single request
 * returns the whole market (no pagination), so the source maps every USDT-quoted
 * symbol, excludes stablecoin pairs, ranks by 24h quote volume descending, and
 * yields normalized `Ticker` values.
 *
 * Binance `quoteVolume` is already USDT-denominated (unlike OKX, where the scan
 * multiplies `volCcy24h * last`), and `priceChangePercent` is already a percent,
 * so no conversion is needed here.
 *
 * Every classified symbol carries its `marketClass` (crypto/commodity included):
 * consumers decide from it whether the instrument is in the scan pool
 * (`scan-pool.ts`) and when its market is open (`market-session.ts`). An ABSENT
 * class therefore means "the metadata could not be read", which is why the
 * source also exposes `metadataAvailable()` — the scan surfaces that as a
 * warning instead of silently losing session gating.
 *
 * The full-market call costs 40 request weight on Binance, so the result is
 * cached briefly. Consumers share one source instance, and 24h volume/price
 * change move slowly enough that a 30s TTL never skews a scan — it just stops
 * repeated scans from burning 40 weight each time.
 */
const TICKER_TTL_MS = 30_000;

export class BinanceTickerSource implements TickerSource {
  private cache: { at: number; tickers: Ticker[] } | null = null;
  private inflight: Promise<Ticker[]> | null = null;
  /** Whether the last fetch could attach instrument classes. */
  private metadataOk = true;

  constructor(
    private readonly fetchJson: FetchJson = defaultBinanceFetchJson,
    /** Optional instrument-class metadata; absent = tickers carry no market class. */
    private readonly metadataSource: BinanceInstrumentMetadataSource | null = null,
  ) {}

  async listTickers(): Promise<Ticker[]> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < TICKER_TTL_MS) return this.cache.tickers;
    // Reuse an in-flight fetch so concurrent callers only ever produce one request.
    if (this.inflight) return this.inflight;
    this.inflight = this.fetchAndMap()
      .then((tickers) => {
        this.cache = { at: Date.now(), tickers };
        return tickers;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  /** False when the last listTickers() ran without instrument-class metadata. */
  metadataAvailable(): boolean {
    return this.metadataOk;
  }

  private async fetchAndMap(): Promise<Ticker[]> {
    const [rawResponse, metadata] = await Promise.all([
      this.fetchJson('https://fapi.binance.com/fapi/v1/ticker/24hr'),
      this.metadataSource ? this.metadataSource.load() : Promise.resolve(new Map<string, MarketClass>()),
    ]);
    // No metadata source wired, or the fetch degraded to an empty map: consumers
    // lose session gating, so say so rather than pretending everything is crypto.
    this.metadataOk = this.metadataSource !== null && metadata.size > 0;
    const response = rawResponse as BinanceTicker24hr[];
    if (!Array.isArray(response)) return [];
    return response
      .filter((item) => isUsdtPerpetual(item.symbol))
      .map((item) => {
        const ticker: Ticker = {
          instrument: item.symbol as string,
          quoteVolume24h: Number(item.quoteVolume),
          lastPrice: Number(item.lastPrice),
          change24h: Number(item.priceChangePercent),
        };
        const marketClass = metadata.get(item.symbol as string);
        if (marketClass) ticker.marketClass = marketClass;
        return ticker;
      })
      .filter((ticker) => Number.isFinite(ticker.quoteVolume24h) && Number.isFinite(ticker.lastPrice) && Number.isFinite(ticker.change24h))
      .sort((a, b) => b.quoteVolume24h - a.quoteVolume24h);
  }
}

function isUsdtPerpetual(symbol: string | undefined): boolean {
  return typeof symbol === 'string' && symbol.endsWith('USDT') && !STABLECOIN_QUOTE_PAIRS.has(symbol);
}
