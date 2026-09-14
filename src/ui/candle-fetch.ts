import type { Candlestick } from '../domain/candlestick';

/**
 * The server said why it failed (non-2xx response with an `error` body). Callers
 * surface this message verbatim instead of a generic load-failure text, so a
 * Binance 418 ban reaches the chart status line.
 */
export class ServerCandleError extends Error {}

/**
 * Loads candlesticks from `/api/candles`. Only a server-reported failure becomes
 * a `ServerCandleError`; a network-level rejection (fetch itself failing) is
 * rethrown untouched so callers keep their existing generic wording.
 */
export async function fetchCandles(params: URLSearchParams): Promise<Candlestick[]> {
  const response = await fetch(`/api/candles?${params}`);
  const body = (await response.json()) as { candles?: Candlestick[]; error?: string };
  if (!response.ok) throw new ServerCandleError(body.error ?? `HTTP ${response.status}`);
  return body.candles ?? [];
}
