import { describe, expect, it } from 'vitest';
import {
  COARSE_SCREEN_PCT_NET,
  COARSE_SCREEN_PCT_RANGE,
  COARSE_SCREEN_WINDOW_DAYS,
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
    expect(defaultScanParams('binance', 'crypto')).toEqual({ minQuoteVolume24h: 10_000_000 });
    expect(defaultScanParams('binance', 'equity')).toEqual({ minQuoteVolume24h: 10_000_000 });
    expect(defaultScanParams('bitget', 'crypto')).toEqual({ minQuoteVolume24h: 100_000 });
    expect(defaultScanParams('bitget', 'equity')).toEqual({ minQuoteVolume24h: 3_000_000 });
    expect(defaultScanParams('okx', 'crypto')).toEqual({ minQuoteVolume24h: 1_000_000 });
    expect(defaultScanParams('okx', 'equity')).toEqual({ minQuoteVolume24h: 1_000_000 });
  });

  it('leaves topN uncapped on every pair (the pool is the whole scope universe)', () => {
    // `topN` is an optional CAP since 10/13, never a default: the pool is the
    // whole open universe of the scope (see the SCAN_PARAM_DEFAULTS doc comment).
    for (const source of MARKET_DATA_SOURCES) {
      expect(defaultScanParams(source, 'crypto').topN).toBeUndefined();
      expect(defaultScanParams(source, 'equity').topN).toBeUndefined();
    }
  });

  it('keeps the Bitget crypto floor low enough to reach the approved mid-cap labels', () => {
    // The floor is a RAIL, not a selector. At 500k it kept only 224 of the 465
    // crypto contracts and dropped KAVA (287k), CATI (245k) and ACE (433k) — three
    // of the eight labels the user approved as "structurally good" — which is the
    // bottleneck the pool expansion exists to remove (measured 10/13).
    const bitgetCrypto = defaultScanParams('bitget', 'crypto').minQuoteVolume24h;
    expect(bitgetCrypto).toBeLessThanOrEqual(250_000);
    expect(bitgetCrypto).toBeLessThan(defaultScanParams('binance', 'crypto').minQuoteVolume24h);
    // ...but never zero: an empty/dust contract must still cost no candle request.
    for (const source of MARKET_DATA_SOURCES) {
      for (const scope of SCAN_SCOPES) {
        expect(defaultScanParams(source, scope).minQuoteVolume24h).toBeGreaterThan(0);
      }
    }
  });
});

describe('coarse screen constants', () => {
  it('exposes the calibrated window and percentile caps as constants', () => {
    // Constants, NOT absolute thresholds: the actual rangePct/|netPct| cuts are
    // recomputed from the current pool on every scan (`coarseScreen`).
    expect(COARSE_SCREEN_WINDOW_DAYS).toBe(23);
    expect(COARSE_SCREEN_PCT_RANGE).toBeCloseTo(0.7371, 4);
    expect(COARSE_SCREEN_PCT_NET).toBeCloseTo(0.4849, 4);
    expect(COARSE_SCREEN_PCT_RANGE).toBeGreaterThan(COARSE_SCREEN_PCT_NET);
    for (const pct of [COARSE_SCREEN_PCT_RANGE, COARSE_SCREEN_PCT_NET]) {
      expect(pct).toBeGreaterThan(0);
      expect(pct).toBeLessThan(1);
    }
  });
});
