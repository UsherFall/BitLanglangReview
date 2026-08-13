import { describe, expect, it, vi } from 'vitest';
import type { Candlestick } from '../src/domain/candlestick';
import type { ShrinkScanParams } from '../src/domain/coin-scan';
import { scanTimeframes } from '../src/domain/coin-scan';
import type { ReviewTimeframe } from '../src/domain/trade';
import { timeframeMs } from '../src/server/candlestick-service';
import { CoinScanService } from '../src/server/coin-scan-service';
import type { CandleRequest, CandleSource, Ticker } from '../src/server/market-data';

// ---------------------------------------------------------------------------
// Real-structure synthetic bars (shared with the pure-algorithm tests): a
// horizontal low-volatility box, a symmetric triangle, and a trending channel
// that must NOT classify as a structure. The service test only needs the box
// and the triangle to be reliably detected — the exact geometry is calibrated
// in tests/coin-scan.test.ts.
// ---------------------------------------------------------------------------

// A volatility convergence: 16 bars trending DOWN from [92,98] to [83,89] (a
// real move, ~20% below the band) then 16 calm flat bars [99.5,100.5]. The
// 16-bar band is long enough to score above minScore and genuinely calmer than
// the move before it → a convergence.
const boxBars: ReadonlyArray<readonly [number, number]> = [
  ...Array.from({ length: 16 }, (_, i) => [92 - i * 0.6, 98 - i * 0.6] as const),
  ...Array.from({ length: 16 }, () => [99.5, 100.5] as const),
];

// Triangle fixture must be STILL converging at the newest bar (index 24, apex ≈
// 29) — anchoring trend lines at the current bar rejects the old fixture whose
// apex (≈ 23) had already passed the newest bar (27).
const triangleBars: ReadonlyArray<readonly [number, number]> = [
  [108, 110], [108, 110], [108, 110], [108, 110], [108, 110], [108, 110],
  [88, 109], [108, 110], [108, 110], [108, 110],
  [108, 122], [92, 109], [108, 110], [108, 110], [108, 110],
  [108, 118], [96, 109], [108, 110], [108, 110], [108, 110],
  [108, 114], [100, 109], [108, 110], [108, 110], [108, 110],
];

const uptrendBars: ReadonlyArray<readonly [number, number]> = [
  [108, 110], [108, 110], [108, 110], [108, 110], [108, 110], [108, 110],
  [90, 109], [108, 110], [108, 110], [108, 110],
  [108, 114], [96, 109], [108, 110], [108, 110], [108, 110],
  [108, 120], [102, 109], [108, 110], [108, 110], [108, 110],
  [108, 126], [108, 110], [108, 110], [108, 110],
];

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

/** A structure-kind plan per (coin, timeframe): which synthetic shape to serve. */
type Shape = 'box' | 'triangle' | 'uptrend' | 'none';

