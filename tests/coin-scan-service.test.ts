import { describe, expect, it, vi } from 'vitest';
import type { Candlestick } from '../src/domain/candlestick';
import type { ShrinkScanParams } from '../src/domain/coin-scan';
import { scanTimeframes } from '../src/domain/coin-scan';
import type { ReviewTimeframe } from '../src/domain/trade';
import { timeframeMs } from '../src/server/candlestick-service';
import { CoinScanService } from '../src/server/coin-scan-service';
import type { CandleRequest, CandleSource, Ticker } from '../src/server/market-data';

// ---------------------------------------------------------------------------
// Synthetic bars for the volatility convergence detector: a strong band (far
// quieter than the preceding stretch), a weak band (only mildly quieter), and a
// trending channel that must NOT classify.
// ---------------------------------------------------------------------------

// Strong convergence: 16 volatile bars (~6.9% per bar) then 16 flat calm bars
// (~1%) → the band is far quieter than the stretch before it (score ≈ 0.9).
const strongBars: ReadonlyArray<readonly [number, number]> = [
  ...Array.from({ length: 16 }, (_, i) => [92 - i * 0.6, 98 - i * 0.6] as const),
  ...Array.from({ length: 16 }, () => [99.5, 100.5] as const),
];

// Weak convergence: same volatile lead, but a band only ~1.7× quieter → detected
// but scored below the default minScore 0.6.
const weakBars: ReadonlyArray<readonly [number, number]> = [
  ...Array.from({ length: 16 }, (_, i) => [92 - i * 0.6, 98 - i * 0.6] as const),
  ...Array.from({ length: 16 }, () => [98, 102] as const),
];

// Trending channel: no volatility shrink anywhere → never a convergence.
const uptrendBars: ReadonlyArray<readonly [number, number]> = Array.from({ length: 40 }, (_, i) => [100 + i * 2, 106 + i * 2] as const);

/**
 * Builds completed candles for `bars` whose newest bar closes exactly at
 * `anchor - timeframeStep` (so the service's by-time completed filter keeps it),
 * optionally appending a still-forming bar at `anchor` that the service must
 * drop. All candles carry `timeframe` so `timeframeMs` sees the right step.
 */
function candlesAt(
  anchor: number,
  timeframe: ReviewTimeframe,
  bars: ReadonlyArray<readonly [number, number]>,
  withForming = false,
): Candlestick[] {
  const step = timeframeMs(timeframe);
  const out = bars.map(([low, high], index) => ({
    instrument: 'TEST',
    timeframe,
    timestamp: anchor - step * (bars.length - index),
    open: (low + high) / 2,
    high,
    low,
    close: (low + high) / 2,
    volume: 100,
  }));
  if (withForming) {
    out.push({ instrument: 'TEST', timeframe, timestamp: anchor, open: 105, high: 105, low: 105, close: 105, volume: 0 });
  }
  return out;
}

/** A shape plan per (coin, timeframe): which synthetic bars to serve. */
type Shape = 'strong' | 'weak' | 'uptrend' | 'none';

const shapeBars: Record<Exclude<Shape, 'none'>, ReadonlyArray<readonly [number, number]>> = {
  strong: strongBars,
  weak: weakBars,
  uptrend: uptrendBars,
};

type Source = {
  listTickers: ReturnType<typeof vi.fn<() => Promise<Ticker[]>>>;
  getCandlesticks: ReturnType<typeof vi.fn<CandleSource['getCandlesticks']>>;
};

function buildSource(
  plan: (instrument: string, timeframe: ReviewTimeframe) => Shape,
  withForming = false,
): Source {
  const listTickers = vi.fn<() => Promise<Ticker[]>>(async () => tickers);
  const getCandlesticks = vi.fn<CandleSource['getCandlesticks']>(
    async ({ instrument, timeframe, anchor }: CandleRequest) => {
      const shape = plan(instrument, timeframe);
      const bars = shape === 'none' ? null : shapeBars[shape];
      if (!bars) return [];
      return candlesAt(anchor, timeframe, bars, withForming);
    },
  );
  return { listTickers, getCandlesticks };
}

