import { defaultBitgetMarketFetchJson, type FetchJson } from './http';
import { STABLECOIN_QUOTE_PAIRS } from '../domain/stablecoin-quotes';
import type { Ticker, TickerSource } from './market-data';

/**
 * Bitget USDT-FUTURES ticker row from `/api/v2/mix/market/tickers`. `usdtVolume`
 * is the 24h turnover in USDT; `change24h` is a FRACTION (0.00744 = +0.744%),
 * unlike Binance's percent — the mapping multiplies by 100 to honor the
 * `Ticker.change24h` percent contract.
 */
type BitgetTicker = {
  symbol?: string;
  lastPr?: string;
  change24h?: string;
  usdtVolume?: string;
};

/**
 * Bitget USDT-FUTURES perpetual tickers. A single request returns the whole
 * market (no pagination), so the source maps every USDT-quoted symbol, excludes
 * stablecoin pairs, ranks by 24h USDT turnover descending, and yields
 * normalized `Ticker` values.
 *
 * No `marketClass` is attached: Bitget's public API exposes no
 * instrument-classification metadata (unlike Binance `exchangeInfo`), so —
 * exactly like the OKX source — consumers treat every instrument as crypto-like
 * (always open, always scannable). Consequence: the equity scope has an empty
 * pool under this source; the crypto scope is unaffected. `metadataAvailable()`
 * is deliberately NOT implemented for the same reason OKX omits it — nothing
 * was lost, there is simply no metadata to report.
 *
 * The full-market response is ~400KB, so it is cached briefly (30s TTL);
 * consumers share one source instance, and 24h volume/price change move slowly
 * enough that the TTL never skews a scan.
 */
const TICKER_TTL_MS = 30_000;

export class BitgetTickerSource implements TickerSource {
  private cache: { at: number; tickers: Ticker[] } | null = null;
  private inflight: Promise<Ticker[]> | null = null;

  constructor(private readonly fetchJson: FetchJson = defaultBitgetMarketFetchJson) {}

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

  private async fetchAndMap(): Promise<Ticker[]> {
    const response = (await this.fetchJson(
      'https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES',
    )) as { data?: BitgetTicker[] };
    if (!Array.isArray(response?.data)) return [];
    return response.data
      .filter((item) => isUsdtPerpetual(item.symbol))
      .map((item) => ({
        instrument: item.symbol as string,
        quoteVolume24h: Number(item.usdtVolume),
        lastPrice: Number(item.lastPr),
        // Bitget reports a fraction; the Ticker contract is a percent.
        change24h: Number(item.change24h) * 100,
      }))
      .filter((ticker) => Number.isFinite(ticker.quoteVolume24h) && Number.isFinite(ticker.lastPrice) && Number.isFinite(ticker.change24h))
      .sort((a, b) => b.quoteVolume24h - a.quoteVolume24h);
  }
}

/**
 * USDT-FUTURES rows are perpetuals by construction (measured 2026-10-12: every
 * listed symbol ends with USDT and carries no delivery time), so the filter is
 * the same USDT-quote + stablecoin-exclusion rule the Binance source uses.
 */
function isUsdtPerpetual(symbol: string | undefined): boolean {
  return typeof symbol === 'string' && symbol.endsWith('USDT') && !STABLECOIN_QUOTE_PAIRS.has(symbol);
}
