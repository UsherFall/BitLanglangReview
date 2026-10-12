import { defaultBitgetMarketFetchJson, type FetchJson } from './http';
import { STABLECOIN_QUOTE_PAIRS } from '../domain/stablecoin-quotes';
import type { MarketClass } from '../domain/market-class';
import type { BitgetInstrumentMetadataSource } from './bitget-instrument-metadata';
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
 * `marketClass` comes from the contracts endpoint's `isRwa` flag via
 * `BitgetInstrumentMetadataSource` (two buckets: CRYPTO vs US_EQUITY — see
 * `bitget-market-class.ts`). With classification attached, the 354 RWA
 * contracts (US/HK/KR/JP equities, metals, indices, FX, pre-IPO) leave the
 * crypto scope for the equity scope and its US-session gate; without a wired
 * metadata source everything reads as crypto-like again, which is why
 * `metadataAvailable()` reports that state — the scan surfaces it as
 * `metadataUnavailable` instead of silently flooding the crypto scan with
 * high-volume stock perps.
 *
 * The full-market response is ~400KB, so it is cached briefly (30s TTL);
 * consumers share one source instance, and 24h volume/price change move slowly
 * enough that the TTL never skews a scan.
 */
const TICKER_TTL_MS = 30_000;

export class BitgetTickerSource implements TickerSource {
  private cache: { at: number; tickers: Ticker[] } | null = null;
  private inflight: Promise<Ticker[]> | null = null;
  /** Whether the last listTickers() could attach instrument classes. */
  private metadataOk = true;

  constructor(
    private readonly fetchJson: FetchJson = defaultBitgetMarketFetchJson,
    /** Optional instrument-class metadata; absent = tickers carry no market class. */
    private readonly metadataSource: BitgetInstrumentMetadataSource | null = null,
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
    const [response, metadata] = await Promise.all([
      this.fetchJson('https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES'),
      this.metadataSource ? this.metadataSource.load() : Promise.resolve(new Map<string, MarketClass>()),
    ]);
    // No metadata source wired, or the fetch degraded to an empty map: consumers
    // lose session gating, so say so rather than pretending everything is crypto.
    this.metadataOk = this.metadataSource !== null && metadata.size > 0;
    const payload = response as { data?: BitgetTicker[] };
    if (!Array.isArray(payload?.data)) return [];
    return payload.data
      .filter((item) => isUsdtPerpetual(item.symbol))
      .map((item) => {
        const ticker: Ticker = {
          instrument: item.symbol as string,
          quoteVolume24h: Number(item.usdtVolume),
          lastPrice: Number(item.lastPr),
          // Bitget reports a fraction; the Ticker contract is a percent.
          change24h: Number(item.change24h) * 100,
        };
        const marketClass = metadata.get(item.symbol as string);
        if (marketClass) ticker.marketClass = marketClass;
        return ticker;
      })
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
