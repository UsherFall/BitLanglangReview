import { describe, expect, it, vi } from 'vitest';
import {
  BinanceInstrumentMetadataSource,
  binanceInstrumentMetadata,
} from '../src/server/binance-instrument-metadata';

const exchangeInfoPayload = {
  symbols: [
    { symbol: 'BTCUSDT', underlyingType: 'COIN' },
    { symbol: 'XAUUSDT', underlyingType: 'COMMODITY' },
    { symbol: 'NVDAUSDT', underlyingType: 'EQUITY' },
    { symbol: 'SAMSUNGUSDT', underlyingType: 'KR_EQUITY' },
    { symbol: 'TENCENTUSDT', underlyingType: 'HK_EQUITY' },
    { symbol: 'ALIBABAUSDT', underlyingType: 'CN_EQUITY' },
    { symbol: 'METAUSDT', underlyingType: 'EQUITY' },
    { symbol: 'PREIPOUSDT', underlyingType: 'PREMARKET' },
    { symbol: 'SOMETHINGUSDT', underlyingType: 'FUTURES_NEW_UNKNOWN' },
  ],
};

describe('BinanceInstrumentMetadataSource', () => {
  it('maps Binance underlyingType to the domain MarketClass', async () => {
    const fetchJson = vi.fn(async () => exchangeInfoPayload);
    const source = new BinanceInstrumentMetadataSource(fetchJson);

    const map = await source.load();

    expect(fetchJson).toHaveBeenCalledWith('https://fapi.binance.com/fapi/v1/exchangeInfo');
    expect(map.get('NVDAUSDT')).toBe('US_EQUITY');
    expect(map.get('SAMSUNGUSDT')).toBe('KR_EQUITY');
    expect(map.get('TENCENTUSDT')).toBe('HK_EQUITY');
    expect(map.get('ALIBABAUSDT')).toBe('CN_EQUITY');
    expect(map.get('XAUUSDT')).toBe('COMMODITY');
    expect(map.get('PREIPOUSDT')).toBe('PRE_IPO');
    expect(map.get('BTCUSDT')).toBe('CRYPTO');
  });

  it('omits symbols with an unknown or missing underlyingType', async () => {
    const fetchJson = vi.fn(async () => exchangeInfoPayload);
    const source = new BinanceInstrumentMetadataSource(fetchJson);

    const map = await source.load();

    expect(map.has('SOMETHINGUSDT')).toBe(false);
  });

  it('reuses the cached map on a second load without another request', async () => {
    const fetchJson = vi.fn(async () => exchangeInfoPayload);
    const source = new BinanceInstrumentMetadataSource(fetchJson);

    await source.load();
    await source.load();

    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it('merges in-flight loads so concurrent callers produce one request', async () => {
    const fetchJson = vi.fn(async () => exchangeInfoPayload);
    const source = new BinanceInstrumentMetadataSource(fetchJson);

    const [first, second] = await Promise.all([source.load(), source.load()]);

    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(first.get('NVDAUSDT')).toBe('US_EQUITY');
    expect(second).toBe(first);
  });

  it('returns an empty map when the payload is not an array-shaped exchangeInfo', async () => {
    const fetchJson = vi.fn(async () => ({ error: 'rate limited' }));
    const source = new BinanceInstrumentMetadataSource(fetchJson);

    const map = await source.load();

    expect(map.size).toBe(0);
  });

  it('returns an empty map (no throw) when the request fails', async () => {
    const fetchJson = vi.fn(async () => {
      throw new Error('network down');
    });
    const source = new BinanceInstrumentMetadataSource(fetchJson);

    const map = await source.load();

    expect(map.size).toBe(0);
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it('shares a module-level singleton for the production path', () => {
    expect(binanceInstrumentMetadata()).toBe(binanceInstrumentMetadata());
  });
});

const exchangeInfoWithStatus = {
  symbols: [
    { symbol: 'BTCUSDT', underlyingType: 'COIN', status: 'TRADING' },
    { symbol: 'RAYUSDT', underlyingType: 'COIN', status: 'SETTLING' },
    { symbol: 'NOSTATUSUSDT', underlyingType: 'COIN' },
  ],
};

describe('BinanceInstrumentMetadataSource.symbolStatuses', () => {
  it('exposes the exchangeInfo status per symbol', async () => {
    const source = new BinanceInstrumentMetadataSource(vi.fn(async () => exchangeInfoWithStatus));

    const statuses = await source.symbolStatuses();

    expect(statuses.get('BTCUSDT')).toBe('TRADING');
    expect(statuses.get('RAYUSDT')).toBe('SETTLING');
  });

  it('omits a symbol whose payload carries no status, so absence means unknown', async () => {
    const source = new BinanceInstrumentMetadataSource(vi.fn(async () => exchangeInfoWithStatus));

    const statuses = await source.symbolStatuses();

    expect(statuses.has('NOSTATUSUSDT')).toBe(false);
  });

  it('serves load() and symbolStatuses() from one request', async () => {
    const fetchJson = vi.fn(async () => exchangeInfoWithStatus);
    const source = new BinanceInstrumentMetadataSource(fetchJson);

    await source.load();
    await source.symbolStatuses();

    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it('returns an empty status map (no throw) when the request fails', async () => {
    const source = new BinanceInstrumentMetadataSource(
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );

    await expect(source.symbolStatuses()).resolves.toEqual(new Map());
  });
});
