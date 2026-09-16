import { describe, expect, it } from 'vitest';
import { DEFAULT_SCAN_PARAMS, SCAN_SCOPES, isScanScope, scanScopeOf } from '../src/domain/scan-scope';

describe('scan scopes', () => {
  it('exposes exactly the two sub-modules', () => {
    expect(SCAN_SCOPES).toEqual(['crypto', 'equity']);
  });

  it('narrows query values and rejects anything else', () => {
    expect(isScanScope('crypto')).toBe(true);
    expect(isScanScope('equity')).toBe(true);
    expect(isScanScope('stocks')).toBe(false);
    expect(isScanScope('')).toBe(false);
    expect(isScanScope('CRYPTO')).toBe(false);
  });

  it('puts US and Korean equities in the equity scope', () => {
    expect(scanScopeOf('US_EQUITY')).toBe('equity');
    expect(scanScopeOf('KR_EQUITY')).toBe('equity');
  });

  it('puts everything else — including unclassified — in the crypto scope', () => {
    expect(scanScopeOf('CRYPTO')).toBe('crypto');
    expect(scanScopeOf('COMMODITY')).toBe('crypto');
    // Out-of-pool classes never reach a scope, but if they did they must not
    // land in the equity sub-module.
    expect(scanScopeOf('HK_EQUITY')).toBe('crypto');
    expect(scanScopeOf('PRE_IPO')).toBe('crypto');
    expect(scanScopeOf(undefined)).toBe('crypto');
  });

  it('keeps the pre-09/16 crypto defaults and gives equity a smaller pool size', () => {
    expect(DEFAULT_SCAN_PARAMS.crypto).toEqual({ topN: 60, minQuoteVolume24h: 10_000_000 });
    expect(DEFAULT_SCAN_PARAMS.equity.topN).toBeLessThan(DEFAULT_SCAN_PARAMS.crypto.topN);
    expect(DEFAULT_SCAN_PARAMS.equity.minQuoteVolume24h).toBe(DEFAULT_SCAN_PARAMS.crypto.minQuoteVolume24h);
  });
});
