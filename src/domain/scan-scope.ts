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
 * The market-data sources the coin scan can run against, and the default when
 * neither a request nor the server config picks one. Each source is wired with
 * its own tickers/candles/gate in `app-plugin.ts`; the scan picks one per
 * REQUEST (`/api/scan?source=…`), so the startup value is only the default
 * selection — not a hard binding.
 */
export const MARKET_DATA_SOURCES = ['binance', 'okx', 'bitget'] as const;

export type MarketDataSource = (typeof MARKET_DATA_SOURCES)[number];

export const DEFAULT_MARKET_DATA_SOURCE: MarketDataSource = 'bitget';

/** Narrows an untrusted value (query param / server config) to a `MarketDataSource`. */
export function isMarketDataSource(v: unknown): v is MarketDataSource {
  return (MARKET_DATA_SOURCES as readonly unknown[]).includes(v);
}

export type ScanParams = { topN: number; minQuoteVolume24h: number };

/**
 * Per-`source × scope` defaults for the shrink method's parameters, used when a
 * request omits them and mirrored by the panel's inputs.
 *
 * `topN` is the HARD gate (the pool is simply the top N by 24h volume); the
 * volume floor is a guard rail, so it must stay BELOW that source's topN cutoff
 * — otherwise the floor, not `topN`, decides the pool size. The floor therefore
 * has to follow the venue's own scale: measured 2026-10-12, Bitget/Binance
 * overlapping instruments sit at ≈0.10 of Binance's 24h volume, so Binance's 10M
 * floor left Bitget with only 33 crypto instruments (vs 189 on Binance) and made
 * the raised `topN` a no-op.
 *
 * The equity pool is far smaller than the crypto one (measured: ~45 equity
 * contracts clear the volume floor against 700+ crypto ones), so a smaller
 * `topN` covers it without changing the liquidity floor. The crypto pool is 150
 * (raised from 60 on 10/11): 60 slots let the mid-cap tier that only converges
 * on 4H/1D fall out of the scan entirely, and 150 is the compromise that reaches
 * that tier while keeping a cold scan's klines budget (150 × 5 timeframes)
 * inside the shared rate budget. OKX does not classify instruments, so its
 * equity scope is a placeholder for symmetry.
 */
const SCAN_PARAM_DEFAULTS: Readonly<Record<MarketDataSource, Readonly<Record<ScanScope, ScanParams>>>> = {
  binance: {
    crypto: { topN: 150, minQuoteVolume24h: 10_000_000 },
    equity: { topN: 30, minQuoteVolume24h: 10_000_000 },
  },
  bitget: {
    crypto: { topN: 150, minQuoteVolume24h: 500_000 },
    equity: { topN: 30, minQuoteVolume24h: 3_000_000 },
  },
  okx: {
    crypto: { topN: 150, minQuoteVolume24h: 1_000_000 },
    equity: { topN: 30, minQuoteVolume24h: 1_000_000 },
  },
};

/** The defaults one `source × scope` pair runs with (see `SCAN_PARAM_DEFAULTS`). */
export function defaultScanParams(source: MarketDataSource, scope: ScanScope): ScanParams {
  return SCAN_PARAM_DEFAULTS[source][scope];
}
