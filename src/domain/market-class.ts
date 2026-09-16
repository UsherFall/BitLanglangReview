/**
 * Market class of a contract, as reported by the exchange's instrument
 * metadata (Binance `fapi/v1/exchangeInfo` `underlyingType`).
 *
 * The class drives two independent decisions, each in its own module:
 * - `scan-pool.ts` — whether the instrument belongs in the scan pool at all;
 * - `market-session.ts` — when its underlying market is open, used both to skip
 *   closed instruments and to drop closed-market candles from the series.
 */
export type MarketClass =
  | 'CRYPTO'
  | 'US_EQUITY'
  | 'HK_EQUITY'
  | 'KR_EQUITY'
  | 'CN_EQUITY'
  | 'COMMODITY'
  | 'PRE_IPO';
