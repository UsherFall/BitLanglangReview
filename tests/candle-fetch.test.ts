import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Candlestick } from '../src/domain/candlestick';
import { fetchCandles, ServerCandleError } from '../src/ui/candle-fetch';

const params = new URLSearchParams({
  instrument: 'BTC-USDT-SWAP',
  timeframe: '5m',
  entryTime: '2024-05-21T10:00:00+08:00',
  mode: 'initial',
});

function candle(timestamp: number): Candlestick {
  return { instrument: 'BTC-USDT-SWAP', timeframe: '5m', timestamp, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

async function captureError(): Promise<unknown> {
  return fetchCandles(params).then(
    () => null,
    (error: unknown) => error,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchCandles', () => {
  it('requests /api/candles with the given params', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ candles: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchCandles(params);

    expect(fetchMock).toHaveBeenCalledWith('/api/candles?' + params.toString());
  });

  it('returns the candles of a 2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ candles: [candle(1)] })));

    await expect(fetchCandles(params)).resolves.toEqual([candle(1)]);
  });

  it('returns [] when a 2xx response carries no candles', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})));

    await expect(fetchCandles(params)).resolves.toEqual([]);
  });

  it('throws ServerCandleError with the server message on a non-2xx response with error', async () => {
    const message = 'Binance request failed: HTTP 418 (Binance IP auto-banned; retry after ~1659s)';
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: message }, 502)));

    const error = await captureError();

    expect(error).toBeInstanceOf(ServerCandleError);
    expect((error as Error).message).toBe(message);
  });

  it('falls back to HTTP <status> when a non-2xx response carries no error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 500)));

    const error = await captureError();

    expect(error).toBeInstanceOf(ServerCandleError);
    expect((error as Error).message).toBe('HTTP 500');
  });

  it('lets a network-level failure reject untouched', async () => {
    const networkError = new Error('network down');
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw networkError;
    }));

    const error = await captureError();

    expect(error).toBe(networkError);
    expect(error).not.toBeInstanceOf(ServerCandleError);
  });
});