/** Wraps the mock source in the TickerSource/CandleSource object shapes. */
function serviceFrom(source: Source): CoinScanService {
  return new CoinScanService({ listTickers: source.listTickers }, { getCandlesticks: source.getCandlesticks });
}

const tickers: Ticker[] = [
  { instrument: 'BTC-USDT-SWAP', quoteVolume24h: 150000000 * 60000, lastPrice: 60000, change24h: ((60000 - 62000) / 62000) * 100 },
  { instrument: 'ETH-USDT-SWAP', quoteVolume24h: 90000000 * 3500, lastPrice: 3500, change24h: ((3500 - 3400) / 3400) * 100 },
  { instrument: 'SOL-USDT-SWAP', quoteVolume24h: 50000000 * 150, lastPrice: 150, change24h: ((150 - 140) / 140) * 100 },
];

const params: ShrinkScanParams = {
  method: 'shrink',
  topN: 2,
  minQuoteVolume24h: 0,
};

const allStrongPlan = () => 'strong' as const;

describe('CoinScanService (volatility convergence, multi-timeframe)', () => {
  it('scans top-N coins across all 5 timeframes and reports every qualified structure', async () => {
    const source = buildSource((instrument, timeframe) => (instrument === 'SOL-USDT-SWAP' ? 'uptrend' : allStrongPlan()));
    const service = serviceFrom(source);
    const result = await service.scanShrink(params);

    // BTC + ETH are the top-2 (SOL falls outside topN) and both converge on all
    // 5 timeframes → both rows appear.
    expect(result.scanned.map((row) => row.instrument).sort()).toEqual(['BTC-USDT-SWAP', 'ETH-USDT-SWAP']);
    for (const row of result.scanned) {
      expect(row.convergedTimeframes).toEqual(scanTimeframes);
      expect(row.qualifiedCount).toBe(5);
      expect(row.qualified).toBe(true);
      for (const timeframe of scanTimeframes) {
        expect(row.structures[timeframe].structure).toBe('convergence');
        expect(row.structures[timeframe].qualified).toBe(true);
        // The strong fixture's band is far quieter than its preceding stretch →
        // calm-dominant score (0.7×calm + 0.3×length) ≈ 0.9.
        expect(row.structures[timeframe].score).toBeGreaterThan(0.85);
      }
    }
    expect(result.qualifiedCount).toBe(2);
    // Equal counts and equal bestScore keep the stable ticker (quote-volume) order.
    expect(result.scanned[0].instrument).toBe('BTC-USDT-SWAP');
    expect(result.params).toEqual({ ...params, scope: 'crypto', anchor: expect.any(Number) });
  });

  it('fetches each (coin, timeframe) with a uniform window for every timeframe', async () => {
    const source = buildSource(allStrongPlan);
    const service = serviceFrom(source);
    await service.scanShrink(params);

    for (const timeframe of scanTimeframes) {
      expect(source.getCandlesticks).toHaveBeenCalledWith(
        expect.objectContaining({ timeframe, limit: 100, direction: 'earlier', anchor: expect.any(Number), refresh: true }),
      );
    }
    expect(source.getCandlesticks).toHaveBeenCalledWith(
      expect.objectContaining({ instrument: 'BTC-USDT-SWAP', timeframe: '5m' }),
    );
  });

  it('drops the still-forming bar by time without dropping the newest completed bar', async () => {
    const anchor = Date.parse('2026-08-04T00:00:00Z');
    // Same data, once with a forming bar appended at `anchor` and once without.
    const withForming = buildSource(allStrongPlan, true);
    const withoutForming = buildSource(allStrongPlan, false);
    const a = serviceFrom(withForming);
    const b = serviceFrom(withoutForming);
    const [resultWith, resultWithout] = await Promise.all([
      a.scanShrink({ ...params, anchor }),
      b.scanShrink({ ...params, anchor }),
    ]);
    // The forming bar must not change the verdict — it is dropped by time, and
    // the newest COMPLETED bar is never sliced away.
    expect(resultWith.scanned.map((row) => row.qualifiedCount)).toEqual([5, 5]);
    expect(resultWithout.scanned.map((row) => row.qualifiedCount)).toEqual([5, 5]);
    for (const row of resultWith.scanned) {
      expect(row.qualified).toBe(true);
    }
  });

  it('carries the 24h change percentage and last price from the ticker onto each row', async () => {
    const source = buildSource(allStrongPlan);
    const service = serviceFrom(source);
    const result = await service.scanShrink(params);
    const btc = result.scanned.find((row) => row.instrument === 'BTC-USDT-SWAP');
    expect(btc?.lastPrice).toBe(60000);
    expect(btc?.change24h).toBeCloseTo(((60000 - 62000) / 62000) * 100);
    const eth = result.scanned.find((row) => row.instrument === 'ETH-USDT-SWAP');
    expect(eth?.lastPrice).toBe(3500);
    expect(eth?.change24h).toBeCloseTo(((3500 - 3400) / 3400) * 100);
    expect(eth?.quoteVolume24h).toBe(90000000 * 3500);
  });

  it('hides coins with no convergence on any timeframe (宁少勿滥)', async () => {
    const source = buildSource((instrument, timeframe) =>
      instrument === 'BTC-USDT-SWAP' ? 'strong' : 'uptrend',
    );
    const service = serviceFrom(source);
    const result = await service.scanShrink({ ...params, topN: 3 });
    // Only BTC qualifies; ETH and SOL have no structure anywhere and never appear.
    expect(result.scanned.map((row) => row.instrument)).toEqual(['BTC-USDT-SWAP']);
    expect(result.qualifiedCount).toBe(1);
  });

  it('sorts by qualifiedCount desc, then bestScore desc', async () => {
    const source = buildSource((instrument, timeframe) => {
      if (instrument === 'BTC-USDT-SWAP') return 'strong'; // all 5 timeframes, strong
      if (instrument === 'ETH-USDT-SWAP') return timeframe === '5m' ? 'strong' : 'uptrend'; // 1 tf, strong
      if (instrument === 'SOL-USDT-SWAP') return timeframe === '5m' ? 'weak' : 'uptrend'; // 1 tf, weak
      return 'none';
    });
    const service = serviceFrom(source);
    const result = await service.scanShrink({ ...params, topN: 3 });

    // BTC (5 timeframes) first; ETH and SOL both converge on 5m only, ETH's strong
    // band outscores SOL's weak band → ETH second, SOL third.
    expect(result.scanned.map((row) => row.instrument)).toEqual(['BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP']);
    expect(result.scanned[0].qualifiedCount).toBe(5);
    expect(result.scanned[1].convergedTimeframes).toEqual(['5m']);
    expect(result.scanned[2].convergedTimeframes).toEqual(['5m']);
    expect(result.scanned[1].bestScore).toBeGreaterThan(result.scanned[2].bestScore);
    expect(result.scanned[1].bestScore).toBeGreaterThan(0.85);
    expect(result.scanned[2].bestScore).toBeLessThan(0.7);
  });

  it('filters out instruments below the minimum 24h quote volume before picking top-N', async () => {
    const source = buildSource(allStrongPlan);
    const service = serviceFrom(source);
    // BTC quote-volume = 150M * 60000 = 9e12; ETH = 90M * 3500 = 3.15e11.
    const result = await service.scanShrink({ ...params, minQuoteVolume24h: 5e11 });
    expect(result.scanned.map((row) => row.instrument)).toEqual(['BTC-USDT-SWAP']);
  });

  it('applies the minScore gate: weaker convergences are filtered out when the knob is raised', async () => {
    // BTC converges strongly (score ≈ 0.9), ETH weakly (score ≈ 0.6).
    // minScore 0.5 admits both; 0.7 filters out the weak one.
    const source = buildSource((instrument, timeframe) =>
      instrument === 'BTC-USDT-SWAP' ? 'strong' : timeframe === '5m' ? 'weak' : 'uptrend',
    );
    const service = serviceFrom(source);
    const permissive = await service.scanShrink({ ...params, minScore: 0.5 });
    expect(permissive.qualifiedCount).toBe(2);
    const strict = await service.scanShrink({ ...params, minScore: 0.7 });
    expect(strict.scanned.map((row) => row.instrument)).toEqual(['BTC-USDT-SWAP']);
    expect(strict.qualifiedCount).toBe(1);
  });

  it('applies a past anchor to every timeframe and echoes it in params', async () => {
    const source = buildSource(allStrongPlan);
    const service = serviceFrom(source);
    const pastAnchor = Date.parse('2026-08-04T00:00:00Z');
    const result = await service.scanShrink({ ...params, anchor: pastAnchor });
    for (const timeframe of scanTimeframes) {
      expect(source.getCandlesticks).toHaveBeenCalledWith(
        expect.objectContaining({ anchor: pastAnchor, timeframe }),
      );
    }
    expect(result.params.anchor).toBe(pastAnchor);
    expect(result.scanned.length).toBeGreaterThan(0);
  });

  it('reports one coin converging on multiple timeframes as a single row', async () => {
    // BTC converges on 5m and 1H, nothing elsewhere. One row carries both.
    const source = buildSource((instrument, timeframe) => {
      if (instrument !== 'BTC-USDT-SWAP') return 'uptrend';
      if (timeframe === '5m' || timeframe === '1H') return 'strong';
      return 'uptrend';
    });
    const service = serviceFrom(source);
    const result = await service.scanShrink({ ...params, topN: 1 });

    expect(result.scanned).toHaveLength(1);
    const row = result.scanned[0];
    expect(row.convergedTimeframes).toEqual(['5m', '1H']);
    expect(row.qualifiedCount).toBe(2);
    expect(row.structures['5m'].structure).toBe('convergence');
    expect(row.structures['1H'].structure).toBe('convergence');
    expect(row.bestScore).toBeGreaterThan(0.85);
  });

  it('fills neutral zeros for timeframes without a convergence', async () => {
    const source = buildSource((instrument, timeframe) =>
      instrument === 'BTC-USDT-SWAP' && timeframe === '5m' ? 'strong' : 'uptrend',
    );
    const service = serviceFrom(source);
    const result = await service.scanShrink({ ...params, topN: 1 });
    const row = result.scanned[0];
    expect(row.convergedTimeframes).toEqual(['5m']);
    expect(row.qualifiedCount).toBe(1);
    expect(row.structures['5m'].structure).toBe('convergence');
    for (const timeframe of ['15m', '1H', '4H', '1D'] as ReviewTimeframe[]) {
      expect(row.structures[timeframe]).toEqual({
        structure: null,
        position: 0,
        score: 0,
        touchCount: 0,
        qualified: false,
      });
    }
  });

  it('skips coins with insufficient candle history on every timeframe', async () => {
    const getCandlesticks = vi.fn(async () => []);
    const service = new CoinScanService({ listTickers: vi.fn(async () => tickers) }, { getCandlesticks });
    const result = await service.scanShrink(params);
    expect(result.scanned).toEqual([]);
    expect(result.qualifiedCount).toBe(0);
  });

  it('discards stale rate-limit warnings and reports only those raised during the scan', async () => {
    const source = buildSource(allStrongPlan);
    const warnings: string[] = [];
    const service = new CoinScanService(
      { listTickers: source.listTickers },
      { getCandlesticks: source.getCandlesticks },
      { takeWarnings: () => warnings.splice(0) },
    );
    // A warning left over from an earlier scan is dropped...
    warnings.push('stale');
    const resultPromise = service.scanShrink(params);
    // ...while one raised mid-scan is surfaced on the response.
    warnings.push('币安限频(HTTP 429)，已自动退避 10 秒');
    const result = await resultPromise;
    expect(result.warnings).toEqual(['币安限频(HTTP 429)，已自动退避 10 秒']);
  });
});

