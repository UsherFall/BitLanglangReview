import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MARKET_DATA_SOURCE,
  MARKET_DATA_SOURCES,
  SCAN_SCOPES,
  defaultScanParams,
  isMarketDataSource,
  isScanScope,
  scanScopeOf,
} from '../src/domain/scan-scope';

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
});

describe('scan data sources', () => {
  it('offers the three switchable sources and defaults to Bitget', () => {
    expect(MARKET_DATA_SOURCES).toEqual(['binance', 'okx', 'bitget']);
    expect(DEFAULT_MARKET_DATA_SOURCE).toBe('bitget');
  });

  it('narrows an untrusted value (query param / server config) and rejects the rest', () => {
    expect(isMarketDataSource('binance')).toBe(true);
    expect(isMarketDataSource('okx')).toBe(true);
    expect(isMarketDataSource('bitget')).toBe(true);
    expect(isMarketDataSource('Bitget')).toBe(false);
    expect(isMarketDataSource('')).toBe(false);
    expect(isMarketDataSource(null)).toBe(false);
    expect(isMarketDataSource(undefined)).toBe(false);
  });
});

describe('defaultScanParams', () => {
  it('grades the volume floor by source × scope (measured 10/12: Bitget ≈ 1/10 of Binance volume)', () => {
    expect(defaultScanParams('binance', 'crypto')).toEqual({ topN: 150, minQuoteVolume24h: 10_000_000 });
    expect(defaultScanParams('binance', 'equity')).toEqual({ topN: 30, minQuoteVolume24h: 10_000_000 });
    expect(defaultScanParams('bitget', 'crypto')).toEqual({ topN: 150, minQuoteVolume24h: 500_000 });
    expect(defaultScanParams('bitget', 'equity')).toEqual({ topN: 30, minQuoteVolume24h: 3_000_000 });
    expect(defaultScanParams('okx', 'crypto')).toEqual({ topN: 150, minQuoteVolume24h: 1_000_000 });
    expect(defaultScanParams('okx', 'equity')).toEqual({ topN: 30, minQuoteVolume24h: 1_000_000 });
  });

  it('gives crypto the wider pool (150) and keeps equity smaller (30) on every source', () => {
    for (const source of MARKET_DATA_SOURCES) {
      expect(defaultScanParams(source, 'crypto').topN).toBe(150);
      expect(defaultScanParams(source, 'equity').topN).toBe(30);
      expect(defaultScanParams(source, 'equity').topN).toBeLessThan(defaultScanParams(source, 'crypto').topN);
    }
  });

  it('keeps every floor at or below its own topN cutoff scale (the floor is a rail, not the gate)', () => {
    // Binance's 10M floor emptied the Bitget pool (33 crypto instruments left),
    // which made the raised topN a no-op — the floor must follow the venue.
    expect(defaultScanParams('bitget', 'crypto').minQuoteVolume24h).toBeLessThan(defaultScanParams('binance', 'crypto').minQuoteVolume24h);
    for (const source of MARKET_DATA_SOURCES) {
      expect(defaultScanParams(source, 'crypto').minQuoteVolume24h).toBeGreaterThan(0);
    }
  });
});
