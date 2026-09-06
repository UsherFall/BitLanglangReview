import type { Candlestick } from '../domain/candlestick';
import type { MarketClass } from '../domain/market-session';
import type { ReviewTimeframe } from '../domain/trade';

/**
 * A normalized market-data ticker. Sources (OKX, Binance, ...) map their native
 * payloads into this shape so services like the coin scan and the alert monitor
 * stay data-source-agnostic.
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
   * Market class of the contract. Absent = ungated: always-open classes
   * (crypto/commodity/pre-IPO), the OKX source, or Binance metadata unavailable.
   */
  marketClass?: MarketClass;
};

export interface TickerSource {
  listTickers(): Promise<Ticker[]>;
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
