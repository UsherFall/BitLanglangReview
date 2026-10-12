import { describe, expect, it, vi } from 'vitest';
import { BitgetTickerSource } from '../src/server/bitget-tickers';
import { BitgetInstrumentMetadataSource } from '../src/server/bitget-instrument-metadata';

const tickerResponse = {
  data: [
    { symbol: 'BTCUSDT', lastPr: '83553.1', change24h: '0.00744', usdtVolume: '1216963842.75' },
    { symbol: 'USDCUSDT', lastPr: '1', change24h: '0.0001', usdtVolume: '5000000000' },
    { symbol: 'ETHUSDT', lastPr: '2543.18', change24h: '0.01424', usdtVolume: '978689051.08' },
    // Non-USDT quote pair: filtered out by the USDT-perpetual check.
    { symbol: 'ETHUSDC', lastPr: '2543.18', change24h: '0.01424', usdtVolume: '100000' },
  ],
};

describe('BitgetTickerSource', () => {
  it('fetches the USDT-FUTURES full-market tickers', async () => {
    const fetchJson = vi.fn(async () => tickerResponse);
    const source = new BitgetTickerSource(fetchJson);

    await source.listTickers();

    expect(fetchJson).toHaveBeenCalledWith('https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES');
  });

  it('filters to USDT perpetuals, excludes stablecoin pairs, and sorts by USDT volume descending', async () => {
    const fetchJson = vi.fn(async () => tickerResponse);
    const source = new BitgetTickerSource(fetchJson);

    const tickers = await source.listTickers();

    expect(tickers.map((ticker) => ticker.instrument)).toEqual(['BTCUSDT', 'ETHUSDT']);
    expect(tickers[0].quoteVolume24h).toBe(1216963842.75);
    expect(tickers[1].quoteVolume24h).toBe(978689051.08);
  });

  it('maps lastPrice straight and converts the fractional change24h to a percent', async () => {
    const fetchJson = vi.fn(async () => tickerResponse);
    const source = new BitgetTickerSource(fetchJson);

    const tickers = await source.listTickers();

    const btc = tickers.find((ticker) => ticker.instrument === 'BTCUSDT');
    expect(btc?.lastPrice).toBe(83553.1);
    // Bitget reports 0.00744 (a fraction); the Ticker contract is a percent.
    expect(btc?.change24h).toBeCloseTo(0.744);
    const eth = tickers.find((ticker) => ticker.instrument === 'ETHUSDT');
    expect(eth?.change24h).toBeCloseTo(1.424);
  });

  it('skips entries with non-finite prices, volumes, or changes', async () => {
    const fetchJson = vi.fn(async () => ({
      data: [
        { symbol: 'BTCUSDT', lastPr: '83553.1', change24h: '0.00744', usdtVolume: '1216963842.75' },
        { symbol: 'BADUSDT', lastPr: 'abc', change24h: '0.01', usdtVolume: '100' },
        { symbol: 'BAD2USDT', lastPr: '1', change24h: 'xyz', usdtVolume: '100' },
      ],
    }));
    const source = new BitgetTickerSource(fetchJson);

    const tickers = await source.listTickers();

    expect(tickers.map((ticker) => ticker.instrument)).toEqual(['BTCUSDT']);
  });

  it('returns an empty list when the payload carries no data array', async () => {
    const fetchJson = vi.fn(async () => ({ code: '400172', msg: 'Parameter verification failed' }));
    const source = new BitgetTickerSource(fetchJson);

    expect(await source.listTickers()).toEqual([]);
  });

  it('caches the snapshot for the TTL and dedupes concurrent callers', async () => {
    const fetchJson = vi.fn(async () => tickerResponse);
    const source = new BitgetTickerSource(fetchJson);

    const [first, second] = await Promise.all([source.listTickers(), source.listTickers()]);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);

    await source.listTickers();
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it('leaves marketClass unset and reports metadata unavailable when no metadata source is wired', async () => {
    const fetchJson = vi.fn(async () => tickerResponse);
    const source = new BitgetTickerSource(fetchJson);

    const tickers = await source.listTickers();

    expect(tickers.every((ticker) => ticker.marketClass === undefined)).toBe(true);
    expect(source.metadataAvailable()).toBe(false);
  });

  it('attaches marketClass from the contracts metadata (two buckets)', async () => {
    const tickerFetch = vi.fn(async () => ({
      data: [
        { symbol: 'BTCUSDT', lastPr: '83553.1', change24h: '0.00744', usdtVolume: '1216963842.75' },
        { symbol: 'TSLAUSDT', lastPr: '250', change24h: '0.01', usdtVolume: '900000000' },
        { symbol: 'XAUUSDT', lastPr: '4000', change24h: '0.005', usdtVolume: '500000000' },
      ],
    }));
    const metadataFetch = vi.fn(async () => ({
      data: [
        { symbol: 'BTCUSDT', isRwa: 'NO' },
        { symbol: 'TSLAUSDT', isRwa: 'YES' },
        { symbol: 'XAUUSDT', isRwa: 'YES' },
      ],
    }));
    const source = new BitgetTickerSource(tickerFetch, new BitgetInstrumentMetadataSource(metadataFetch));

    const tickers = await source.listTickers();

    expect(tickers.find((ticker) => ticker.instrument === 'BTCUSDT')?.marketClass).toBe('CRYPTO');
    // RWA contracts — stocks and gold alike — leave the crypto scope for the
    // gated equity scope (the two-bucket decision).
    expect(tickers.find((ticker) => ticker.instrument === 'TSLAUSDT')?.marketClass).toBe('US_EQUITY');
    expect(tickers.find((ticker) => ticker.instrument === 'XAUUSDT')?.marketClass).toBe('US_EQUITY');
    expect(source.metadataAvailable()).toBe(true);
  });

  it('reports metadata unavailable when the contracts fetch degrades to an empty map', async () => {
    const tickerFetch = vi.fn(async () => tickerResponse);
    const metadataFetch = vi.fn(async () => {
      throw new Error('Bitget request failed: request timed out after 12s');
    });
    const source = new BitgetTickerSource(tickerFetch, new BitgetInstrumentMetadataSource(metadataFetch));

    const tickers = await source.listTickers();

    expect(tickers.length).toBeGreaterThan(0);
    expect(tickers.every((ticker) => ticker.marketClass === undefined)).toBe(true);
    expect(source.metadataAvailable()).toBe(false);
  });
});
