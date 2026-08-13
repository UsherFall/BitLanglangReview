import { describe, expect, it, vi } from 'vitest';
import { BinanceCandleSource } from '../src/server/binance-candles';
import { CandlestickStore } from '../src/server/candlestick-store';

// Binance kline row:
// [openTime, open, high, low, close, volume, closeTime, quoteVol, trades, takerBuyBase, takerBuyQuote, ignore]
function kline(openTime: number, close: string, volume: string): string[] {
  return [
    String(openTime), '1', '2', '0.5', close, volume, String(openTime + 5 * 60_000), '100', '10', '5', '5', '0',
  ];
}

const STEP = 5 * 60_000;
const ANCHOR = 1653381600000; // 2022-05-24T10:40:00.000Z, a 5m boundary.

describe('BinanceCandleSource', () => {
  it('maps kline fields, requests earlier via endTime, and reuses the cache', async () => {
    const store = new CandlestickStore(':memory:');
    const fetchJson = vi.fn(async (_url: string) => [
      kline(1653381000000, '29350', '12'), // 10:30
      kline(1653381300000, '29480', '20'), // 10:35
    ]);
    const source = new BinanceCandleSource(store, fetchJson);

    const first = await source.getCandlesticks({ instrument: 'XAUUSDT', timeframe: '5m', anchor: ANCHOR, direction: 'earlier', limit: 2 });
    const second = await source.getCandlesticks({ instrument: 'XAUUSDT', timeframe: '5m', anchor: ANCHOR, direction: 'earlier', limit: 2 });

    expect(first).toEqual(second);
    expect(first.map((candle) => candle.timestamp)).toEqual([1653381000000, 1653381300000]);
    expect(first.map((candle) => candle.close)).toEqual([29350, 29480]);
    expect(first.map((candle) => candle.volume)).toEqual([12, 20]);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    const url = fetchJson.mock.calls[0][0] as string;
    expect(url).toContain('https://fapi.binance.com/fapi/v1/klines');
    expect(url).toContain('symbol=XAUUSDT');
    expect(url).toContain('interval=5m');
    expect(url).toContain('endTime=');
  });

  it('refreshes a stale cache when scanning "now" but reuses a fresh one', async () => {
    const store = new CandlestickStore(':memory:');
    const step = STEP;
    const nowBoundary = Math.floor(Date.now() / step) * step;
    // Seed the store with OLD bars whose newest is 3 steps behind the current
    // 5m boundary — a "now" scan must NOT reuse them.
    store.save([
      { instrument: 'XAUUSDT', timeframe: '5m' as const, timestamp: nowBoundary - 4 * step, open: 1, high: 2, low: 0.5, close: 1, volume: 10 },
      { instrument: 'XAUUSDT', timeframe: '5m' as const, timestamp: nowBoundary - 3 * step, open: 1, high: 2, low: 0.5, close: 1, volume: 10 },
    ]);
    const fetchJson = vi.fn(async () => [
      kline(nowBoundary - step, '29480', '20'),
      kline(nowBoundary - 2 * step, '29350', '12'),
    ]);
    const source = new BinanceCandleSource(store, fetchJson);

    await source.getCandlesticks({ instrument: 'XAUUSDT', timeframe: '5m', anchor: nowBoundary, direction: 'earlier', limit: 2 });
    // The cache was stale (newest bar 3 steps old) → a fresh fetch happened.
    expect(fetchJson).toHaveBeenCalledTimes(1);

    // The refetch saved current bars; a second "now" scan reuses them.
    await source.getCandlesticks({ instrument: 'XAUUSDT', timeframe: '5m', anchor: nowBoundary, direction: 'earlier', limit: 2 });
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it('drops the still-forming bar (openTime + step > anchor)', async () => {
    const store = new CandlestickStore(':memory:');
    const fetchJson = vi.fn(async (_url: string) => [
      kline(1653381000000, '29350', '12'), // 10:30 completed
      kline(1653381300000, '29480', '20'), // 10:35 still forming when anchor = 10:35
    ]);
    const source = new BinanceCandleSource(store, fetchJson);

    const candles = await source.getCandlesticks({ instrument: 'XAUUSDT', timeframe: '5m', anchor: 1653381300000, direction: 'earlier', limit: 2 });

    expect(candles.map((candle) => candle.timestamp)).toEqual([1653381000000]);
  });

  it('maps 1D later anchors to UTC 0:00 boundaries without the OKX -8h offset', async () => {
    const store = new CandlestickStore(':memory:');
    const fetchJson = vi.fn(async (_url: string) => [
      ['1716249600000', '4000', '4100', '3990', '4080', '100', '1716336000000', '400000', '1000', '500', '500', '0'],
    ]);
    const source = new BinanceCandleSource(store, fetchJson);

    const later = await source.getCandlesticks({
      instrument: 'XAUUSDT',
      timeframe: '1D',
      // 2024-05-21T01:17:00+08:00 is inside the 2024-05-20 UTC daily candle; the
      // next boundary is 2024-05-21T00:00:00Z = 1716249600000 (UTC 0:00, no offset).
      anchor: Date.parse('2024-05-21T01:17:00+08:00') - 1,
      direction: 'later',
      limit: 2,
    });

    expect(later.map((candle) => candle.timestamp)).toEqual([1716249600000]);
    expect(later.map((candle) => candle.instrument)).toEqual(['XAUUSDT']);
    const url = fetchJson.mock.calls[0][0] as string;
    expect(url).toContain('startTime=1716249600000');
    expect(url).toContain('interval=1d');
  });

  it('breaks contiguity when the first candle after the anchor is missing', async () => {
    const store = new CandlestickStore(':memory:');
    const fetchJson = vi.fn(async (_url: string) => [
      // The candle immediately after the 4H boundary (2024-05-20T16:00:00Z) is
      // missing; the returned candle is two steps later, so it is not contiguous.
      ['1716249600000', '3662.67', '3723.6', '3640.06', '3695.96', '10', '1716264000000', '1000', '100', '50', '50', '0'],
    ]);
    const source = new BinanceCandleSource(store, fetchJson);

    const later = await source.getCandlesticks({
      instrument: 'XAUUSDT',
      timeframe: '4H',
      anchor: Date.parse('2024-05-21T01:17:00+08:00'),
      direction: 'later',
      limit: 2,
    });

    expect(later).toEqual([]);
  });
});
