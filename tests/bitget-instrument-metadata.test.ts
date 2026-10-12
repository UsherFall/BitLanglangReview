import { describe, expect, it, vi } from 'vitest';
import { BitgetInstrumentMetadataSource } from '../src/server/bitget-instrument-metadata';

const contractsResponse = {
  code: '00000',
  msg: 'success',
  data: [
    { symbol: 'BTCUSDT', isRwa: 'NO' },
    { symbol: 'ETHUSDT', isRwa: 'NO' },
    { symbol: 'TSLAUSDT', isRwa: 'YES' },
    { symbol: 'XAUUSDT', isRwa: 'YES' },
    // No isRwa flag → unclassified, must not enter the map.
    { symbol: 'NEWUSDT' },
  ],
};

describe('BitgetInstrumentMetadataSource', () => {
  it('fetches the USDT-FUTURES contracts and maps symbols to classes', async () => {
    const fetchJson = vi.fn(async () => contractsResponse);
    const source = new BitgetInstrumentMetadataSource(fetchJson);

    const classes = await source.load();

    expect(fetchJson).toHaveBeenCalledWith('https://api.bitget.com/api/v2/mix/market/contracts?productType=USDT-FUTURES');
    expect(classes.get('BTCUSDT')).toBe('CRYPTO');
    expect(classes.get('TSLAUSDT')).toBe('US_EQUITY');
    // Two-bucket rule: gold is an RWA contract → US_EQUITY (session-gated).
    expect(classes.get('XAUUSDT')).toBe('US_EQUITY');
    // Unclassified symbols are absent, not defaulted.
    expect(classes.has('NEWUSDT')).toBe(false);
    expect(classes.size).toBe(4);
  });

  it('caches the map for the TTL and dedupes concurrent callers', async () => {
    const fetchJson = vi.fn(async () => contractsResponse);
    const source = new BitgetInstrumentMetadataSource(fetchJson);

    const [first, second] = await Promise.all([source.load(), source.load()]);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);

    await source.load();
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it('degrades to an empty map when the fetch fails', async () => {
    const fetchJson = vi.fn(async () => {
      throw new Error('Bitget request failed: request timed out after 12s');
    });
    const source = new BitgetInstrumentMetadataSource(fetchJson);

    expect(await source.load()).toEqual(new Map());
  });

  it('degrades to an empty map on a non-array payload', async () => {
    const fetchJson = vi.fn(async () => ({ code: '400172', msg: 'Parameter verification failed', data: null }));
    const source = new BitgetInstrumentMetadataSource(fetchJson);

    expect(await source.load()).toEqual(new Map());
  });

  it('skips rows without a symbol', async () => {
    const fetchJson = vi.fn(async () => ({ data: [{ isRwa: 'YES' }, { symbol: 'BTCUSDT', isRwa: 'NO' }] }));
    const source = new BitgetInstrumentMetadataSource(fetchJson);

    const classes = await source.load();

    expect([...classes.entries()]).toEqual([['BTCUSDT', 'CRYPTO']]);
  });
});
