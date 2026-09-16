import type { MarketClass } from './market-class';

/**
 * Which instruments belong in the scan pool at all.
 *
 * Scope decision (09/16, user): the scan covers crypto + indices + commodities
 * (Binance candles, 24/7) and US + Korean equities. Hong Kong / mainland China
 * equities and pre-IPO contracts are excluded: they have no session the scan can
 * trust (pre-IPO has no underlying market at all) and their liquidity sits below
 * the volume floor anyway. Widening this later is a one-line change — the
 * session windows for HK/CN already exist in `market-session.ts`.
 *
 * An instrument the metadata does not classify stays scannable, which is the
 * pre-09/16 behaviour: a metadata outage must not empty the scan.
 */
const SCANNABLE_CLASSES: ReadonlySet<MarketClass> = new Set<MarketClass>([
  'CRYPTO',
  'COMMODITY',
  'US_EQUITY',
  'KR_EQUITY',
]);

/** True when the instrument belongs in the scan pool. */
export function isScannable(marketClass: MarketClass | undefined): boolean {
  if (marketClass === undefined) return true;
  return SCANNABLE_CLASSES.has(marketClass);
}
