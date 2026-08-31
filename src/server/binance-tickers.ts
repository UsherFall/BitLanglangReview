import { defaultBinanceFetchJson, type FetchJson } from './http';
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
 * The full-market call costs 40 request weight on Binance, so the result is
 * cached briefly. Both the coin scan and the alert monitor share one source
 * instance, and 24h volume/price change move slowly enough that a 30s TTL never
 * skews a scan — it just stops repeated scans (or a scan colliding with an alert
 * tick) from burning 40 weight each time.
 */
const TICKER_TTL_MS = 30_000;

export class BinanceTickerSource implements TickerSource {
  private cache: { at: number; tickers: Ticker[] } | null = null;
  private inflight: Promise<Ticker[]> | null = null;

  constructor(private readonly fetchJson: FetchJson = defaultBinanceFetchJson) {}

  async listTickers(): Promise<Ticker[]> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < TICKER_TTL_MS) return this.cache.tickers;
    // Reuse an in-flight fetch so a scan and an alert tick landing together
    // only ever produce one request.
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

  private async fetchAndMap(): Promise<Ticker[]> {
    const response = (await this.fetchJson('https://fapi.binance.com/fapi/v1/ticker/24hr')) as BinanceTicker24hr[];
    if (!Array.isArray(response)) return [];
    return response
      .filter((item) => isUsdtPerpetual(item.symbol))
      .map((item) => ({
        instrument: item.symbol as string,
        quoteVolume24h: Number(item.quoteVolume),
        lastPrice: Number(item.lastPrice),
        change24h: Number(item.priceChangePercent),
      }))
      .filter((ticker) => Number.isFinite(ticker.quoteVolume24h) && Number.isFinite(ticker.lastPrice) && Number.isFinite(ticker.change24h))
      .sort((a, b) => b.quoteVolume24h - a.quoteVolume24h);
  }
}

function isUsdtPerpetual(symbol: string | undefined): boolean {
  return typeof symbol === 'string' && symbol.endsWith('USDT') && !STABLECOIN_QUOTE_PAIRS.has(symbol);
}