const shapeBars: Record<Exclude<Shape, 'none'>, ReadonlyArray<readonly [number, number]>> = {
  box: boxBars,
  triangle: triangleBars,
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

const allBoxPlan = () => 'box' as const;

describe('CoinScanService (convergence structure, multi-timeframe)', () => {
  it('scans top-N coins across all 5 timeframes and reports every qualified structure', async () => {
    const source = buildSource((instrument, timeframe) => (instrument === 'SOL-USDT-SWAP' ? 'uptrend' : allBoxPlan()));
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
        // The convergence fixture has 20 volatile bars then 16 calm bars: a long,
        // genuinely calm band → the length-weighted convergence score is ~0.99.
        expect(row.structures[timeframe].score).toBeCloseTo(0.977, 3);
      }
    }
    expect(result.qualifiedCount).toBe(2);
    // Equal counts and equal bestScore keep the stable ticker (quote-volume) order.
    expect(result.scanned[0].instrument).toBe('BTC-USDT-SWAP');
    expect(result.params).toEqual({ ...params, anchor: expect.any(Number) });
  });

  it('fetches each (coin, timeframe) with the probe-type per-timeframe limit', async () => {
    const source = buildSource(allBoxPlan);
    const service = serviceFrom(source);
    await service.scanShrink(params);

    for (const timeframe of ['5m', '15m', '1H', '4H'] as ReviewTimeframe[]) {
      expect(source.getCandlesticks).toHaveBeenCalledWith(
        expect.objectContaining({ timeframe, limit: 100, direction: 'earlier', anchor: expect.any(Number) }),
      );
    }
    expect(source.getCandlesticks).toHaveBeenCalledWith(
      expect.objectContaining({ timeframe: '1D', limit: 40, direction: 'earlier' }),
    );
    expect(source.getCandlesticks).toHaveBeenCalledWith(
      expect.objectContaining({ instrument: 'BTC-USDT-SWAP', timeframe: '5m' }),
    );
  });

  it('drops the still-forming bar by time without dropping the newest completed bar', async () => {
    const anchor = Date.parse('2026-08-04T00:00:00Z');
    // Same data, once with a forming bar appended at `anchor` and once without.
    const withForming = buildSource(allBoxPlan, true);
    const withoutForming = buildSource(allBoxPlan, false);
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
    const source = buildSource(allBoxPlan);
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

  it('hides coins with no convergent structure on any timeframe (宁少勿滥)', async () => {
    const source = buildSource((instrument, timeframe) =>
      instrument === 'BTC-USDT-SWAP' ? 'box' : 'uptrend',
    );
    const service = serviceFrom(source);
    const result = await service.scanShrink({ ...params, topN: 3 });
    // Only BTC qualifies; ETH and SOL have no structure anywhere and never appear.
    expect(result.scanned.map((row) => row.instrument)).toEqual(['BTC-USDT-SWAP']);
    expect(result.qualifiedCount).toBe(1);
  });

  it('sorts by qualifiedCount desc, then bestScore desc, across structure strength', async () => {
    const source = buildSource((instrument, timeframe) => {
      if (instrument === 'BTC-USDT-SWAP') return 'box'; // all 5 timeframes
      if (instrument === 'ETH-USDT-SWAP') return timeframe === '5m' ? 'box' : 'uptrend'; // 1 tf, weak
      if (instrument === 'SOL-USDT-SWAP') return timeframe === '5m' ? 'triangle' : 'uptrend'; // 1 tf, strong
      return 'none';
    });
    const service = serviceFrom(source);
    const result = await service.scanShrink({ ...params, topN: 3 });

    // BTC converges on 5 timeframes (convergence ~0.99) → first. SOL and ETH
    // converge on 1 timeframe; ETH's convergence (~0.99) outscores SOL's triangle
    // (0.825) → ETH second, SOL third. All orderings come from the service, not
    // the UI.
    expect(result.scanned.map((row) => row.instrument)).toEqual(['BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP']);
    expect(result.scanned[0].qualifiedCount).toBe(5);
    expect(result.scanned[1].convergedTimeframes).toEqual(['5m']);
    expect(result.scanned[2].convergedTimeframes).toEqual(['5m']);
    expect(result.scanned[1].bestScore).toBeGreaterThan(result.scanned[2].bestScore);
    expect(result.scanned[1].bestScore).toBeCloseTo(0.977, 3);
    expect(result.scanned[2].bestScore).toBeCloseTo(0.825, 2);
  });

  it('filters out instruments below the minimum 24h quote volume before picking top-N', async () => {
    const source = buildSource(allBoxPlan);
    const service = serviceFrom(source);
    // BTC quote-volume = 150M * 60000 = 9e12; ETH = 90M * 3500 = 3.15e11.
    const result = await service.scanShrink({ ...params, minQuoteVolume24h: 5e11 });
    expect(result.scanned.map((row) => row.instrument)).toEqual(['BTC-USDT-SWAP']);
  });

  it('applies the minScore gate: weaker structures are filtered out when the knob is raised', async () => {
    // BTC converges as a convergence (score 1.0), ETH as a triangle (0.825).
    // minScore 0.8 admits both; 0.9 filters out the triangle.
    const source = buildSource((instrument, timeframe) =>
      instrument === 'BTC-USDT-SWAP' ? 'box' : timeframe === '5m' ? 'triangle' : 'uptrend',
    );
    const service = serviceFrom(source);
    const permissive = await service.scanShrink({ ...params, minScore: 0.8 });
    expect(permissive.qualifiedCount).toBe(2);
    const strict = await service.scanShrink({ ...params, minScore: 0.9 });
    expect(strict.scanned.map((row) => row.instrument)).toEqual(['BTC-USDT-SWAP']);
    expect(strict.qualifiedCount).toBe(1);
  });

  it('applies a past anchor to every timeframe and echoes it in params', async () => {
    const source = buildSource(allBoxPlan);
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

  it('reports a single coin with different structures on different timeframes (AC5)', async () => {
    // BTC: 5m triangle + 1H convergence, nothing elsewhere. One row carries both
    // structures; convergedTimeframes lists them in scanTimeframes order.
    const source = buildSource((instrument, timeframe) => {
      if (instrument !== 'BTC-USDT-SWAP') return 'uptrend';
      if (timeframe === '5m') return 'triangle';
      if (timeframe === '1H') return 'box';
      return 'uptrend';
    });
    const service = serviceFrom(source);
    const result = await service.scanShrink({ ...params, topN: 1 });

    expect(result.scanned).toHaveLength(1);
    const row = result.scanned[0];
    expect(row.convergedTimeframes).toEqual(['5m', '1H']);
    expect(row.qualifiedCount).toBe(2);
    expect(row.structures['5m'].structure).toBe('triangle');
    expect(row.structures['1H'].structure).toBe('convergence');
    // The convergence fixture (20 volatile + 16 calm bars) outscores the triangle.
    expect(row.structures['1H'].score).toBeGreaterThan(row.structures['5m'].score);
    // bestScore = strongest score across the qualified timeframes (the convergence).
    expect(row.bestScore).toBeCloseTo(0.977, 3);
  });

  it('fills neutral zeros for timeframes without a convergent structure', async () => {
    const source = buildSource((instrument, timeframe) =>
      instrument === 'BTC-USDT-SWAP' && timeframe === '5m' ? 'box' : 'uptrend',
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
});
