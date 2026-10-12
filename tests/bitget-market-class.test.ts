import { describe, expect, it } from 'vitest';
import { bitgetMarketClass } from '../src/domain/bitget-market-class';

describe('bitgetMarketClass', () => {
  it('maps isRwa=NO to CRYPTO', () => {
    expect(bitgetMarketClass('NO')).toBe('CRYPTO');
  });

  it('maps isRwa=YES to US_EQUITY (two-bucket decision: everything non-crypto)', () => {
    expect(bitgetMarketClass('YES')).toBe('US_EQUITY');
  });

  it('leaves the class undefined for a missing or unrecognised flag', () => {
    // Unclassified, NOT "crypto": consumers treat it as always-open and the
    // ticker source reports the outage via metadataAvailable().
    expect(bitgetMarketClass(undefined)).toBeUndefined();
    expect(bitgetMarketClass('')).toBeUndefined();
    expect(bitgetMarketClass('yes')).toBeUndefined();
    expect(bitgetMarketClass('UNKNOWN')).toBeUndefined();
  });
});
