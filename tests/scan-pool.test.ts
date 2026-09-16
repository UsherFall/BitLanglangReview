import { describe, expect, it } from 'vitest';
import { isScannable } from '../src/domain/scan-pool';

describe('isScannable', () => {
  it('covers crypto, indices, commodities and the two equity markets the scan supports', () => {
    expect(isScannable('CRYPTO')).toBe(true);
    expect(isScannable('COMMODITY')).toBe(true);
    expect(isScannable('US_EQUITY')).toBe(true);
    expect(isScannable('KR_EQUITY')).toBe(true);
  });

  it('excludes Hong Kong, mainland China and pre-IPO instruments', () => {
    expect(isScannable('HK_EQUITY')).toBe(false);
    expect(isScannable('CN_EQUITY')).toBe(false);
    expect(isScannable('PRE_IPO')).toBe(false);
  });

  it('keeps unclassified instruments scannable so a metadata outage cannot empty the pool', () => {
    expect(isScannable(undefined)).toBe(true);
  });
});
