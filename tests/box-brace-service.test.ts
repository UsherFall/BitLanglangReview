import { describe, expect, it } from 'vitest';

import type { Candlestick } from '../src/domain/candlestick';
import { CoinScanService, type BoxBraceScanParams } from '../src/server/coin-scan-service';
import type { CandleRequest, Ticker } from '../src/server/market-data';

type HL = readonly [number, number];

const DAY = 86_400_000;
/** Anchor is a fixed instant so every expectation is deterministic. */
const ANCHOR = Date.UTC(2026, 9, 15);

function candles(bars: ReadonlyArray<HL>, instrument: string): Candlestick[] {
  return bars.map(([low, high], index) => ({
    instrument,
    timeframe: '1D' as const,
    timestamp: ANCHOR - (bars.length - index) * DAY,
    open: (low + high) / 2,
    high,
    low,
    close: (low + high) / 2,
    volume: 100,
  }));
}

/** A move (100 鈫?300 over 10 bars) then a flat box under the move's high. */
function boxSeries(instrument: string): Candlestick[] {
  const bars: HL[] = Array.from({ length: 10 }, (_, i) => {
    const mid = 100 + 21 * (i + 1);
    return [mid - 1, mid + 1] as HL;
  });
  for (let i = 0; i < 12; i += 1) bars.push([296, 302]);
  return candles(bars, instrument);
}

/** A steadily rising series: no box at all. */
function trendSeries(instrument: string): Candlestick[] {
  return candles(
    Array.from({ length: 40 }, (_, i) => {
      const mid = 100 + 3 * i;
      return [mid - 0.5, mid + 0.5] as HL;
    }),
    instrument,
  );
}

function ticker(instrument: string, overrides: Partial<Ticker> = {}): Ticker {
  return {
    instrument,
    lastPrice: 300,
    change24h: 1.5,
    quoteVolume24h: 50_000_000,
    marketClass: 'CRYPTO',
    ...overrides,
  } as Ticker;
}

function serviceWith(fixtures: Record<string, Candlestick[]>, requested: CandleRequest[] = []) {
  const tickerSource = { listTickers: async () => Object.keys(fixtures).map((name) => ticker(name)) };
  const candleSource = {
    getCandlesticks: async (request: CandleRequest) => {
      requested.push(request);
      return fixtures[request.instrument] ?? [];
    },
  };
  return { service: new CoinScanService(tickerSource as never, candleSource as never), requested };
}

describe('CoinScanService.scanBoxBrace', () => {
  it('returns the box under a move and drops the instrument with no box', async () => {
    const { service, requested } = serviceWith({ BOXUSDT: boxSeries('BOXUSDT'), TRENDUSDT: trendSeries('TRENDUSDT') });
    const result = await service.scanBoxBrace({ minQuoteVolume24h: 1_000_000, anchor: ANCHOR });
    expect(result.rows.map((row) => row.instrument)).toEqual(['BOXUSDT']);
    const row = result.rows[0]!;
    expect(row.box.squeeze).toBeLessThan(0.2);
    expect(row.box.bars).toBeGreaterThanOrEqual(5);
    // One daily read per instrument, paged (the window needs the move lookbacks).
    expect(requested).toHaveLength(2);
    expect(requested.every((request) => request.timeframe === '1D' && request.allowPaging === true)).toBe(true);
    expect(result.scanned).toBe(2);
  });

  it('orders the rows by squeeze, tightest first', async () => {
    const wide = boxSeries('WIDEUSDT');
    // Widen the whole box of the second fixture so its squeeze is worse.
    const wider = boxSeries('WIDERUSDT').map((candle) => ({ ...candle, low: candle.low - 1, high: candle.high + 1 }));
    const { service } = serviceWith({ WIDEUSDT: wide, WIDERUSDT: wider });
    const result = await service.scanBoxBrace({ minQuoteVolume24h: 1_000_000, anchor: ANCHOR });
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]!.box.squeeze).toBeLessThanOrEqual(result.rows[1]!.box.squeeze);
  });

  it('never sees the still-forming bar: a box that only fails on the open bar still qualifies', async () => {
    const series = boxSeries('BARSUSDT');
    // Append a bar at the anchor instant: it is still forming and must be ignored.
    series.push({ ...series[series.length - 1], timestamp: ANCHOR, high: 400, close: 400 });
    const { service } = serviceWith({ BARSUSDT: series });
    const result = await service.scanBoxBrace({ minQuoteVolume24h: 1_000_000, anchor: ANCHOR });
    expect(result.rows).toHaveLength(1);
  });

  it('drops instruments below the volume floor, and does not fail on a closed market', async () => {
    const tickers = [
      ticker('BOXUSDT'),
      ticker('THINUSDT', { quoteVolume24h: 10 }),
      ticker('CLOSEDUSDT', { marketClass: 'US_EQUITY' }),
    ];
    const candleSource = { getCandlesticks: async () => boxSeries('ANY') };
    const svc = new CoinScanService({ listTickers: async () => tickers } as never, candleSource as never);
    const result = await svc.scanBoxBrace({ minQuoteVolume24h: 1_000_000, anchor: ANCHOR });
    // The closed equity is either skipped (reported) or judged on its session
    // candles — never a crash, and never a row for the thin instrument.
    expect(result.rows.map((row) => row.instrument)).toContain('BOXUSDT');
    expect(result.rows.map((row) => row.instrument)).not.toContain('THINUSDT');
  });

  it('isolates a failed fetch to its own instrument instead of failing the scan', async () => {
    const tickers = [ticker('OKUSDT'), ticker('BADUSDT')];
    const candleSource = {
      getCandlesticks: async (request: CandleRequest) => {
        if (request.instrument === 'BADUSDT') throw new Error('timeout');
        return boxSeries('OKUSDT');
      },
    };
    const svc = new CoinScanService({ listTickers: async () => tickers } as never, candleSource as never);
    const result = await svc.scanBoxBrace({ minQuoteVolume24h: 1_000_000, anchor: ANCHOR });
    expect(result.rows.map((row) => row.instrument)).toEqual(['OKUSDT']);
    expect(result.failedInstruments).toEqual(['BADUSDT']);
  });

  it('honours the box-shape params (a tiny ceiling rejects everything)', async () => {
    const { service } = serviceWith({ BOXUSDT: boxSeries('BOXUSDT') });
    const params: BoxBraceScanParams = { minQuoteVolume24h: 1_000_000, anchor: ANCHOR, maxHeightRatio: 0.01 };
    const result = await service.scanBoxBrace(params);
    expect(result.rows).toHaveLength(0);
  });
});

