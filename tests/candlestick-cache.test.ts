import { describe, expect, it, vi } from 'vitest';
import { CandlestickService } from '../src/server/candlestick-service';
import { CandlestickStore } from '../src/server/candlestick-store';

describe('Candlestick Cache', () => {
  it('fetches missing OKX candlesticks, stores them, and uses the cache on the next request', async () => {
    const store = new CandlestickStore(':memory:');
    const fetchJson = vi.fn(async (_url: string) => ({
      data: [
        ['1653381000000', '29300', '29400', '29200', '29350', '12'],
        ['1653381300000', '29350', '29500', '29300', '29480', '20'],
      ],
    }));
    const service = new CandlestickService(store, fetchJson);

    const first = await service.getCandlesticks({
      instrument: 'BTC-USDT-SWAP',
      timeframe: '5m',
      anchor: 1653381600000,
      direction: 'earlier',
      limit: 2,
    });
    const second = await service.getCandlesticks({
      instrument: 'BTC-USDT-SWAP',
      timeframe: '5m',
      anchor: 1653381600000,
      direction: 'earlier',
      limit: 2,
    });

    expect(first).toEqual(second);
    expect(first.map((candle) => candle.close)).toEqual([29350, 29480]);
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it('loads earlier and later candlesticks around the current loaded range on demand', async () => {
    const store = new CandlestickStore(':memory:');
    const fetchJson = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          ['1653381000000', '1', '2', '0.5', '1.5', '10'],
          ['1653380700000', '1', '2', '0.5', '1.4', '10'],
        ],
      })
      .mockResolvedValueOnce({
        data: [
          ['1653381600000', '2', '3', '1.5', '2.5', '10'],
          ['1653381300000', '2', '3', '1.5', '2.4', '10'],
        ],
      });
    const service = new CandlestickService(store, fetchJson);

    const earlier = await service.getCandlesticks({ instrument: 'BTC-USDT-SWAP', timeframe: '5m', anchor: 1653381300000, direction: 'earlier', limit: 2 });
    const later = await service.getCandlesticks({ instrument: 'BTC-USDT-SWAP', timeframe: '5m', anchor: 1653381000000, direction: 'later', limit: 2 });

    expect(earlier.map((candle) => candle.timestamp)).toEqual([1653380700000, 1653381000000]);
    expect(later.map((candle) => candle.timestamp)).toEqual([1653381300000, 1653381600000]);
    expect(fetchJson.mock.calls[0][0]).toContain('after=1653381300000');
    expect(fetchJson.mock.calls[1][0]).toContain('after=1653381900000');
  });

  it('uses the containing candlestick boundary when fetching later candlesticks after an intra-candle anchor', async () => {
    const store = new CandlestickStore(':memory:');
    const fetchJson = vi.fn(async (_url: string) => ({
      data: [
        ['1716235200000', '3439.08', '3675.99', '3380', '3662.67', '10'],
      ],
    }));
    const service = new CandlestickService(store, fetchJson);

    const later = await service.getCandlesticks({
      instrument: 'ETH-USDT-SWAP',
      timeframe: '4H',
      anchor: Date.parse('2024-05-21T01:17:00+08:00') - 1,
      direction: 'later',
      limit: 150,
    });

    expect(later.map((candle) => candle.timestamp)).toEqual([Date.parse('2024-05-21T04:00:00+08:00')]);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    const calls = fetchJson.mock.calls as string[][];
    expect(calls[0]?.[0]).toContain(`after=${Date.parse('2024-05-21T00:00:00+08:00') + 4 * 60 * 60_000 * 151}`);
  });

  it('loads daily candlesticks after an entry that occurs inside the UTC daily candle', async () => {
    const store = new CandlestickStore(':memory:');
    const fetchJson = vi.fn(async (_url: string) => ({
      data: [
        ['1716307200000', '3778.06', '3845', '3678.76', '3713.92', '10'],
      ],
    }));
    const service = new CandlestickService(store, fetchJson);

    const later = await service.getCandlesticks({
      instrument: 'ETH-USDT-SWAP',
      timeframe: '1D',
      anchor: Date.parse('2024-05-21T01:17:00+08:00') - 1,
      direction: 'later',
      limit: 150,
    });

    expect(later.map((candle) => candle.timestamp)).toEqual([Date.parse('2024-05-22T00:00:00+08:00')]);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    const calls = fetchJson.mock.calls as string[][];
    expect(calls[0]?.[0]).toContain(`after=${Date.parse('2024-05-21T00:00:00+08:00') + 24 * 60 * 60_000 * 151}`);
  });

  it('does not treat later candlesticks as contiguous when the first candle after the anchor is missing', async () => {
    const store = new CandlestickStore(':memory:');
    const fetchJson = vi.fn(async () => ({
      data: [
        ['1716249600000', '3662.67', '3723.6', '3640.06', '3695.96', '10'],
      ],
    }));
    const service = new CandlestickService(store, fetchJson);

    const later = await service.getCandlesticks({
      instrument: 'ETH-USDT-SWAP',
      timeframe: '4H',
      anchor: Date.parse('2024-05-21T01:17:00+08:00'),
      direction: 'later',
      limit: 2,
    });

    expect(later).toEqual([]);
  });
});
