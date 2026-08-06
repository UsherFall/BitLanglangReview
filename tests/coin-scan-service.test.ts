import { describe, expect, it, vi } from 'vitest';
import type { Candlestick } from '../src/domain/candlestick';
import type { ShrinkScanParams } from '../src/domain/coin-scan';
import { scanTimeframes } from '../src/domain/coin-scan';
import type { ReviewTimeframe } from '../src/domain/trade';
import { timeframeMs } from '../src/server/candlestick-service';
import { CoinScanService } from '../src/server/coin-scan-service';
import type { CandleSource, Ticker } from '../src/server/market-data';

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

const now = Date.now();

/**
 * 12 completed bars aligned to `timeframe` (step-sized apart, oldest first) plus
 * one still-forming bar at the current period start. The service drops the
 * forming bar by time (timestamp + timeframeMs(timeframe) > anchor), so exactly
 * 12 completed bars feed computePlateau (the largest plateau window bw=6 needs
 * 2 * 6 = 12).
 */
function timeframeCandles(timeframe: ReviewTimeframe, amplitudes: number[]): Candlestick[] {
  const step = timeframeMs(timeframe);
  const periodStart = now - (now % step);
  const bars = amplitudes.map((amplitude, index) =>
    makeCandle(periodStart - (amplitudes.length - index) * step, 100, amplitude),
  );
  bars.push(makeCandle(periodStart, 100)); // still-forming bar, dropped by the service
  return bars;
}

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
  topN: 2,
  minQuoteVolume24h: 0,
  maxCompression: 0.8,
  maxLatestTrend: 0.9,
  trendWindow: 2,
  plateauMin: 2,
};

// A 12-bar step-narrowing tail: bars 0..5 wide (0.02), 6..8 medium (0.01),
// 9..11 narrow (0.003). Every plateau box window 3..6 compresses, so the coin
// qualifies on any timeframe fed this data.
const qualifyingAmplitudes = [0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.01, 0.01, 0.01, 0.003, 0.003, 0.003];
// A uniformly quiet tail: compression ≈ 1.0, latestTrend ≈ 1.0 → no box window
// qualifies (the "long-term quiet, no tension" coin the gate rejects).
const quietAmplitudes = Array.from({ length: 12 }, () => 0.02);
// A deeper convergence: compression ≈ 0.1-0.2 on every window, so its bestScore
// is much lower than qualifyingAmplitudes' — used to test score-ascending sort.
const deepAmplitudes = [0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.005, 0.005, 0.005, 0.001, 0.001, 0.001];

function scanServiceWith(getCandlesticks: CandleSource['getCandlesticks']) {
  return new CoinScanService({ listTickers: vi.fn(async () => tickers) }, { getCandlesticks });
}

