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

export type ScanParams = {
  /**
   * Pool CAP — an upper protection, NOT the pool definition (10/13). Absent =
   * the whole open pool of that scope. It used to be the hard gate (the pool was
   * simply the top N by 24h volume); that gate is what hid half of the labels
   * the user approved as "structurally good" (see `SCAN_PARAM_DEFAULTS`).
   */
  topN?: number;
  minQuoteVolume24h: number;
};

/**
 * Per-`source × scope` defaults for the shrink method's parameters, used when a
 * request omits them and mirrored by the panel's inputs (which leaves the 扫描数量
 * box empty = no cap).
 *
 * **`topN` is no longer the gate (10/13).** It was raised 60 → 150 on 10/11 to
 * reach the mid-cap tier — and the 10-12 calibration showed the tier is not
 * nearly far enough down: of the 8 labels the user approved as "structurally
 * good", four sit at 24h-volume ranks #224–#319 (measured 10/13 on Bitget:
 * BLESS #224, ACE #247, KAVA #298, CATI #319), so a top-N selector cannot see
 * them at all and no detector improvement can compensate. The pool is therefore
 * the WHOLE scannable universe of the scope, and `topN` survives only as an
 * optional cap. The 10/11 reasoning above ("raise the cut to reach the mid-cap
 * tier") is superseded by this measurement, not contradicted by it — the tier
 * it reached was still ~150 ranks too high.
 *
 * The expanded pool stays affordable because the 1D coarse screen runs FIRST and
 * only its survivors pay for the other four timeframes (a rejected instrument
 * costs exactly one klines request): ≈465 + ≈205×4 ≈ 1285 requests ≈ 65s at
 * Bitget's ~20 req/s pace, the same order as the old top-150 cold scan
 * (750 requests, ≈82s). See `server/coin-scan.md`.
 *
 * `minQuoteVolume24h` is a LOW RAIL now, not a selector — it only keeps empty /
 * dust contracts out of the candle budget. Bitget crypto was the one value still
 * acting as a selector: at 500_000 it kept 224 of the 465 crypto contracts and
 * dropped KAVA (287k), CATI (245k) and ACE (433k) — three of the four labels
 * above — so it was lowered to 100_000, which keeps 408 of 465 and leaves every
 * approved label ≥2.4× of headroom. The other venues keep their previous floors
 * pending their own measurement; Bitget equity keeps the smaller number because
 * its pool is far smaller (~36 RWA contracts clear 3M).
 */
const SCAN_PARAM_DEFAULTS: Readonly<Record<MarketDataSource, Readonly<Record<ScanScope, ScanParams>>>> = {
  binance: {
    crypto: { minQuoteVolume24h: 10_000_000 },
    equity: { minQuoteVolume24h: 10_000_000 },
  },
  bitget: {
    crypto: { minQuoteVolume24h: 100_000 },
    equity: { minQuoteVolume24h: 3_000_000 },
  },
  okx: {
    crypto: { minQuoteVolume24h: 1_000_000 },
    equity: { minQuoteVolume24h: 1_000_000 },
  },
};

/** The defaults one `source × scope` pair runs with (see `SCAN_PARAM_DEFAULTS`). */
export function defaultScanParams(source: MarketDataSource, scope: ScanScope): ScanParams {
  return SCAN_PARAM_DEFAULTS[source][scope];
}

/**
 * Window of the 1D coarse screen, in 1D bars — the calibrated `T` (10/13).
 * `rangePct` / `|netPct|` are measured over exactly this many 1D bars ending at
 * the newest completed bar. A `T` of 23 days is a SHARP optimum, not a plateau:
 * `T ± 1` loses 1–2 of the 7 covered labels in the calibration, so changing it
 * needs a re-run of `research/coarse-1d-percentile.md`, not a guess.
 */
export const COARSE_SCREEN_WINDOW_DAYS = 23;

/**
 * Pool percentile cap for the coarse screen's `rangePct` gate (the calibrated
 * `qR`) — a CONSTANT, deliberately not an absolute threshold: the actual
 * `rangePct` cut is recomputed from the current pool on every scan (see
 * `coarseScreen`). Writing a frozen `W`/`D` back in would restore the pool-rate
 * decay the percentile form removed (measured 31.2pp → 4.7pp on the 465 pool).
 */
export const COARSE_SCREEN_PCT_RANGE = 0.7370689655172413;

/** Pool percentile cap for the coarse screen's `|netPct|` gate (the calibrated `qN`). */
export const COARSE_SCREEN_PCT_NET = 0.4849137931034483;