describe('CoinScanService (session gating: skip closed traditional markets)', () => {
  const equityTicker = (instrument: string, quoteVolume24h: number): Ticker => ({
    instrument,
    quoteVolume24h,
    lastPrice: 100,
    change24h: 1,
    marketClass: 'US_EQUITY',
  });

  /** Every requested (coin, timeframe) is a strong convergence. */
  function strongService(tickerList: Ticker[]) {
    const listTickers = vi.fn(async () => tickerList);
    const getCandlesticks = vi.fn(async ({ timeframe, anchor }: CandleRequest) =>
      candlesAt(anchor, timeframe, strongBars),
    );
    return { listTickers, getCandlesticks, service: new CoinScanService({ listTickers }, { getCandlesticks }) };
  }

  it('drops closed US equities, keeps them out of topN, and never fetches their candles', async () => {
    // Closed on a Saturday; the equities rank at the top of the pool by volume,
    // so without gating they would take the single topN slot.
    const saturdayMs = Date.UTC(2026, 2, 14, 13, 30);
    const tsla = equityTicker('TSLAUSDT', 1_000_000_000);
    const nvda = equityTicker('NVDAUSDT', 900_000_000);
    const btc: Ticker = { instrument: 'BTCUSDT', quoteVolume24h: 800_000_000, lastPrice: 60000, change24h: -1 };
    const xau: Ticker = { instrument: 'XAUUSDT', quoteVolume24h: 100_000_000, lastPrice: 4000, change24h: 1, marketClass: 'COMMODITY' };
    const { getCandlesticks, service } = strongService([tsla, nvda, btc, xau]);
    const equityService = strongService([tsla, nvda, btc, xau]).service;

    // Crypto sub-module: the closed equities are not even in this universe, so the
    // open crypto takes the topN slot and no candles are fetched for them.
    const cryptoResult = await service.scanShrink({ method: 'shrink', topN: 1, minQuoteVolume24h: 0, anchor: saturdayMs });
    expect(cryptoResult.scanned.map((row) => row.instrument)).toEqual(['BTCUSDT']);
    const requestedInstruments = new Set(getCandlesticks.mock.calls.map(([req]) => req.instrument));
    expect([...requestedInstruments].sort()).toEqual(['BTCUSDT']);

    // Equity sub-module: every equity is closed, so nothing is scanned, nothing is
    // requested, and both are reported as skipped.
    const equityResult = await equityService.scanShrink({
      method: 'shrink',
      scope: 'equity',
      topN: 1,
      minQuoteVolume24h: 0,
      anchor: saturdayMs,
    });
    expect(equityResult.scanned).toEqual([]);
    expect(equityResult.skippedInstruments).toEqual(['TSLAUSDT', 'NVDAUSDT']);
  });

  it('keeps US equities in the pool when their market is open', async () => {
    // Monday 2026-03-09 09:30 EDT.
    const mondayMs = Date.UTC(2026, 2, 9, 13, 30);
    const tsla = equityTicker('TSLAUSDT', 1_000_000_000);
    const btc: Ticker = { instrument: 'BTCUSDT', quoteVolume24h: 800_000_000, lastPrice: 60000, change24h: -1 };

    const equityResult = await strongService([tsla, btc]).service.scanShrink({
      method: 'shrink',
      scope: 'equity',
      topN: 2,
      minQuoteVolume24h: 0,
      anchor: mondayMs,
    });
    const cryptoResult = await strongService([tsla, btc]).service.scanShrink({
      method: 'shrink',
      topN: 2,
      minQuoteVolume24h: 0,
      anchor: mondayMs,
    });

    expect(equityResult.scanned.map((row) => row.instrument)).toEqual(['TSLAUSDT']);
    expect(equityResult.skippedInstruments).toBeUndefined();
    expect(cryptoResult.scanned.map((row) => row.instrument)).toEqual(['BTCUSDT']);
  });

  it('applies the same historical-weekend gating when the anchor is in the past', async () => {
    const saturdayMs = Date.UTC(2026, 2, 14, 13, 30);
    const tsla = equityTicker('TSLAUSDT', 1_000_000_000);
    const btc: Ticker = { instrument: 'BTCUSDT', quoteVolume24h: 800_000_000, lastPrice: 60000, change24h: -1 };
    const { service } = strongService([tsla, btc]);

    const result = await service.scanShrink({
      method: 'shrink',
      scope: 'equity',
      topN: 2,
      minQuoteVolume24h: 0,
      anchor: saturdayMs,
    });

    expect(result.scanned).toEqual([]);
    expect(result.skippedInstruments).toEqual(['TSLAUSDT']);
  });

  it('leaves ungated tickers (absent marketClass) untouched and reports no skips', async () => {
    const saturdayMs = Date.UTC(2026, 2, 14, 13, 30);
    const btc: Ticker = { instrument: 'BTCUSDT', quoteVolume24h: 800_000_000, lastPrice: 60000, change24h: -1 };
    const { service } = strongService([btc]);

    const result = await service.scanShrink({ method: 'shrink', topN: 1, minQuoteVolume24h: 0, anchor: saturdayMs });

    expect(result.scanned.map((row) => row.instrument)).toEqual(['BTCUSDT']);
    expect(result.skippedInstruments).toBeUndefined();
  });
});

