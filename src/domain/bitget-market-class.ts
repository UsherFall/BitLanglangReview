import type { MarketClass } from './market-class';

/**
 * Bitget instrument class from the contracts endpoint's `isRwa` flag
 * (`/api/v2/mix/market/contracts`): `NO` = crypto, `YES` = real-world asset
 * (US/HK/KR/JP equities, metals, energy, indices/ETFs, FX, pre-IPO).
 *
 * Two buckets by user decision (10/12, task `bitget-rwa-classify-heat-source`):
 * no commodity/equity/region sub-tables. Consequences are accepted and
 * recorded in the task PRD — 24/7 RWA products (gold, indices, FX) are gated
 * to the US session, and HK/JP/pre-IPO contracts are gated to the US session
 * rather than their own.
 *
 * `undefined` (flag missing or unrecognised) means UNCLASSIFIED, not "crypto":
 * consumers treat it as crypto-like and always-open, and the ticker source
 * reports the outage through `metadataAvailable()` so the scan can surface
 * `metadataUnavailable` instead of silently losing session gating.
 */
export function bitgetMarketClass(isRwa: string | undefined): MarketClass | undefined {
  if (isRwa === 'NO') return 'CRYPTO';
  if (isRwa === 'YES') return 'US_EQUITY';
  return undefined;
}
