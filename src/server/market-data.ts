import type { Candlestick } from '../domain/candlestick';
import type { MarketClass } from '../domain/market-class';
import type { ReviewTimeframe } from '../domain/trade';

/**
 * A normalized market-data ticker. Sources (OKX, Binance, ...) map their native
 * payloads into this shape so services like the coin scan stay
 * data-source-agnostic.
 *
 * - `quoteVolume24h` is the 24h quote volume in USDT (OKX computes it as
 *   `volCcy24h * last`; Binance already reports USDT-denominated `quoteVolume`).
 * - `change24h` is the 24h price change in percent.
 */
export type Ticker = {
  instrument: string;
  quoteVolume24h: number;
  lastPrice: number;
  change24h: number;
  /**
   * Class of the underlying market, from the exchange's instrument metadata.
   * ABSENT means the class is UNKNOWN — not "no session": consumers treat an
   * unknown class as always-open (crypto-like), which is the pre-09/16
   * behaviour. A source without metadata (OKX) therefore leaves it unset, and
   * so does a Binance metadata outage — which is why sources report that state
   * through `metadataAvailable()` instead of letting it pass silently.
   */
  marketClass?: MarketClass;
};

export interface TickerSource {
  listTickers(): Promise<Ticker[]>;
  /**
   * Whether the last `listTickers()` could attach `marketClass` values.
   * Optional: sources that never classify instruments omit it. `false` means
   * session gating was effectively off for that snapshot.
   */
  metadataAvailable?(): boolean;
}

export type CandleRequest = {
  instrument: string;
  timeframe: ReviewTimeframe;
  anchor: number;
  direction: 'earlier' | 'later';
  limit: number;
  /** Bypass the cache-freshness gate and always fetch from the market source. */
  refresh?: boolean;
};

export interface CandleSource {
  getCandlesticks(request: CandleRequest): Promise<Candlestick[]>;
}