describe('CoinScanService (session-only candle series)', () => {
  /** Only 5m converges, so every other timeframe can never produce a row. */
  const onlyFiveMinuteConverges = (timeframe: ReviewTimeframe) => (timeframe === '5m' ? 'strong' : 'uptrend');

  it('never lets closed-market candles reach the detector (same data, equity vs crypto)', async () => {
    // Monday 2026-03-09 04:01 EDT — one minute after the pre-market open, so the
    // equity IS in the pool, while the whole 5m fixture (01:25-04:00 ET) sits in
    // the overnight window where it does not trade. Only 5m can converge, so the
    // farther-back in-session bars of the longer timeframes cannot mask the effect.
    const anchor = Date.UTC(2026, 2, 9, 8, 1);
    const tsla: Ticker = { instrument: 'TSLAUSDT', quoteVolume24h: 900_000_000, lastPrice: 100, change24h: 1, marketClass: 'US_EQUITY' };
    const btc: Ticker = { instrument: 'BTCUSDT', quoteVolume24h: 800_000_000, lastPrice: 60000, change24h: -1 };
    const getCandlesticks = vi.fn(async ({ timeframe, anchor: at }: CandleRequest) =>
      candlesAt(at, timeframe, onlyFiveMinuteConverges(timeframe) === 'strong' ? strongBars : uptrendBars),
    );
    const cryptoService = new CoinScanService({ listTickers: vi.fn(async () => [btc]) }, { getCandlesticks });
    const equityService = new CoinScanService({ listTickers: vi.fn(async () => [tsla]) }, { getCandlesticks });

    const cryptoResult = await cryptoService.scanShrink({ method: 'shrink', topN: 2, minQuoteVolume24h: 0, anchor });
    const equityResult = await equityService.scanShrink({
      method: 'shrink',
      scope: 'equity',
      topN: 2,
      minQuoteVolume24h: 0,
      anchor,
    });

    // The identical candle series converges for crypto and yields nothing for the
    // equity once the untraded stretch is dropped before the detector runs.
    expect(cryptoResult.scanned.map((row) => row.instrument)).toEqual(['BTCUSDT']);
    expect(equityResult.scanned).toEqual([]);
    expect(equityResult.skippedInstruments).toBeUndefined();
  });

  it('requests a wider raw window for session-gated instruments', async () => {
    const anchor = Date.UTC(2026, 2, 9, 15, 0); // Monday 11:00 EDT, mid-session
    const tsla: Ticker = { instrument: 'TSLAUSDT', quoteVolume24h: 900_000_000, lastPrice: 100, change24h: 1, marketClass: 'US_EQUITY' };
    const btc: Ticker = { instrument: 'BTCUSDT', quoteVolume24h: 800_000_000, lastPrice: 60000, change24h: -1 };
    const getCandlesticks = vi.fn(async ({ timeframe, anchor: at }: CandleRequest) =>
      candlesAt(at, timeframe, strongBars),
    );
    const cryptoService = new CoinScanService({ listTickers: vi.fn(async () => [btc]) }, { getCandlesticks });
    const equityService = new CoinScanService({ listTickers: vi.fn(async () => [tsla]) }, { getCandlesticks });

    await cryptoService.scanShrink({ method: 'shrink', topN: 2, minQuoteVolume24h: 0, anchor });
    await equityService.scanShrink({ method: 'shrink', scope: 'equity', topN: 2, minQuoteVolume24h: 0, anchor });

    const limitsFor = (instrument: string) => [
      ...new Set(getCandlesticks.mock.calls.filter(([request]) => request.instrument === instrument).map(([request]) => request.limit)),
    ];
    // 2x for the gated class (dropped closed-market bars are paid for up front),
    // unchanged for the 24/7 class.
    expect(limitsFor('TSLAUSDT')).toEqual([200]);
    expect(limitsFor('BTCUSDT')).toEqual([100]);
  });

  it('flags the response when the ticker snapshot carried no instrument classes', async () => {
    const listTickers = vi.fn(async () => tickers);
    const getCandlesticks = vi.fn(async ({ timeframe, anchor }: CandleRequest) => candlesAt(anchor, timeframe, strongBars));
    const degraded = new CoinScanService({ listTickers, metadataAvailable: () => false }, { getCandlesticks });

    const result = await degraded.scanShrink(params);

    // Without classes nothing is session-gated, so closed contracts would be
    // judged as crypto — the caller must be able to see that.
    expect(result.metadataUnavailable).toBe(true);
  });

  it('omits the metadata flag when classes are available', async () => {
    const source = buildSource(allStrongPlan);
    const service = new CoinScanService(
      { listTickers: source.listTickers, metadataAvailable: () => true },
      { getCandlesticks: source.getCandlesticks },
    );

    const result = await service.scanShrink(params);

    expect(result.metadataUnavailable).toBeUndefined();
  });
});

