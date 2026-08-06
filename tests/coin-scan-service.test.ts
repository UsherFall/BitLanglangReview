import { describe, expect, it, vi } from 'vitest';
import type { Candlestick } from '../src/domain/candlestick';
import type { ShrinkScanParams } from '../src/domain/coin-scan';
import { CoinScanService } from '../src/server/coin-scan-service';
import type { Ticker } from '../src/server/market-data';

// amplitude = (high - low) / low; volume is carried but plays no role in the
// pure-price metrics (v5 removed the volume dimension).
function makeCandle(timestamp: number, volume: number, amplitude = 0): Candlestick {
  const low = 100;
  return {
    instrument: 'BTC-USDT-SWAP',
    timeframe: '5m',
    timestamp,
    open: low,
    high: low * (1 + amplitude),
    low,
    close: low,
    volume,
  };
}

const STEP = 5 * 60_000; // 5m
const now = Date.now();
// Start of the current (still-forming) 5m bar; the scan drops bars that have not
// closed (timestamp + STEP > now), so only periodStart is dropped.
const periodStart = now - (now % STEP);
// completedBar(k, ...) is a bar that closed k periods ago.
const completedBar = (barsBack: number, volume: number, amplitude = 0) => makeCandle(periodStart - barsBack * STEP, volume, amplitude);
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
  minQuoteVolume24h: 0,
  boxWindow: 2,
  maxCompression: 0.8,
  maxLatestTrend: 0.9,
  trendWindow: 2,
};

// Five candles where the newest (forming) one has a huge volume. When it is
// dropped before computing, the four completed flat candles give compression 0
// and latestTrend 0, so the coin qualifies under the pure-price gates.
const fiveCandles = [
  completedBar(4, 100),
  completedBar(3, 100),
  completedBar(2, 20),
  completedBar(1, 15),
  formingBar(500), // still-forming bar, must be dropped
];

