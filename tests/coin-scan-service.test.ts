import { describe, expect, it, vi } from 'vitest';
import type { Candlestick } from '../src/domain/candlestick';
import type { ShrinkScanParams } from '../src/domain/coin-scan';
import { CoinScanService } from '../src/server/coin-scan-service';
import type { Ticker } from '../src/server/market-data';

function makeCandle(timestamp: number, volume: number): Candlestick {
  return {
    instrument: 'BTC-USDT-SWAP',
    timeframe: '5m',
    timestamp,
    open: 100,
    high: 100,
    low: 100,
    close: 100,
    volume,
  };
}

const STEP = 5 * 60_000; // 5m
const now = Date.now();
// Start of the current (still-forming) 5m bar; the scan drops bars that have not
// closed (timestamp + STEP > now), so only periodStart is dropped.
const periodStart = now - (now % STEP);
// completedBars(k, volume) is a bar that closed k periods ago.
const completedBar = (barsBack: number, volume: number) => makeCandle(periodStart - barsBack * STEP, volume);
// formingBar(volume) is the still-forming current bar.
const formingBar = (volume: number) => makeCandle(periodStart, volume);

// The service consumes the normalized TickerSource result (already USDT-settled,
// already sorted by 24h quote-volume descending). The pool here mimics an OKX
// source; the same shape would arrive from Binance with plain names.
const tickers: Ticker[] = [
  { instrument: 'BTC-USDT-SWAP', quoteVolume24h: 150000000 * 60000, lastPrice: 60000, change24h: ((60000 - 62000) / 62000) * 100 },
  { instrument: 'ETH-USDT-SWAP', quoteVolume24h: 90000000 * 3500, lastPrice: 3500, change24h: ((3500 - 3400) / 3400) * 100 },
  { instrument: 'SOL-USDT-SWAP', quoteVolume24h: 50000000 * 150, lastPrice: 150, change24h: ((150 - 140) / 140) * 100 },
];

const params: ShrinkScanParams = {
  method: 'shrink',
  timeframe: '5m',
  topN: 2,
  ratioThreshold: 0.7,
  consecutive: 2,
  window: 2,
  minQuoteVolume24h: 0,
  boxWindow: 2,
  maxCompression: 0.8,
  maxLatestTrend: 0.9,
  trendWindow: 2,
};

// Five candles where the newest (forming) one has a huge volume. When it is
// dropped before computing, the last two completed ratios stay below 0.7 and
// the coin qualifies; when it is kept, the streak breaks.
const fiveCandles = [
  completedBar(4, 100),
  completedBar(3, 100),
  completedBar(2, 20), // ratio 0.2
  completedBar(1, 15), // ratio 0.25
  formingBar(500), // still-forming bar, must be dropped
];