describe('CoinScanService (multi-timeframe)', () => {
  it('scans top-N USDT swap instruments across all 5 timeframes and drops the forming bar', async () => {
    const getCandlesticks = vi.fn(async ({ timeframe }: { timeframe: ReviewTimeframe }) =>
      timeframeCandles(timeframe, qualifyingAmplitudes),
    );
    const service = scanServiceWith(getCandlesticks);

    const result = await service.scanShrink(params);

    // Both top-2 coins converge on every timeframe → both appear.
    expect(result.scanned.map((row) => row.instrument).sort()).toEqual(['BTC-USDT-SWAP', 'ETH-USDT-SWAP']);
    // Each (coin, timeframe) fetch pulls 2 * max(PLATEAU_BOX_WINDOWS) + 1 = 13
    // bars and drops the forming bar by time (the anchor is resolved to now).
    expect(getCandlesticks).toHaveBeenCalledWith(expect.objectContaining({ limit: 13, direction: 'earlier', anchor: expect.any(Number) }));
    expect(getCandlesticks).toHaveBeenCalledWith(expect.objectContaining({ instrument: 'BTC-USDT-SWAP', timeframe: '5m' }));
    expect(getCandlesticks).toHaveBeenCalledWith(expect.objectContaining({ instrument: 'BTC-USDT-SWAP', timeframe: '1D' }));
    expect(getCandlesticks).toHaveBeenCalledWith(expect.objectContaining({ instrument: 'ETH-USDT-SWAP', timeframe: '4H' }));
    for (const row of result.scanned) {
      expect(row.timeframes).toHaveLength(scanTimeframes.length);
      expect(row.convergenceTimeframes).toEqual(['5m', '15m', '1H', '4H', '1D']);
      expect(row.qualifiedCount).toBe(5);
      expect(row.qualified).toBe(true);
      for (const timeframe of row.timeframes) expect(timeframe.qualified).toBe(true);
    }
    expect(result.qualifiedCount).toBe(2);
    // Equal counts and equal bestScore keep the ticker (quote-volume) order.
    expect(result.scanned[0].instrument).toBe('BTC-USDT-SWAP');
    // The response echoes the effective scan parameters, including the resolved
    // anchor (Date.now() when the client omitted it).
    expect(result.params.maxCompression).toBe(0.8);
    expect(result.params.maxLatestTrend).toBe(0.9);
    expect(result.params.trendWindow).toBe(2);
    expect(result.params.plateauMin).toBe(2);
    expect(result.params.anchor).toBeTypeOf('number');
  });

  it('keeps the newest completed bar when the source has no forming bar', async () => {
    const getCandlesticks = vi.fn(async ({ timeframe }: { timeframe: ReviewTimeframe }) =>
      timeframeCandles(timeframe, qualifyingAmplitudes).slice(0, -1),
    );
    const service = scanServiceWith(getCandlesticks);
    const result = await service.scanShrink(params);
    // The 12 completed bars (no forming bar in the cache) still feed the plateau.
    expect(result.scanned.length).toBe(2);
    for (const row of result.scanned) expect(row.qualified).toBe(true);
  });

  it('carries the 24h change percentage from the ticker source onto each row', async () => {
    const getCandlesticks = vi.fn(async ({ timeframe }: { timeframe: ReviewTimeframe }) =>
      timeframeCandles(timeframe, qualifyingAmplitudes),
    );
    const service = scanServiceWith(getCandlesticks);
    const result = await service.scanShrink(params);
    const btc = result.scanned.find((row) => row.instrument === 'BTC-USDT-SWAP');
    expect(btc?.lastPrice).toBe(60000);
    expect(btc?.change24h).toBeCloseTo(((60000 - 62000) / 62000) * 100);
    const eth = result.scanned.find((row) => row.instrument === 'ETH-USDT-SWAP');
    expect(eth?.change24h).toBeCloseTo(((3500 - 3400) / 3400) * 100);
  });

  it('skips coins without enough candle history on every timeframe', async () => {
    const getCandlesticks = vi.fn(async ({ timeframe }: { timeframe: ReviewTimeframe }) =>
      timeframeCandles(timeframe, qualifyingAmplitudes).slice(0, 2),
    );
    const service = scanServiceWith(getCandlesticks);
    const result = await service.scanShrink(params);
    expect(result.scanned).toEqual([]);
    expect(result.qualifiedCount).toBe(0);
  });

  it('sorts by qualifiedCount desc, then bestScore asc, and hides non-converged coins', async () => {
    const getCandlesticks = vi.fn(async ({ instrument, timeframe }: { instrument: string; timeframe: ReviewTimeframe }) => {
      if (instrument === 'BTC-USDT-SWAP') {
        return timeframeCandles(timeframe, timeframe === '5m' ? qualifyingAmplitudes : quietAmplitudes);
      }
      if (instrument === 'ETH-USDT-SWAP') {
        return timeframeCandles(timeframe, timeframe === '4H' ? deepAmplitudes : quietAmplitudes);
      }
      return timeframeCandles(timeframe, quietAmplitudes); // SOL converges nowhere
    });
    const service = scanServiceWith(getCandlesticks);
    const result = await service.scanShrink(params);

    // BTC: only 5m converges (bestScore ≈ 0.76); ETH: only 4H converges, deeper
    // (bestScore ≈ 0.42). Equal counts → ETH (lower bestScore) sorts first; SOL
    // converges nowhere and never appears.
    expect(result.scanned.map((row) => row.instrument)).toEqual(['ETH-USDT-SWAP', 'BTC-USDT-SWAP']);
    const eth = result.scanned[0];
    expect(eth.convergenceTimeframes).toEqual(['4H']);
    expect(eth.qualifiedCount).toBe(1);
    const btc = result.scanned[1];
    expect(btc.convergenceTimeframes).toEqual(['5m']);
    expect(btc.bestScore).toBeGreaterThan(eth.bestScore);
  });

  it('filters out instruments below the minimum 24h quote volume before picking top-N', async () => {
    const getCandlesticks = vi.fn(async ({ timeframe }: { timeframe: ReviewTimeframe }) =>
      timeframeCandles(timeframe, qualifyingAmplitudes),
    );
    const service = scanServiceWith(getCandlesticks);
    // BTC quote-volume = 150M * 60000 = 9e12; ETH = 90M * 3500 = 3.15e11.
    const result = await service.scanShrink({ ...params, minQuoteVolume24h: 5e11 });
    expect(result.scanned.map((row) => row.instrument)).toEqual(['BTC-USDT-SWAP']);
  });

  it('applies a past anchor to every timeframe and echoes it in params', async () => {
    const getCandlesticks = vi.fn(async ({ timeframe }: { timeframe: ReviewTimeframe }) =>
      timeframeCandles(timeframe, qualifyingAmplitudes),
    );
    const service = scanServiceWith(getCandlesticks);
    const pastAnchor = Date.parse('2026-08-04T00:00:00Z');
    const result = await service.scanShrink({ ...params, anchor: pastAnchor });
    for (const timeframe of scanTimeframes) {
      expect(getCandlesticks).toHaveBeenCalledWith(expect.objectContaining({ anchor: pastAnchor, timeframe }));
    }
    expect(result.params.anchor).toBe(pastAnchor);
  });

  it('qualifies a gold-style 1D convergence at the anchor (XAUUSDT 08-04 scenario)', async () => {
    // 1D candles: a horizontal band whose per-day amplitude narrows toward the
    // anchor — the gold 1D 08-04 convergence the user wanted scanned.
    const DAY = 24 * 60 * 60 * 1000;
    const dayStart = now - (now % DAY);
    const daily = qualifyingAmplitudes.map((amplitude, index) =>
      makeCandle(dayStart - (qualifyingAmplitudes.length - index) * DAY, 100, amplitude),
    );
    daily.push(makeCandle(dayStart, 100)); // still-forming current day
    const getCandlesticks = vi.fn(async () => daily);
    const service = scanServiceWith(getCandlesticks);
    // Anchor just after the newest completed day closed, so exactly the 12
    // completed days feed the plateau and the forming day is dropped.
    const anchor = dayStart - DAY + 1000;
    const result = await service.scanShrink({ ...params, anchor });
    expect(result.scanned.length).toBeGreaterThan(0);
    const row = result.scanned[0];
    expect(row.convergenceTimeframes).toContain('1D');
    expect(row.timeframes.find((timeframe) => timeframe.timeframe === '1D')?.qualified).toBe(true);
  });
});