describe('CoinScanService', () => {
  it('scans top-N USDT swap instruments ranked by score and drops the forming bar', async () => {
    const getCandlesticks = vi.fn(async () => fiveCandles);
    const service = new CoinScanService({ listTickers: vi.fn(async () => tickers) }, { getCandlesticks });

    const result = await service.scanShrink(params);

    expect(result.scanned.map((row) => row.instrument).sort()).toEqual(['BTC-USDT-SWAP', 'ETH-USDT-SWAP']);
    expect(getCandlesticks).toHaveBeenCalledWith({
      instrument: 'BTC-USDT-SWAP',
      timeframe: '5m',
      direction: 'earlier',
      limit: 5, // 2 * max(boxWindow, trendWindow) + 1 forming bar
      anchor: expect.any(Number),
    });
    for (const row of result.scanned) {
      expect(row.qualified).toBe(true);
      // Flat candles make compression 0 and latestTrend 0, so score = 0.
      expect(row.compression).toBe(0);
      expect(row.latestTrend).toBe(0);
      expect(row.score).toBe(0);
    }
    // quoteVolume24h is 24h quote-volume in USDT = volCcy24h * last.
    expect(result.scanned.find((row) => row.instrument === 'BTC-USDT-SWAP')?.quoteVolume24h).toBe(150000000 * 60000);
    expect(result.scanned.find((row) => row.instrument === 'ETH-USDT-SWAP')?.quoteVolume24h).toBe(90000000 * 3500);
    expect(result.qualifiedCount).toBe(2);
    // BTC-USDT-SWAP first in the fetch order (150M quote volume), ETH second;
    // equal scores keep the insertion order.
    expect(result.scanned[0].instrument).toBe('BTC-USDT-SWAP');
    // The response echoes the effective scan parameters.
    expect(result.params.boxWindow).toBe(2);
    expect(result.params.maxCompression).toBe(0.8);
    expect(result.params.maxLatestTrend).toBe(0.9);
    expect(result.params.trendWindow).toBe(2);
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

  it('sorts scanned rows by score ascending with the most-converged coin first', async () => {
    const getCandlesticks = vi
      .fn()
      .mockResolvedValueOnce([
        completedBar(4, 100, 0.02),
        completedBar(3, 100, 0.02),
        completedBar(2, 100, 0.02),
        completedBar(1, 100, 0.02),
        formingBar(500),
      ]) // BTC: compression 1.0, latestTrend 1.0, score 2.0
      .mockResolvedValueOnce([
        completedBar(4, 100, 0.02),
        completedBar(3, 100, 0.02),
        completedBar(2, 100, 0.006),
        completedBar(1, 100, 0.006),
        formingBar(500),
      ]); // ETH: compression 0.3, latestTrend 0.3, score 0.6
    const service = new CoinScanService({ listTickers: vi.fn(async () => tickers) }, { getCandlesticks });
    const result = await service.scanShrink(params);
    expect(result.scanned.map((row) => row.instrument)).toEqual(['ETH-USDT-SWAP', 'BTC-USDT-SWAP']);
  });

  it('uses a past anchor when provided instead of now, and echoes it in params', async () => {
    const getCandlesticks = vi.fn(async () => fiveCandles);
    const service = new CoinScanService({ listTickers: vi.fn(async () => tickers) }, { getCandlesticks });
    const pastAnchor = Date.parse('2026-08-04T00:00:00Z');
    const result = await service.scanShrink({ ...params, anchor: pastAnchor });
    expect(getCandlesticks).toHaveBeenCalledWith(expect.objectContaining({ anchor: pastAnchor }));
    expect(result.params.anchor).toBe(pastAnchor);
  });

  it('filters out instruments below the minimum 24h quote volume before picking top-N', async () => {
    const getCandlesticks = vi.fn(async () => fiveCandles);
    const service = new CoinScanService({ listTickers: vi.fn(async () => tickers) }, { getCandlesticks });
    // BTC quote-volume = 150M * 60000 = 9e12; ETH = 90M * 3500 = 3.15e11.
    const result = await service.scanShrink({ ...params, minQuoteVolume24h: 5e11 });
    expect(result.scanned.map((row) => row.instrument)).toEqual(['BTC-USDT-SWAP']);
  });

  it('pulls 2 * max(boxWindow, trendWindow) + 1 bars so both compression windows are covered', async () => {
    const candles: Candlestick[] = [];
    for (let i = 1; i <= 12; i += 1) candles.push(completedBar(i, 100));
    candles.push(formingBar(500)); // still-forming bar, must be dropped
    const getCandlesticks = vi.fn(async () => candles);
    const service = new CoinScanService({ listTickers: vi.fn(async () => tickers) }, { getCandlesticks });
    const result = await service.scanShrink({ ...params, boxWindow: 6 });
    // 2 * max(6, 2) + 1 = 13.
    expect(getCandlesticks).toHaveBeenCalledWith(expect.objectContaining({ limit: 13 }));
    // The 12 completed bars cover recent + prior windows, so metrics are computed.
    expect(result.scanned.length).toBeGreaterThan(0);
    expect(result.scanned[0].compression).toBe(0);
  });

  it('qualifies a gold-style 1D convergence at the anchor (XAUUSDT 08-04 scenario)', async () => {
    // 1D candles: 07-29..08-04, a horizontal band whose per-day amplitude narrows
    // toward the present — the gold 1D 08-04 convergence the user wanted scanned.
    const DAY = 24 * 60 * 60 * 1000;
    const dayStart = periodStart - periodStart % DAY; // today's 00:00 UTC
    // back 0 is the still-forming current day (dropped by the service). The 8
    // completed days: prior (back 5..8) amplitude 0.012, middle (back 3..4)
    // 0.008, recent/latest (back 1..2) 0.004 — compression 0.5, latestTrend 0.5.
    const daily = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((back) =>
      makeCandle(dayStart - back * DAY, 100, back >= 5 ? 0.012 : back >= 3 ? 0.008 : 0.004),
    );
    const getCandlesticks = vi.fn(async () => daily);
    const service = new CoinScanService({ listTickers: vi.fn(async () => tickers) }, { getCandlesticks });
    const result = await service.scanShrink({
      method: 'shrink',
      timeframe: '1D',
      topN: 2,
      minQuoteVolume24h: 0,
      boxWindow: 4,
      maxCompression: 0.8,
      maxLatestTrend: 0.9,
      trendWindow: 2,
    });
    expect(result.scanned.length).toBeGreaterThan(0);
    const row = result.scanned[0];
    expect(row.compression).toBeLessThan(0.8);
    expect(row.latestTrend).toBeLessThan(0.9);
    expect(row.qualified).toBe(true);
  });
});
