import type { MarketClass } from './market-class';

/**
 * Which sub-module of 选品 (Instrument Scan) a scan runs in.
 *
 * The split is by ASSET CLASS, not by data source — both scopes read Binance
 * USDT-M candles; what differs is the session semantics: crypto trades around
 * the clock, while equities are only judged on their real trading sessions
 * (`market-session.ts`) and their closed-market candles are dropped before the
 * detector runs. Keeping one ranked pool for both would let high-volume equity
 * perps crowd live crypto out of the `topN` slots (measured: 19 of the top 60).
 */
export type ScanScope = 'crypto' | 'equity';

export const SCAN_SCOPES: readonly ScanScope[] = ['crypto', 'equity'];

/** Narrows an untrusted string (query param) to a `ScanScope`. */
export function isScanScope(value: string): value is ScanScope {
  return (SCAN_SCOPES as readonly string[]).includes(value);
}

/**
 * The scope an instrument belongs to. US and Korean equities are the only
 * session-gated classes in the pool, so they are the equity scope; everything
 * else — crypto, indices, commodities, and instruments whose class is unknown
 * (metadata outage) — belongs to the crypto scope, matching the pre-09/16
 * behaviour of treating an unclassified instrument as crypto.
 */
export function scanScopeOf(marketClass: MarketClass | undefined): ScanScope {
  return marketClass === 'US_EQUITY' || marketClass === 'KR_EQUITY' ? 'equity' : 'crypto';
}

/**
 * Per-scope defaults for the shrink method's parameters, used when a request
 * omits them and mirrored by the panel's inputs. The equity pool is far smaller
 * than the crypto one (measured: ~45 equity contracts clear the volume floor
 * against 700+ crypto ones), so a smaller `topN` covers it without changing the
 * liquidity floor.
 */
export const DEFAULT_SCAN_PARAMS: Readonly<Record<ScanScope, { topN: number; minQuoteVolume24h: number }>> = {
  crypto: { topN: 60, minQuoteVolume24h: 10_000_000 },
  equity: { topN: 30, minQuoteVolume24h: 10_000_000 },
};
