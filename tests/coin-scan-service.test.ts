import { describe, expect, it, vi } from 'vitest';
import type { Candlestick } from '../src/domain/candlestick';
import type { ShrinkScanParams } from '../src/domain/coin-scan';
import { CoinScanService } from '../src/server/coin-scan-service';

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

const tickerPayload = {
  data: [
    { instId: 'ETH-USDT-SWAP', last: '3500', open24h: '3400', volCcy24h: '90000000' },
    { instId: 'BTC-USDT-SWAP', last: '60000', open24h: '62000', volCcy24h: '150000000' },
    { instId: 'BTC-USD-SWAP', last: '60000', open24h: '62000', volCcy24h: '99999999' },
    { instId: 'SOL-USDT-SWAP', last: '150', open24h: '140', volCcy24h: '50000000' },
  ],
};

const params: ShrinkScanParams = {
  method: 'shrink',
  timeframe: '5m',
  topN: 2,
  ratioThreshold: 0.7,
  consecutive: 2,
  window: 2,
};

// Five candles where the newest (forming) one has a huge volume. When it is
// dropped before computing, the last two completed ratios stay below 0.7 and
// the coin qualifies; when it is kept, the streak breaks.
const fiveCandles = [
  makeCandle(1000, 100),
  makeCandle(2000, 100),
  makeCandle(3000, 20), // ratio 0.2
  makeCandle(4000, 15), // ratio 0.25
  makeCandle(5000, 500), // forming bar, must be dropped
];

describe('CoinScanService', () => {
  it('scans top-N USDT swap instruments ranked by intensity and drops the forming bar', async () => {
    const getCandlesticks = vi.fn(async () => fiveCandles);
    const service = new CoinScanService({ getCandlesticks }, vi.fn(async () => tickerPayload));

    const result = await service.scanShrink(params);

    expect(result.scanned.map((row) => row.instrument).sort()).toEqual(['BTC-USDT-SWAP', 'ETH-USDT-SWAP']);
    expect(getCandlesticks).toHaveBeenCalledWith({
      instrument: 'BTC-USDT-SWAP',
      timeframe: '5m',
      direction: 'earlier',
      limit: 5, // window + consecutive + 1 forming bar
      anchor: expect.any(Number),
    });
    for (const row of result.scanned) {
      expect(row.qualified).toBe(true);
      expect(row.intensity).toBeCloseTo((0.2 + 0.25) / 2);
      expect(row.lastCandleTime).toBe(4000); // newest completed bar, forming 5000 dropped
    }
    expect(result.qualifiedCount).toBe(2);
    // BTC-USDT-SWAP first in the fetch order (150M quote volume), ETH second.
    expect(result.scanned[0].instrument).toBe('BTC-USDT-SWAP');
  });

  it('computes the 24h change percentage from last and open24h', async () => {
    const service = new CoinScanService({ getCandlesticks: vi.fn(async () => fiveCandles) }, vi.fn(async () => tickerPayload));
    const result = await service.scanShrink(params);
    const btc = result.scanned.find((row) => row.instrument === 'BTC-USDT-SWAP');
    expect(btc?.lastPrice).toBe(60000);
    expect(btc?.change24h).toBeCloseTo(((60000 - 62000) / 62000) * 100);
    const eth = result.scanned.find((row) => row.instrument === 'ETH-USDT-SWAP');
    expect(eth?.change24h).toBeCloseTo(((3500 - 3400) / 3400) * 100);
  });

  it('skips instruments without enough candle history', async () => {
    const getCandlesticks = vi.fn(async () => [makeCandle(1000, 100), makeCandle(2000, 100)]);
    const service = new CoinScanService({ getCandlesticks }, vi.fn(async () => tickerPayload));
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
          makeCandle(1000, 100),
          makeCandle(2000, 100),
          makeCandle(3000, 10), // ratio 0.1
          makeCandle(4000, 5), // ratio 0.05
          makeCandle(5000, 500), // forming
        ],
      ); // ETH: intensity 0.075
    const service = new CoinScanService({ getCandlesticks }, vi.fn(async () => tickerPayload));
    const result = await service.scanShrink(params);
    expect(result.scanned.map((row) => row.instrument)).toEqual(['ETH-USDT-SWAP', 'BTC-USDT-SWAP']);
  });
});