describe('CoinScanService (选品 sub-modules: crypto / equity)', () => {
  /** Monday 2026-03-09 11:00 EDT: US equities open, Korean closed. */
  const US_ANCHOR = Date.UTC(2026, 2, 9, 15, 0);
  /** Monday 2026-03-09 11:00 KST: Korean equities open, US closed. */
  const KR_ANCHOR = Date.UTC(2026, 2, 9, 2, 0);
  const universe: Ticker[] = [
    { instrument: 'BTCUSDT', quoteVolume24h: 900_000_000, lastPrice: 60000, change24h: -1, marketClass: 'CRYPTO' },
    { instrument: 'XAUUSDT', quoteVolume24h: 800_000_000, lastPrice: 4000, change24h: 1, marketClass: 'COMMODITY' },
    { instrument: 'TSLAUSDT', quoteVolume24h: 700_000_000, lastPrice: 300, change24h: 2, marketClass: 'US_EQUITY' },
    { instrument: 'SAMSUNGUSDT', quoteVolume24h: 600_000_000, lastPrice: 180, change24h: 1, marketClass: 'KR_EQUITY' },
    { instrument: 'HK0700USDT', quoteVolume24h: 500_000_000, lastPrice: 430, change24h: 1, marketClass: 'HK_EQUITY' },
    { instrument: 'OPENAIUSDT', quoteVolume24h: 400_000_000, lastPrice: 1400, change24h: 1, marketClass: 'PRE_IPO' },
  ];

  function scopedService() {
    const listTickers = vi.fn(async () => universe);
    const getCandlesticks = vi.fn(async ({ timeframe, anchor: at }: CandleRequest) =>
      candlesAt(at, timeframe, strongBars),
    );
    return { getCandlesticks, service: new CoinScanService({ listTickers }, { getCandlesticks }) };
  }

  it('scans only crypto-class instruments in the crypto scope (the default)', async () => {
    const { getCandlesticks, service } = scopedService();

    const result = await service.scanShrink({ method: 'shrink', topN: 10, minQuoteVolume24h: 0, anchor: US_ANCHOR });

    expect(result.scanned.map((row) => row.instrument).sort()).toEqual(['BTCUSDT', 'XAUUSDT']);
    expect(result.params.scope).toBe('crypto');
    // Out-of-pool classes are a pool definition, not a runtime skip.
    expect(result.skippedInstruments).toBeUndefined();
    expect([...new Set(getCandlesticks.mock.calls.map(([request]) => request.instrument))].sort()).toEqual([
      'BTCUSDT',
      'XAUUSDT',
    ]);
  });

  it('scans only the equities whose market is open in the equity scope', async () => {
    // US and Korean sessions do not overlap (US 04:00-20:00 ET vs KR 09:00-15:30
    // KST), so each anchor can only ever contain one of them.
    const { getCandlesticks, service } = scopedService();

    const usOpen = await service.scanShrink({ method: 'shrink', scope: 'equity', topN: 10, minQuoteVolume24h: 0, anchor: US_ANCHOR });
    const krOpen = await scopedService().service.scanShrink({
      method: 'shrink',
      scope: 'equity',
      topN: 10,
      minQuoteVolume24h: 0,
      anchor: KR_ANCHOR,
    });

    expect(usOpen.scanned.map((row) => row.instrument)).toEqual(['TSLAUSDT']);
    expect(usOpen.skippedInstruments).toEqual(['SAMSUNGUSDT']);
    expect(krOpen.scanned.map((row) => row.instrument)).toEqual(['SAMSUNGUSDT']);
    expect(krOpen.skippedInstruments).toEqual(['TSLAUSDT']);
    expect([...new Set(getCandlesticks.mock.calls.map(([request]) => request.instrument))]).toEqual(['TSLAUSDT']);
  });

  it('keeps the two pools disjoint and their union equal to every scannable instrument', async () => {
    const crypto = await scopedService().service.scanShrink({ method: 'shrink', topN: 10, minQuoteVolume24h: 0, anchor: US_ANCHOR });
    const usEquity = await scopedService().service.scanShrink({
      method: 'shrink',
      scope: 'equity',
      topN: 10,
      minQuoteVolume24h: 0,
      anchor: US_ANCHOR,
    });
    const krEquity = await scopedService().service.scanShrink({
      method: 'shrink',
      scope: 'equity',
      topN: 10,
      minQuoteVolume24h: 0,
      anchor: KR_ANCHOR,
    });

    const cryptoRows = crypto.scanned.map((row) => row.instrument).sort();
    const equityRows = [...usEquity.scanned, ...krEquity.scanned].map((row) => row.instrument).sort();
    expect(cryptoRows.filter((instrument) => equityRows.includes(instrument))).toEqual([]);
    // The out-of-pool HK / pre-IPO contracts belong to neither sub-module.
    expect([...cryptoRows, ...equityRows].sort()).toEqual(['BTCUSDT', 'SAMSUNGUSDT', 'TSLAUSDT', 'XAUUSDT']);
  });

  it('treats a third-party exchange instrument (no class) as crypto so a metadata outage still scans', async () => {
    const listTickers = vi.fn(async () => [
      { instrument: 'MYSTERYUSDT', quoteVolume24h: 1_000_000_000, lastPrice: 10, change24h: 1 } as Ticker,
    ]);
    const getCandlesticks = vi.fn(async ({ timeframe, anchor: at }: CandleRequest) =>
      candlesAt(at, timeframe, strongBars),
    );
    const service = new CoinScanService({ listTickers }, { getCandlesticks });

    const result = await service.scanShrink({ method: 'shrink', topN: 10, minQuoteVolume24h: 0, anchor: US_ANCHOR });

    expect(result.scanned.map((row) => row.instrument)).toEqual(['MYSTERYUSDT']);
  });
});
