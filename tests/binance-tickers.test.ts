import { describe, expect, it, vi } from 'vitest';
import { BinanceTickerSource } from '../src/server/binance-tickers';
import { BinanceInstrumentMetadataSource } from '../src/server/binance-instrument-metadata';

const tickerResponse = [
  { symbol: 'XAUUSDT', lastPrice: '4000', openPrice: '3900', priceChangePercent: '2.56', quoteVolume: '2740000000' },
  { symbol: 'USDCUSDT', lastPrice: '1', openPrice: '1', priceChangePercent: '0.01', quoteVolume: '5000000000' },
  { symbol: 'BTCUSDT', lastPrice: '60000', openPrice: '62000', priceChangePercent: '-3.23', quoteVolume: '9000000000' },
  // Non-USDT quote pair (USDC-quoted): filtered out by the USDT-M perpetual check.
  { symbol: 'BTCUSDC', lastPrice: '60000', openPrice: '62000', priceChangePercent: '-3.23', quoteVolume: '100000' },
  { symbol: 'PAXGUSDT', lastPrice: '2800', openPrice: '2750', priceChangePercent: '1.82', quoteVolume: '1200000000' },
];

describe('BinanceTickerSource', () => {
  it('filters to USDT-M perpetuals, excludes stablecoin pairs, and sorts by quote volume descending', async () => {
    const fetchJson = vi.fn(async () => tickerResponse);
    const source = new BinanceTickerSource(fetchJson);

    const tickers = await source.listTickers();

    expect(fetchJson).toHaveBeenCalledWith('https://fapi.binance.com/fapi/v1/ticker/24hr');
    expect(tickers.map((ticker) => ticker.instrument)).toEqual(['BTCUSDT', 'XAUUSDT', 'PAXGUSDT']);
    expect(tickers[0].quoteVolume24h).toBe(9000000000);
    expect(tickers[1].quoteVolume24h).toBe(2740000000);
  });

  it('maps lastPrice and change24h straight from the Binance payload', async () => {
    const fetchJson = vi.fn(async () => tickerResponse);
    const source = new BinanceTickerSource(fetchJson);

    const tickers = await source.listTickers();

    const btc = tickers.find((ticker) => ticker.instrument === 'BTCUSDT');
    expect(btc?.lastPrice).toBe(60000);
    expect(btc?.change24h).toBeCloseTo(-3.23);
    const xau = tickers.find((ticker) => ticker.instrument === 'XAUUSDT');
    expect(xau?.lastPrice).toBe(4000);
    expect(xau?.change24h).toBeCloseTo(2.56);
  });

  it('skips entries with non-finite prices or volumes', async () => {
    const fetchJson = vi.fn(async () => [
      { symbol: 'BTCUSDT', lastPrice: '60000', openPrice: '62000', priceChangePercent: '-3.23', quoteVolume: '9000000000' },
      { symbol: 'BADUSDT', lastPrice: 'abc', openPrice: '62000', priceChangePercent: '1', quoteVolume: '100' },
    ]);
    const source = new BinanceTickerSource(fetchJson);

    const tickers = await source.listTickers();

    expect(tickers.map((ticker) => ticker.instrument)).toEqual(['BTCUSDT']);
  });

  it('returns an empty list when the payload is not an array', async () => {
    const fetchJson = vi.fn(async () => ({ error: 'rate limited' }));
    const source = new BinanceTickerSource(fetchJson);

    const tickers = await source.listTickers();

    expect(tickers).toEqual([]);
  });

  it('attaches marketClass for gated equity symbols from the metadata source', async () => {
    const tickerFetch = vi.fn(async () => [
      ...tickerResponse,
      { symbol: 'NVDAUSDT', lastPrice: '200', openPrice: '199', priceChangePercent: '0.5', quoteVolume: '8000000000' },
    ]);
    const metadataFetch = vi.fn(async () => ({
      symbols: [
        { symbol: 'BTCUSDT', underlyingType: 'COIN' },
        { symbol: 'XAUUSDT', underlyingType: 'COMMODITY' },
        { symbol: 'NVDAUSDT', underlyingType: 'EQUITY' },
      ],
    }));
    const source = new BinanceTickerSource(tickerFetch, new BinanceInstrumentMetadataSource(metadataFetch));

    const tickers = await source.listTickers();

    const nvda = tickers.find((ticker) => ticker.instrument === 'NVDAUSDT');
    expect(nvda?.marketClass).toBe('US_EQUITY');
    // Crypto/commodity stay ungated (field absent).
    const btc = tickers.find((ticker) => ticker.instrument === 'BTCUSDT');
    expect(btc?.marketClass).toBeUndefined();
    const xau = tickers.find((ticker) => ticker.instrument === 'XAUUSDT');
    expect(xau?.marketClass).toBeUndefined();
  });

  it('keeps tickers ungated when metadata is unavailable', async () => {
    const tickerFetch = vi.fn(async () => [
      { symbol: 'NVDAUSDT', lastPrice: '200', openPrice: '199', priceChangePercent: '0.5', quoteVolume: '8000000000' },
    ]);
    const metadataFetch = vi.fn(async () => {
      throw new Error('network down');
    });
    const source = new BinanceTickerSource(tickerFetch, new BinanceInstrumentMetadataSource(metadataFetch));

    const tickers = await source.listTickers();

    expect(tickers).toHaveLength(1);
    expect(tickers[0].marketClass).toBeUndefined();
  });

  it('keeps tickers ungated when no metadata source is wired', async () => {
    const fetchJson = vi.fn(async () => tickerResponse);
    const source = new BinanceTickerSource(fetchJson);

    const tickers = await source.listTickers();

    expect(tickers[0].marketClass).toBeUndefined();
  });
});