describe('CoinScanService', () => {
  it('scans top-N USDT swap instruments ranked by intensity and drops the forming bar', async () => {
    const getCandlesticks = vi.fn(async () => fiveCandles);
    const service = new CoinScanService({ listTickers: vi.fn(async () => tickers) }, { getCandlesticks });

    const result = await service.scanShrink(params);

    expect(result.scanned.map((row) => row.instrument).sort()).toEqual(['BTC-USDT-SWAP', 'ETH-USDT-SWAP']);
    expect(getCandlesticks).toHaveBeenCalledWith({
      instrument: 'BTC-USDT-SWAP',
      timeframe: '5m',
      direction: 'earlier',
      limit: 5, // max(window + consecutive, 2 * boxWindow) + 1 forming bar
      anchor: expect.any(Number),
    });
    for (const row of result.scanned) {
      expect(row.qualified).toBe(true);
      // Flat candles make amplitudeRatio 0, so quiet scores are volume ratios
      // halved: intensity = mean((0.2/2, 0.25/2)).
      expect(row.intensity).toBeCloseTo(((0.2 + 0.25) / 2) / 2);
      expect(row.amplitudeRatio).toBe(0);
      expect(row.consecutiveQuiet).toBe(2);
    }
    // quoteVolume24h is 24h quote-volume in USDT = volCcy24h * last.
    expect(result.scanned.find((row) => row.instrument === 'BTC-USDT-SWAP')?.quoteVolume24h).toBe(150000000 * 60000);
    expect(result.scanned.find((row) => row.instrument === 'ETH-USDT-SWAP')?.quoteVolume24h).toBe(90000000 * 3500);
    expect(result.qualifiedCount).toBe(2);
    // BTC-USDT-SWAP first in the fetch order (150M quote volume), ETH second.
    expect(result.scanned[0].instrument).toBe('BTC-USDT-SWAP');
    // The response echoes the effective scan parameters.
    expect(result.params.boxWindow).toBe(2);
    expect(result.params.maxCompression).toBe(0.8);
    expect(result.params.maxLatestTrend).toBe(0.9);
    expect(result.params.trendWindow).toBe(2);
    // Flat candles make compression 0 and latestTrend 0 (both windows flat), so
    // the row carries them.
    for (const row of result.scanned) {
      expect(row.compression).toBe(0);
      expect(row.latestTrend).toBe(0);
    }
  });

  it('keeps the newest completed bar when the source has no forming bar', async () => {
    // Four completed bars, no forming bar present. Slicing the newest element
    // unconditionally (the old behavior) dropped the newest COMPLETED bar, leaving
    // only 3 bars → insufficient history → coin skipped. The time-based filter
    // keeps all four, so the coin qualifies.
    const candles = [completedBar(4, 100), completedBar(3, 100), completedBar(2, 20), completedBar(1, 15)];
    const getCandlesticks = vi.fn(async () => candles);
    const service = new CoinScanService({ listTickers: vi.fn(async () => tickers) }, { getCandlesticks });
    const result = await service.scanShrink(params);
    expect(result.scanned.length).toBe(2);
    for (const row of result.scanned) expect(row.qualified).toBe(true);
  });

  it('carries the 24h change percentage from the ticker source onto each row', async () => {
    const service = new CoinScanService({ listTickers: vi.fn(async () => tickers) }, { getCandlesticks: vi.fn(async () => fiveCandles) });
    const result = await service.scanShrink(params);
    const btc = result.scanned.find((row) => row.instrument === 'BTC-USDT-SWAP');
    expect(btc?.lastPrice).toBe(60000);
    expect(btc?.change24h).toBeCloseTo(((60000 - 62000) / 62000) * 100);
    const eth = result.scanned.find((row) => row.instrument === 'ETH-USDT-SWAP');
    expect(eth?.change24h).toBeCloseTo(((3500 - 3400) / 3400) * 100);
  });

  it('skips instruments without enough candle history', async () => {
    const getCandlesticks = vi.fn(async () => [completedBar(2, 100), completedBar(1, 100)]);
    const service = new CoinScanService({ listTickers: vi.fn(async () => tickers) }, { getCandlesticks });
    const result = await service.scanShrink(params);
    expect(result.scanned).toEqual([]);
    expect(result.qualifiedCount).toBe(0);
  });

  it('sorts scanned rows by intensity ascending with the most-shrunk coin first', async () => {
    const getCandlesticks = vi
      .fn()
      .mockResolvedValueOnce(fiveCandles) // BTC: intensity 0.225
      .mockResolvedValueOnce(
        [
          completedBar(4, 100),
          completedBar(3, 100),
          completedBar(2, 10), // ratio 0.1
          completedBar(1, 5), // ratio 0.05
          formingBar(500), // still-forming, dropped
        ],
      ); // ETH: intensity 0.075
    const service = new CoinScanService({ listTickers: vi.fn(async () => tickers) }, { getCandlesticks });
    const result = await service.scanShrink(params);
    expect(result.scanned.map((row) => row.instrument)).toEqual(['ETH-USDT-SWAP', 'BTC-USDT-SWAP']);
  });

  it('filters out instruments below the minimum 24h quote volume before picking top-N', async () => {
    const getCandlesticks = vi.fn(async () => fiveCandles);
    const service = new CoinScanService({ listTickers: vi.fn(async () => tickers) }, { getCandlesticks });
    // BTC quote-volume = 150M * 60000 = 9e12; ETH = 90M * 3500 = 3.15e11.
    const result = await service.scanShrink({ ...params, minQuoteVolume24h: 5e11 });
    expect(result.scanned.map((row) => row.instrument)).toEqual(['BTC-USDT-SWAP']);
  });

  it('pulls max(window + consecutive, 2 * boxWindow) + 1 bars so both compression windows are covered', async () => {
    const candles: Candlestick[] = [];
    for (let i = 1; i <= 12; i += 1) candles.push(completedBar(i, 100));
    candles.push(formingBar(500)); // still-forming bar, must be dropped
    const getCandlesticks = vi.fn(async () => candles);
    const service = new CoinScanService({ listTickers: vi.fn(async () => tickers) }, { getCandlesticks });
    const result = await service.scanShrink({ ...params, boxWindow: 6 });
    // window + consecutive = 4, 2 * boxWindow = 12 → limit = 13.
    expect(getCandlesticks).toHaveBeenCalledWith(expect.objectContaining({ limit: 13 }));
    // The 12 completed bars cover recent + prior windows, so metrics are computed.
    expect(result.scanned.length).toBeGreaterThan(0);
    expect(result.scanned[0].compression).toBe(0);
  });
});
