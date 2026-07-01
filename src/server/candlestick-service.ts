import type { Candlestick } from '../domain/candlestick';
import type { ReviewTimeframe } from '../domain/trade';
import type { CandlestickStore } from './candlestick-store';

type FetchJson = (url: string) => Promise<unknown>;

type Request = {
  instrument: string;
  timeframe: ReviewTimeframe;
  anchor: number;
  direction: 'earlier' | 'later';
  limit: number;
};

type OkxResponse = {
  data?: string[][];
};

export class CandlestickService {
  constructor(
    private readonly store: CandlestickStore,
    private readonly fetchJson: FetchJson = defaultFetchJson,
  ) {}

  async getCandlesticks(request: Request): Promise<Candlestick[]> {
    const cached = this.listCached(request);
    if (cached.length >= request.limit) {
      return cached;
    }

    const url = new URL('https://www.okx.com/api/v5/market/history-candles');
    url.searchParams.set('instId', request.instrument);
    url.searchParams.set('bar', request.timeframe);
    const okxAnchor = request.direction === 'earlier'
      ? request.anchor
      : boundaryAnchor(request.anchor, request.timeframe, 'later') + timeframeMs(request.timeframe) * (request.limit + 1);
    url.searchParams.set('after', String(okxAnchor));
    url.searchParams.set('limit', String(request.limit));

    const response = (await this.fetchJson(url.toString())) as OkxResponse;
    const candles = (response.data ?? [])
      .map((row) => toCandlestick(request.instrument, request.timeframe, row))
      .filter((candle) => (request.direction === 'earlier' ? candle.timestamp < request.anchor : candle.timestamp > request.anchor))
      .sort((a, b) => a.timestamp - b.timestamp);
    this.store.save(candles);
    return this.listCached(request);
  }

  private listCached(request: Request): Candlestick[] {
    const cached = request.direction === 'earlier'
      ? this.store.listBefore({ instrument: request.instrument, timeframe: request.timeframe, before: request.anchor, limit: request.limit })
      : this.store.listAfter({ instrument: request.instrument, timeframe: request.timeframe, after: request.anchor, limit: request.limit });
    return contiguousCandles(cached, request.anchor, request.timeframe, request.direction);
  }
}

function contiguousCandles(candles: Candlestick[], anchor: number, timeframe: ReviewTimeframe, direction: Request['direction']): Candlestick[] {
  if (!candles.length) return [];
  const step = timeframeMs(timeframe);
  const maxGap = step * 1.5;
  const ordered = direction === 'earlier' ? [...candles].reverse() : candles;
  const kept: Candlestick[] = [];

  for (const candle of ordered) {
    const previousTimestamp = kept[kept.length - 1]?.timestamp ?? boundaryAnchor(anchor, timeframe, direction);
    if (Math.abs(previousTimestamp - candle.timestamp) > maxGap) break;
    kept.push(candle);
  }

  return direction === 'earlier' ? kept.reverse() : kept;
}

function boundaryAnchor(anchor: number, timeframe: ReviewTimeframe, direction: Request['direction']): number {
  const step = timeframeMs(timeframe);
  const offset = timeframe === '1D' ? -8 * 60 * 60_000 : 0;
  const shifted = anchor - offset;
  const boundary = direction === 'earlier'
    ? Math.ceil(shifted / step) * step
    : Math.floor(shifted / step) * step;
  return boundary + offset;
}

function toCandlestick(instrument: string, timeframe: ReviewTimeframe, row: string[]): Candlestick {
  return {
    instrument,
    timeframe,
    timestamp: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5] ?? 0),
  };
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  const response = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeout));
  if (!response.ok) {
    throw new Error(`OKX request failed: ${response.status}`);
  }
  return response.json();
}

function timeframeMs(timeframe: ReviewTimeframe): number {
  const map: Record<ReviewTimeframe, number> = {
    '5m': 5 * 60_000,
    '15m': 15 * 60_000,
    '1H': 60 * 60_000,
    '4H': 4 * 60 * 60_000,
    '1D': 24 * 60 * 60_000,
    '1W': 7 * 24 * 60 * 60_000,
    '1M': 30 * 24 * 60 * 60_000,
  };
  return map[timeframe];
}
