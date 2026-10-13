import { describe, expect, it, vi } from 'vitest';
import type { Candlestick } from '../src/domain/candlestick';
import { COARSE_TIMEFRAME, DEFAULT_COARSE_PARAMS, scanTimeframes, type ShrinkScanParams } from '../src/domain/coin-scan';
import type { ReviewTimeframe } from '../src/domain/trade';
import { timeframeMs } from '../src/server/candlestick-service';
import { CoinScanService } from '../src/server/coin-scan-service';
import type { CandleRequest, CandleSource, Ticker } from '../src/server/market-data';

// ---------------------------------------------------------------------------
// Synthetic bars.
//
// Two families matter here. The timeframe fixtures below (strong / weak / mild /
// mid / shallow / uptrend) drive the per-timeframe convergence verdicts, and
// `flatBars` / `trendBars` drive the 1D coarse screen: the pool's coarse cut is
// `floor(q · N)`, so a fixture needs ~20 instruments with the tight ones clearly
// ahead of the rest — a 1–2 name pool has a cut of 0 and can never pass anything.
// ---------------------------------------------------------------------------

/** One `[low, high]` bar; `close` is always the midpoint (see `candlesAt`). */
type Bar = readonly [number, number];

// One volatile lead of 16 bars (~6.5-7.2% per bar) shared by every shrink
// fixture below, so their scores differ only through the band's own amplitude.
const volatileLead: ReadonlyArray<Bar> = Array.from({ length: 16 }, (_, i) => [92 - i * 0.6, 98 - i * 0.6] as const);

// Strong convergence: the volatile lead then 16 flat calm bars (~1%) → the band
// is far quieter than the stretch before it (shrink depth ≈ 0.86). Over a 23-bar
// 1D window its range is ≈17.5% and its net drift ≈11.6% — tight enough to clear
// the coarse screen when the rest of the pool trends.
const strongBars: ReadonlyArray<Bar> = [...volatileLead, ...Array.from({ length: 16 }, () => [99.5, 100.5] as const)];

// Weak convergence: same volatile lead, but a band only ~1.7× quieter → detected
// but scored below the default minScore 0.6 (shrink depth ≈ 0.41).
const weakBars: ReadonlyArray<Bar> = [...volatileLead, ...Array.from({ length: 16 }, () => [98, 102] as const)];

// Mild shrink: band ~2.0× quieter → shrink depth ≈ 0.51. Under minScore 0.6 it
// clears the 1D threshold (0.50) and nothing else — the STRK 1D case.
const mildBars: ReadonlyArray<Bar> = [...volatileLead, ...Array.from({ length: 16 }, () => [98, 101.35] as const)];

// Shallow shrink: band ~1.75× quieter → shrink depth ≈ 0.44. Structurally
// qualified, but below even the 4H threshold (0.55) at minScore 0.6.
const shallowBars: ReadonlyArray<Bar> = [...volatileLead, ...Array.from({ length: 16 }, () => [98, 101.825] as const)];

// Mid shrink: band ~2.4× quieter → shrink depth ≈ 0.576. This is the only band
// that sits BETWEEN the small timeframes' bar (0.60) and the 4H bar (0.55), so
// it is the one fixture that isolates the 4H offset: drop that offset and the
// band stops converging on 4H while everything else stays put.
const midBars: ReadonlyArray<Bar> = [...volatileLead, ...Array.from({ length: 16 }, () => [98, 100.9] as const)];

// Trending channel: no volatility shrink anywhere → never a convergence.
const uptrendBars: ReadonlyArray<Bar> = Array.from({ length: 40 }, (_, i) => [100 + i * 2, 106 + i * 2] as const);

// Uniformly calm: no shrink anywhere either (so no convergence on ANY timeframe),
// but a very narrow range with zero drift — the coarse screen's "keeps it" tier.
const flatBars: ReadonlyArray<Bar> = Array.from({ length: 40 }, () => [99, 101] as const);

// 趴在绝对底部: a 220 → 100 dump whose last 24 bars are the tightest box in the
// pool (23-day range 2%, zero drift) while the newest close (101) sits ~0.8% above
// the series' lowest low. The percentile gates admit it; the ABSOLUTE position
// floor is the only thing that can reject it.
const bottomBars: ReadonlyArray<Bar> = [
  ...Array.from({ length: 16 }, () => [200, 220] as const),
  ...Array.from({ length: 24 }, () => [100, 102] as const),
];

/**
 * The coarse screen's "rejected" tier, and the pool's majority: a rising channel
 * that is far wider AND drifts far more than any subject shape below. Every
 * filler shares this ONE shape on purpose — a tie group takes its most
 * conservative rank, so the whole group lands above both cuts at once and none
 * of them can slip in.
 */
const trendBars: ReadonlyArray<Bar> = Array.from({ length: 40 }, (_, i) => [100 + i * 3, 106 + i * 3] as const);

type Shape = 'strong' | 'weak' | 'mild' | 'mid' | 'shallow' | 'flat' | 'bottom' | 'uptrend' | 'trend' | 'none';

/** Bars for one shape. */
function barsFor(shape: Shape): ReadonlyArray<Bar> | null {
  switch (shape) {
    case 'strong':
      return strongBars;
    case 'weak':
      return weakBars;
    case 'mild':
      return mildBars;
    case 'mid':
      return midBars;
    case 'shallow':
      return shallowBars;
    case 'flat':
      return flatBars;
    case 'bottom':
      return bottomBars;
    case 'uptrend':
      return uptrendBars;
    case 'trend':
      return trendBars;
    case 'none':
      return null;
  }
}

type Plan = (instrument: string, timeframe: ReviewTimeframe) => Shape;

/**
 * Builds completed candles for `bars` whose newest bar closes exactly at
 * `anchor - timeframeStep` (so the service's by-time completed filter keeps it),
 * optionally appending a still-forming bar at `anchor` that the service must
 * drop. All candles carry `timeframe` so `timeframeMs` sees the right step.
 */
function candlesAt(anchor: number, timeframe: ReviewTimeframe, bars: ReadonlyArray<Bar>, withForming = false): Candlestick[] {
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

type Source = {
  listTickers: ReturnType<typeof vi.fn<() => Promise<Ticker[]>>>;
  getCandlesticks: ReturnType<typeof vi.fn<CandleSource['getCandlesticks']>>;
};

function buildSource(tickerList: Ticker[], plan: Plan, withForming = false): Source {
  const listTickers = vi.fn<() => Promise<Ticker[]>>(async () => tickerList);
  const getCandlesticks = vi.fn<CandleSource['getCandlesticks']>(
    async ({ instrument, timeframe, anchor }: CandleRequest) => {
      const bars = barsFor(plan(instrument, timeframe));
      return bars ? candlesAt(anchor, timeframe, bars, withForming) : [];
    },
  );
  return { listTickers, getCandlesticks };
}

// ---- The standard 20-instrument crypto pool -------------------------------
// The first three instruments are the subjects; the rest are fillers whose 1D
// TRENDS (so they never clear the coarse screen) and whose other timeframes
// never converge.
const POOL_SIZE = 20;
const BTC = 'BTCUSDT';
const ETH = 'ETHUSDT';
const SOL = 'SOLUSDT';
const FILLERS = Array.from({ length: POOL_SIZE - 3 }, (_, i) => `FILL${String(i).padStart(2, '0')}USDT`);
const POOL = [BTC, ETH, SOL, ...FILLERS];

function tickersFor(instruments: readonly string[] = POOL): Ticker[] {
  return instruments.map((instrument, index) => ({
    instrument,
    quoteVolume24h: (POOL_SIZE - index) * 1_000_000_000,
    lastPrice: 100 + index,
    change24h: index % 2 === 0 ? 1.5 : -2.5,
  }));
}

/** The standard pool: `subjects` get explicit shapes, everything else is a 1D trend. */
function poolSource(subjects: Record<string, Partial<Record<ReviewTimeframe, Shape>>>, withForming = false): Source {
  return buildSource(
    tickersFor(),
    (instrument, timeframe) =>
      subjects[instrument]?.[timeframe] ?? (timeframe === COARSE_TIMEFRAME ? 'trend' : 'none'),
    withForming,
  );
}

function serviceFrom(source: Source): CoinScanService {
  return new CoinScanService({ listTickers: source.listTickers }, { getCandlesticks: source.getCandlesticks });
}

// ---- The 20-name US-equity pool (the session-gated side) ------------------
const TSLA = 'TSLAUSDT';
const EQUITY_POOL = [TSLA, ...Array.from({ length: POOL_SIZE - 1 }, (_, i) => `EQ${String(i).padStart(2, '0')}USDT`)];

/** 20 open/closed US equities; TSLA is the coarse-tight one, the rest 1D-trend. */
function equitySource(): Source {
  const tickers: Ticker[] = EQUITY_POOL.map((instrument, index) => ({
    instrument,
    quoteVolume24h: (POOL_SIZE - index) * 1_000_000_000,
    lastPrice: 100,
    change24h: 1,
    marketClass: 'US_EQUITY',
  }));
  return buildSource(tickers, (instrument, timeframe) =>
    instrument === TSLA ? 'strong' : timeframe === COARSE_TIMEFRAME ? 'trend' : 'none',
  );
}

/** Every instrument a candle was requested for, de-duplicated, in first-call order. */
const requestedInstruments = (source: Source) => [
  ...new Set(source.getCandlesticks.mock.calls.map(([request]) => request.instrument)),
];
/** Every timeframe requested for one instrument. */
const requestedTimeframes = (source: Source, instrument: string) => [
  ...new Set(
    source.getCandlesticks.mock.calls.filter(([request]) => request.instrument === instrument).map(([request]) => request.timeframe),
  ),
];

const params: ShrinkScanParams = { method: 'shrink', minQuoteVolume24h: 0 };

describe('CoinScanService (coarse screen → per-timeframe convergence)', () => {
  it('scans the coarse survivors across all 5 timeframes and reports every qualified structure', async () => {
    const source = poolSource({
      [BTC]: { '5m': 'strong', '15m': 'strong', '1H': 'strong', '4H': 'strong', '1D': 'strong' },
      [ETH]: { '5m': 'strong', '15m': 'strong', '1H': 'strong', '4H': 'strong', '1D': 'strong' },
      // SOL converges everywhere EXCEPT 1D — and its trending 1D is what the
      // coarse screen rejects, so it never reaches stage 2 at all.
      [SOL]: { '5m': 'strong', '15m': 'strong', '1H': 'strong', '4H': 'strong' },
    });
    const service = serviceFrom(source);
    const result = await service.scanShrink(params);

    expect(result.scanned.map((row) => row.instrument)).toEqual([BTC, ETH]);
    for (const row of result.scanned) {
      expect(row.convergedTimeframes).toEqual(scanTimeframes);
      expect(row.qualifiedCount).toBe(5);
      expect(row.qualified).toBe(true);
      for (const timeframe of scanTimeframes) {
        expect(row.structures[timeframe].structure).toBe('convergence');
        expect(row.structures[timeframe].qualified).toBe(true);
        // The strong fixture's band is far quieter than its preceding stretch →
        // the score IS that shrink depth (band ~1.0% vs lead ~6.4%) ≈ 0.86.
        expect(row.structures[timeframe].score).toBeGreaterThan(0.85);
      }
      expect(row.coarse?.pass).toBe(true);
      expect(row.coarse?.rangePctThreshold).toBeGreaterThan(0);
    }
    expect(result.qualifiedCount).toBe(2);
    // Equal counts and equal bestScore keep the stable ticker (quote-volume) order.
    expect(result.scanned[0].instrument).toBe(BTC);
    expect(result.params).toEqual({ ...params, scope: 'crypto', anchor: expect.any(Number) });
    // The response echoes what the screen ran on and with.
    expect(result.coarse).toMatchObject({
      windowDays: DEFAULT_COARSE_PARAMS.windowDays,
      pctRange: DEFAULT_COARSE_PARAMS.pctRange,
      pctNet: DEFAULT_COARSE_PARAMS.pctNet,
      poolSize: POOL_SIZE,
      candidates: POOL_SIZE,
    });
  });

  it('fetches 1D for the whole pool and the other four timeframes only for its survivors', async () => {
    const source = poolSource({
      [BTC]: { '5m': 'strong', '15m': 'strong', '1H': 'strong', '4H': 'strong', '1D': 'strong' },
      [ETH]: { '5m': 'strong', '1H': 'strong', '1D': 'flat' },
    });
    await serviceFrom(source).scanShrink(params);

    // Every candidate pays exactly one request (the coarse timeframe)...
    expect([...requestedInstruments(source)].sort()).toEqual([...POOL].sort());
    for (const instrument of POOL) {
      expect(requestedTimeframes(source, instrument)[0]).toBe(COARSE_TIMEFRAME);
    }
    // ...and the fillers pay nothing more: the screen rejected them before stage 2.
    for (const filler of FILLERS) {
      expect(requestedTimeframes(source, filler)).toEqual([COARSE_TIMEFRAME]);
    }
    // 20 candidates × 1 + 2 survivors × 4 = 28 requests.
    expect(source.getCandlesticks).toHaveBeenCalledTimes(POOL_SIZE + 2 * (scanTimeframes.length - 1));
  });

  it('fetches each (coin, timeframe) with a uniform window for every timeframe', async () => {
    const source = poolSource({ [BTC]: { '5m': 'strong', '15m': 'strong', '1H': 'strong', '4H': 'strong', '1D': 'strong' } });
    await serviceFrom(source).scanShrink(params);

    for (const timeframe of scanTimeframes) {
      expect(source.getCandlesticks).toHaveBeenCalledWith(
        expect.objectContaining({ timeframe, limit: 100, direction: 'earlier', anchor: expect.any(Number), refresh: true }),
      );
    }
    expect(source.getCandlesticks).toHaveBeenCalledWith(
      expect.objectContaining({ instrument: BTC, timeframe: '5m' }),
    );
  });

  it('drops the still-forming bar by time without dropping the newest completed bar', async () => {
    const anchor = Date.parse('2026-08-04T00:00:00Z');
    const allStrong: Partial<Record<ReviewTimeframe, Shape>> = {
      '5m': 'strong',
      '15m': 'strong',
      '1H': 'strong',
      '4H': 'strong',
      '1D': 'strong',
    };
    const plan: Plan = (instrument, timeframe) =>
      instrument === BTC ? allStrong[timeframe] ?? 'trend' : timeframe === COARSE_TIMEFRAME ? 'trend' : 'none';
    // Same data, once with a forming bar appended at `anchor` and once without.
    const withForming = buildSource(tickersFor(), plan, true);
    const withoutForming = buildSource(tickersFor(), plan, false);
    const [resultWith, resultWithout] = await Promise.all([
      serviceFrom(withForming).scanShrink({ ...params, anchor }),
      serviceFrom(withoutForming).scanShrink({ ...params, anchor }),
    ]);
    // The forming bar must not change the verdict — it is dropped by time, and
    // the newest COMPLETED bar is never sliced away.
    expect(resultWith.scanned.map((row) => row.qualifiedCount)).toEqual([5]);
    expect(resultWithout.scanned.map((row) => row.qualifiedCount)).toEqual([5]);
    expect(resultWith.scanned[0].instrument).toBe(BTC);
  });

  it('carries the 24h change percentage and last price from the ticker onto each row', async () => {
    const source = poolSource({ [BTC]: { '1D': 'flat' } });
    const result = await serviceFrom(source).scanShrink(params);
    const row = result.scanned.find((candidate) => candidate.instrument === BTC);
    expect(row?.lastPrice).toBe(100);
    expect(row?.change24h).toBe(1.5);
    expect(row?.quoteVolume24h).toBe(20_000_000_000);
  });

  it('includes a row on the coarse screen alone, and rejects a 1D trend even when a small timeframe converges', async () => {
    const source = poolSource({
      // BTC converges on 5m but its 1D trends → the coarse screen drops it, so
      // its 5m is never even requested.
      [BTC]: { '5m': 'strong' },
      // ETH is coarse-tight (narrow range, no drift) but converges NOWHERE.
      [ETH]: { '1D': 'flat' },
    });
    const result = await serviceFrom(source).scanShrink(params);

    expect(result.scanned.map((row) => row.instrument)).toEqual([ETH]);
    const row = result.scanned[0];
    expect(row.coarse?.pass).toBe(true);
    expect(row.coarse?.rangePct).toBeCloseTo(0.02, 10);
    expect(row.coarse?.netPct).toBeCloseTo(0, 10);
    // The position the absolute floor judges, echoed on the row (mid-series here).
    expect(row.coarse?.posRange).toBeCloseTo(0.5, 10);
    expect(row.convergedTimeframes).toEqual([]);
    expect(row.qualifiedCount).toBe(0);
    expect(row.bestScore).toBe(0);
    expect(row.qualified).toBe(true);
    expect(requestedTimeframes(source, BTC)).toEqual([COARSE_TIMEFRAME]);
  });

  it('drops a coin sitting on its series absolute bottom — even when a small timeframe converges', async () => {
    const source = poolSource({
      // BTC's 23-day window is the TIGHTEST box in the pool (2% range, zero drift),
      // so both pool-relative cuts admit it — but its 40-bar series dumped from 220
      // to 100 and its newest close is 101, i.e. it hugs the absolute bottom. Only
      // the ABSOLUTE position floor can reject it, and its converging 5m must not
      // buy it a row (that 5m is never requested either).
      [BTC]: { '5m': 'strong', '1D': 'bottom' },
      [ETH]: { '1D': 'flat' },
    });
    const result = await serviceFrom(source).scanShrink(params);

    expect(result.scanned.map((row) => row.instrument)).toEqual([ETH]);
    // The rejected coin paid exactly ONE request: the coarse timeframe.
    expect(requestedTimeframes(source, BTC)).toEqual([COARSE_TIMEFRAME]);
    expect(source.getCandlesticks).toHaveBeenCalledTimes(POOL_SIZE + 1 * (scanTimeframes.length - 1));
  });

  it('sorts by highest qualified level, then qualifiedCount desc, then bestScore desc', async () => {
    const source = poolSource({
      [BTC]: { '5m': 'strong', '15m': 'strong', '1H': 'strong', '4H': 'strong', '1D': 'strong' }, // all 5, strong
      [ETH]: { '5m': 'strong', '1D': 'flat' }, // 1 tf, strong
      [SOL]: { '5m': 'weak', '1D': 'flat' }, // 1 tf, weak
    });
    const service = serviceFrom(source);
    const result = await service.scanShrink(params);

    // BTC (up to 1D) first; ETH and SOL both converge on 5m only — same highest
    // level and same count, so ETH's strong band outscores SOL's weak one.
    expect(result.scanned.map((row) => row.instrument)).toEqual([BTC, ETH, SOL]);
    expect(result.scanned[0].qualifiedCount).toBe(5);
    expect(result.scanned[0].convergedTimeframes).toEqual(scanTimeframes);
    expect(result.scanned[1].convergedTimeframes).toEqual(['5m']);
    expect(result.scanned[2].convergedTimeframes).toEqual(['5m']);
    expect(result.scanned[1].bestScore).toBeGreaterThan(result.scanned[2].bestScore);
    expect(result.scanned[1].bestScore).toBeGreaterThan(0.85);
    expect(result.scanned[2].bestScore).toBeLessThan(0.7);
  });

  it('ranks a lone 1D convergence ahead of a coin converging on three small timeframes', async () => {
    const source = poolSource({
      // BTC only on 1D (score ≈ 0.51, just over the 1D threshold) — one timeframe.
      [BTC]: { '1D': 'mild' },
      // ETH on the three small timeframes, all strong — three timeframes.
      [ETH]: { '5m': 'strong', '15m': 'strong', '1H': 'strong', '1D': 'flat' },
    });
    const service = serviceFrom(source);
    const result = await service.scanShrink({ ...params, minScore: 0.6 });

    // The higher LEVEL wins over the higher COUNT: a daily-level contraction is
    // the earlier, rarer signal even when it is the coin's only timeframe.
    expect(result.scanned.map((row) => row.instrument)).toEqual([BTC, ETH]);
    expect(result.scanned[0].convergedTimeframes).toEqual(['1D']);
    expect(result.scanned[0].qualifiedCount).toBe(1);
    expect(result.scanned[0].bestScore).toBeLessThan(result.scanned[1].bestScore);
    expect(result.scanned[1].convergedTimeframes).toEqual(['5m', '15m', '1H']);
    expect(result.scanned[1].qualifiedCount).toBe(3);
  });

  it('sinks a coarse survivor that converges nowhere below every converging row', async () => {
    const source = poolSource({
      [BTC]: { '5m': 'strong', '1D': 'flat' },
      [ETH]: { '1D': 'flat' },
    });
    const result = await serviceFrom(source).scanShrink(params);

    expect(result.scanned.map((row) => row.instrument)).toEqual([BTC, ETH]);
    expect(result.scanned[1].qualifiedCount).toBe(0);
    expect(result.scanned[1].convergedTimeframes).toEqual([]);
  });

  it('judges each timeframe against its own effective threshold (single knob, larger levels more lenient)', async () => {
    const source = poolSource({ [BTC]: { '1D': 'mild', '4H': 'shallow' } });
    const service = serviceFrom(source);
    const result = await service.scanShrink({ ...params, minScore: 0.6 });

    expect(result.scanned).toHaveLength(1);
    const row = result.scanned[0];
    // Both bands ARE structures — the per-timeframe gate, not the detector,
    // decides: at minScore 0.6 the effective thresholds are 0.50 (1D) and 0.55
    // (4H), so the 1D band passes its bar while the 4H band misses its own.
    expect(row.structures['1D'].structure).toBe('convergence');
    expect(row.structures['1D'].score).toBeCloseTo(0.51, 2);
    expect(row.structures['4H'].structure).toBe('convergence');
    expect(row.structures['4H'].score).toBeCloseTo(0.44, 2);
    expect(row.convergedTimeframes).toEqual(['1D']);
    expect(row.qualifiedCount).toBe(1);
    // The 4H verdict is reported truthfully, it just does not count as converged.
    expect(row.structures['4H'].qualified).toBe(true);
  });

  it('clears only the levels whose own bar a mid-strength band reaches (the 4H offset is additive)', async () => {
    // Same 0.576 band served for EVERY timeframe: it is above the 4H bar (0.55)
    // and the 1D bar (0.50) but below the small timeframes' bar (0.60), so the
    // converged set is decided purely by the per-level offsets.
    const source = poolSource({ [BTC]: { '5m': 'mid', '15m': 'mid', '1H': 'mid', '4H': 'mid', '1D': 'mid' } });
    const result = await serviceFrom(source).scanShrink({ ...params, minScore: 0.6 });

    expect(result.scanned).toHaveLength(1);
    const row = result.scanned[0];
    for (const timeframe of scanTimeframes) {
      expect(row.structures[timeframe].score).toBeCloseTo(0.576, 2);
      expect(row.structures[timeframe].qualified).toBe(true);
    }
    // Removing the 4H offset (or reading `score >= minScore` per timeframe) drops
    // 4H from this set — that is what this case exists to catch.
    expect(row.convergedTimeframes).toEqual(['4H', '1D']);
    expect(row.qualifiedCount).toBe(2);
    expect(row.structures['5m'].score).toBeLessThan(0.6);
  });

  it('cannot be rescued by the 4H offset once the knob is raised past the shallow band', async () => {
    // Control for the threshold test above: the offset is a fixed -0.05, so a
    // shallow band leaves the converged set entirely as soon as the knob clears
    // it (the row itself survives — it is coarse-passing).
    const source = poolSource({ [BTC]: { '1D': 'flat', '4H': 'shallow' } });
    const strict = await serviceFrom(source).scanShrink({ ...params, minScore: 0.7 });
    const permissive = await serviceFrom(source).scanShrink({ ...params, minScore: 0.4 });

    expect(strict.scanned.map((row) => row.convergedTimeframes)).toEqual([[]]);
    expect(permissive.scanned.map((row) => row.convergedTimeframes)).toEqual([['4H']]);
  });

  it('filters out instruments below the minimum 24h quote volume before the coarse screen', async () => {
    const source = poolSource({ [BTC]: { '1D': 'flat' } });
    // tickersFor gives index i a volume of (20 - i)e9, so a 5e9 floor keeps 16.
    const result = await serviceFrom(source).scanShrink({ ...params, minQuoteVolume24h: 5e9 });

    expect(requestedInstruments(source)).toEqual(POOL.slice(0, 16));
    expect(result.coarse?.candidates).toBe(16);
    expect(result.coarse?.poolSize).toBe(16);
  });

  it('applies the minScore gate: weaker convergences are filtered out when the knob is raised', async () => {
    // BTC converges strongly (shrink depth ≈ 0.86), ETH weakly (≈ 0.41).
    const source = poolSource({
      [BTC]: { '5m': 'strong', '15m': 'strong', '1H': 'strong', '4H': 'strong', '1D': 'strong' },
      [ETH]: { '5m': 'weak', '1D': 'flat' },
    });
    const service = serviceFrom(source);
    const permissive = await service.scanShrink({ ...params, minScore: 0.4 });
    expect(permissive.scanned).toHaveLength(2);
    expect(permissive.scanned.find((row) => row.instrument === ETH)?.convergedTimeframes).toEqual(['5m']);

    // minScore 0.7 clears the weak band: ETH is still a coarse survivor (so its
    // row stays) but it converged nowhere.
    const strict = await service.scanShrink({ ...params, minScore: 0.7 });
    expect(strict.scanned.find((row) => row.instrument === ETH)?.convergedTimeframes).toEqual([]);
    expect(strict.scanned.find((row) => row.instrument === BTC)?.convergedTimeframes).toEqual(scanTimeframes);
  });

  it('applies a past anchor to every timeframe and echoes it in params', async () => {
    const source = poolSource({ [BTC]: { '5m': 'strong', '1D': 'flat' } });
    const pastAnchor = Date.parse('2026-08-04T00:00:00Z');
    const result = await serviceFrom(source).scanShrink({ ...params, anchor: pastAnchor });

    for (const timeframe of scanTimeframes) {
      expect(source.getCandlesticks).toHaveBeenCalledWith(expect.objectContaining({ anchor: pastAnchor, timeframe }));
    }
    expect(result.params.anchor).toBe(pastAnchor);
    expect(result.scanned.length).toBeGreaterThan(0);
  });

  it('reports one coin converging on multiple timeframes as a single row', async () => {
    // BTC converges on 5m and 1H, nothing elsewhere. One row carries both.
    const source = poolSource({ [BTC]: { '5m': 'strong', '1H': 'strong', '1D': 'flat' } });
    const result = await serviceFrom(source).scanShrink({ ...params });

    const row = result.scanned.find((candidate) => candidate.instrument === BTC)!;
    expect(result.scanned).toHaveLength(1);
    expect(row.convergedTimeframes).toEqual(['5m', '1H']);
    expect(row.qualifiedCount).toBe(2);
    expect(row.structures['5m'].structure).toBe('convergence');
    expect(row.structures['1H'].structure).toBe('convergence');
    expect(row.bestScore).toBeGreaterThan(0.85);
  });

  it('fills neutral zeros for timeframes without a convergence', async () => {
    const source = poolSource({ [BTC]: { '5m': 'strong', '1D': 'flat' } });
    const result = await serviceFrom(source).scanShrink(params);
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
    const service = new CoinScanService({ listTickers: vi.fn(async () => tickersFor()) }, { getCandlesticks });
    const result = await service.scanShrink(params);
    expect(result.scanned).toEqual([]);
    expect(result.qualifiedCount).toBe(0);
    // Nothing was measurable, so the percentile base is empty.
    expect(result.coarse?.poolSize).toBe(0);
    expect(result.coarse?.candidates).toBe(POOL_SIZE);
  });

  it('caps the pool when topN is given (上限保护, not a gate)', async () => {
    const source = poolSource({ [BTC]: { '1D': 'flat' }, [ETH]: { '1D': 'flat' }, [SOL]: { '1D': 'flat' } });
    const result = await serviceFrom(source).scanShrink({ ...params, topN: 5 });

    // Only the first five tickers were candidates — and the cap is echoed.
    expect(requestedInstruments(source)).toEqual(POOL.slice(0, 5));
    expect(result.coarse?.candidates).toBe(5);
    expect(result.params.topN).toBe(5);
  });

  it('discards stale rate-limit warnings and reports only those raised during the scan', async () => {
    const source = poolSource({ [BTC]: { '1D': 'flat' } });
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
  it('drops closed US equities before any candle request and never lets them take a slot', async () => {
    // Closed on a Saturday; the equities rank at the top of the pool by volume.
    const saturdayMs = Date.UTC(2026, 2, 14, 13, 30);
    const crypto: Ticker[] = [
      { instrument: BTC, quoteVolume24h: 800_000_000, lastPrice: 60000, change24h: -1 },
      { instrument: 'XAUUSDT', quoteVolume24h: 100_000_000, lastPrice: 4000, change24h: 1, marketClass: 'COMMODITY' },
    ];
    const universe = [
      { instrument: TSLA, quoteVolume24h: 2_000_000_000, lastPrice: 100, change24h: 1, marketClass: 'US_EQUITY' as const },
      { instrument: 'NVDAUSDT', quoteVolume24h: 1_900_000_000, lastPrice: 100, change24h: 1, marketClass: 'US_EQUITY' as const },
      ...crypto,
    ];
    const source = buildSource(universe, (instrument, timeframe) =>
      instrument === BTC ? 'flat' : timeframe === COARSE_TIMEFRAME ? 'trend' : 'none',
    );
    const service = serviceFrom(source);

    // Crypto sub-module: the equities are not even in this universe, so they are
    // never requested (and hold no slot in the 2-name crypto candidate pool).
    const cryptoResult = await service.scanShrink({ ...params, anchor: saturdayMs });
    expect(requestedInstruments(source).sort()).toEqual([BTC, 'XAUUSDT']);
    expect(cryptoResult.coarse?.candidates).toBe(2);
    expect(cryptoResult.skippedInstruments).toBeUndefined();

    // Equity sub-module: every equity is closed, so nothing is scanned, nothing is
    // requested, and all of them are reported as skipped.
    const closedEquities = equitySource();
    const equityResult = await serviceFrom(closedEquities).scanShrink({ ...params, scope: 'equity', anchor: saturdayMs });
    expect(equityResult.scanned).toEqual([]);
    expect(equityResult.skippedInstruments).toHaveLength(POOL_SIZE);
    expect(equityResult.skippedInstruments?.[0]).toBe(TSLA);
    expect(closedEquities.getCandlesticks).not.toHaveBeenCalled();
  });

  it('keeps US equities in the pool when their market is open', async () => {
    // Monday 2026-03-09 09:30 EDT.
    const mondayMs = Date.UTC(2026, 2, 9, 13, 30);
    const btc: Ticker = { instrument: BTC, quoteVolume24h: 800_000_000, lastPrice: 60000, change24h: -1 };
    const openEquities = equitySource();
    const cryptoSource = buildSource([btc, ...tickersFor(POOL.slice(1))], (instrument, timeframe) =>
      instrument === BTC ? 'flat' : timeframe === COARSE_TIMEFRAME ? 'trend' : 'none',
    );

    const equityResult = await serviceFrom(openEquities).scanShrink({ ...params, scope: 'equity', anchor: mondayMs });
    const cryptoResult = await serviceFrom(cryptoSource).scanShrink({ ...params, anchor: mondayMs });

    expect(equityResult.scanned.map((row) => row.instrument)).toEqual([TSLA]);
    expect(equityResult.skippedInstruments).toBeUndefined();
    expect(cryptoResult.scanned.map((row) => row.instrument)).toEqual([BTC]);
  });

  it('applies the same historical-weekend gating when the anchor is in the past', async () => {
    const saturdayMs = Date.UTC(2026, 2, 14, 13, 30);
    const source = equitySource();

    const result = await serviceFrom(source).scanShrink({ ...params, scope: 'equity', anchor: saturdayMs });

    expect(result.scanned).toEqual([]);
    expect(result.skippedInstruments?.[0]).toBe(TSLA);
    expect(source.getCandlesticks).not.toHaveBeenCalled();
  });

  it('leaves ungated tickers (absent marketClass) untouched and reports no skips', async () => {
    const saturdayMs = Date.UTC(2026, 2, 14, 13, 30);
    const source = poolSource({ [BTC]: { '1D': 'flat' } });

    const result = await serviceFrom(source).scanShrink({ ...params, anchor: saturdayMs });

    expect(result.scanned.map((row) => row.instrument)).toEqual([BTC]);
    expect(result.skippedInstruments).toBeUndefined();
  });
});

describe('CoinScanService (session-only candle series)', () => {
  it('never lets closed-market candles reach the detector (same data, equity vs crypto)', async () => {
    // Monday 2026-03-09 04:01 EDT — one minute after the pre-market open, so the
    // equity IS in the pool, while the whole 5m fixture (01:25-04:00 ET) sits in
    // the overnight window where it does not trade. 1D is the flat (non-shrinking)
    // band, so only the 5m timeframe carries a verdict at all.
    const anchor = Date.UTC(2026, 2, 9, 8, 1);
    const cryptoSource = buildSource(tickersFor([BTC, ...POOL.slice(1)]), (instrument, timeframe) =>
      instrument === BTC ? (timeframe === '5m' ? 'strong' : 'flat') : timeframe === COARSE_TIMEFRAME ? 'trend' : 'none',
    );
    const closedEquities = buildSource(EQUITY_POOL.map((instrument, index) => ({
      instrument,
      quoteVolume24h: (POOL_SIZE - index) * 1_000_000_000,
      lastPrice: 100,
      change24h: 1,
      marketClass: 'US_EQUITY' as const,
    })), (instrument, timeframe) =>
      instrument === TSLA ? (timeframe === '5m' ? 'strong' : 'flat') : timeframe === COARSE_TIMEFRAME ? 'trend' : 'none',
    );

    const cryptoResult = await serviceFrom(cryptoSource).scanShrink({ ...params, anchor });
    const equityResult = await serviceFrom(closedEquities).scanShrink({ ...params, scope: 'equity', anchor });

    // The identical candle series converges for crypto — and the SAME 5m verdict
    // is gone for the equity, because its candles sit in the closed overnight
    // window and are dropped before any detector sees them.
    expect(cryptoResult.scanned.map((row) => row.instrument)).toEqual([BTC]);
    expect(cryptoResult.scanned[0].convergedTimeframes).toEqual(['5m']);
    expect(equityResult.scanned.map((row) => row.instrument)).toEqual([TSLA]);
    expect(equityResult.scanned[0].convergedTimeframes).toEqual([]);
    expect(equityResult.skippedInstruments).toBeUndefined();
  });

  it('requests a wider raw window for session-gated instruments', async () => {
    const anchor = Date.UTC(2026, 2, 9, 15, 0); // Monday 11:00 EDT, mid-session
    const cryptoSource = buildSource(tickersFor([BTC, ...POOL.slice(1)]), (instrument, timeframe) =>
      instrument === BTC ? 'flat' : timeframe === COARSE_TIMEFRAME ? 'trend' : 'none',
    );
    const openEquities = equitySource();

    await serviceFrom(cryptoSource).scanShrink({ ...params, anchor });
    await serviceFrom(openEquities).scanShrink({ ...params, scope: 'equity', anchor });

    const limitsFor = (source: Source, instrument: string) => [
      ...new Set(source.getCandlesticks.mock.calls.filter(([request]) => request.instrument === instrument).map(([request]) => request.limit)),
    ];
    // 2x for the gated class (dropped closed-market bars are paid for up front),
    // unchanged for the 24/7 class.
    expect(limitsFor(openEquities, TSLA)).toEqual([200]);
    expect(limitsFor(cryptoSource, BTC)).toEqual([100]);
  });

  it('flags the response when the ticker snapshot carried no instrument classes', async () => {
    const source = poolSource({ [BTC]: { '1D': 'flat' } });
    const degraded = new CoinScanService(
      { listTickers: source.listTickers, metadataAvailable: () => false },
      { getCandlesticks: source.getCandlesticks },
    );

    const result = await degraded.scanShrink(params);

    // Without classes nothing is session-gated, so closed contracts would be
    // judged as crypto — the caller must be able to see that.
    expect(result.metadataUnavailable).toBe(true);
  });

  it('omits the metadata flag when classes are available', async () => {
    const source = poolSource({ [BTC]: { '1D': 'flat' } });
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
    { instrument: BTC, quoteVolume24h: 900_000_000, lastPrice: 60000, change24h: -1, marketClass: 'CRYPTO' },
    { instrument: 'XAUUSDT', quoteVolume24h: 800_000_000, lastPrice: 4000, change24h: 1, marketClass: 'COMMODITY' },
    { instrument: 'TSLAUSDT', quoteVolume24h: 700_000_000, lastPrice: 300, change24h: 2, marketClass: 'US_EQUITY' },
    { instrument: 'SAMSUNGUSDT', quoteVolume24h: 600_000_000, lastPrice: 180, change24h: 1, marketClass: 'KR_EQUITY' },
    { instrument: 'HK0700USDT', quoteVolume24h: 500_000_000, lastPrice: 430, change24h: 1, marketClass: 'HK_EQUITY' },
    { instrument: 'OPENAIUSDT', quoteVolume24h: 400_000_000, lastPrice: 1400, change24h: 1, marketClass: 'PRE_IPO' },
  ];

  function scopedSource() {
    return buildSource(universe, (_instrument, timeframe) =>
      timeframe === COARSE_TIMEFRAME ? 'flat' : 'strong',
    );
  }

  it('scans only crypto-class instruments in the crypto scope (the default)', async () => {
    const source = scopedSource();

    const result = await serviceFrom(source).scanShrink({ ...params, anchor: US_ANCHOR });

    expect(requestedInstruments(source).sort()).toEqual([BTC, 'XAUUSDT']);
    expect(result.coarse?.candidates).toBe(2);
    expect(result.params.scope).toBe('crypto');
    // Out-of-pool classes are a pool definition, not a runtime skip.
    expect(result.skippedInstruments).toBeUndefined();
  });

  it('scans only the equities whose market is open in the equity scope', async () => {
    // US and Korean sessions do not overlap (US 04:00-20:00 ET vs KR 09:00-15:30
    // KST), so each anchor can only ever contain one of them.
    const usSource = scopedSource();
    const krSource = scopedSource();

    const usOpen = await serviceFrom(usSource).scanShrink({ ...params, scope: 'equity', anchor: US_ANCHOR });
    const krOpen = await serviceFrom(krSource).scanShrink({ ...params, scope: 'equity', anchor: KR_ANCHOR });

    expect(requestedInstruments(usSource)).toEqual(['TSLAUSDT']);
    expect(requestedInstruments(krSource)).toEqual(['SAMSUNGUSDT']);
    expect(usOpen.skippedInstruments).toEqual(['SAMSUNGUSDT']);
    expect(krOpen.skippedInstruments).toEqual(['TSLAUSDT']);
  });

  it('keeps the two pools disjoint and their union equal to every scannable instrument', async () => {
    const cryptoSource = scopedSource();
    const usSource = scopedSource();
    const krSource = scopedSource();

    await serviceFrom(cryptoSource).scanShrink({ ...params, anchor: US_ANCHOR });
    await serviceFrom(usSource).scanShrink({ ...params, scope: 'equity', anchor: US_ANCHOR });
    await serviceFrom(krSource).scanShrink({ ...params, scope: 'equity', anchor: KR_ANCHOR });

    const cryptoPool = requestedInstruments(cryptoSource);
    const equityPool = [...requestedInstruments(usSource), ...requestedInstruments(krSource)];
    expect(cryptoPool.filter((instrument) => equityPool.includes(instrument))).toEqual([]);
    // The out-of-pool HK / pre-IPO contracts belong to neither sub-module.
    expect([...cryptoPool, ...equityPool].sort()).toEqual([BTC, 'SAMSUNGUSDT', 'TSLAUSDT', 'XAUUSDT']);
  });

  it('treats a third-party exchange instrument (no class) as crypto so a metadata outage still scans', async () => {
    // The whole 20-name pool carries no `marketClass` — exactly the degraded
    // metadata case (OKX, or Bitget's classification endpoint failing).
    const source = buildSource(tickersFor(), (instrument, timeframe) =>
      instrument === BTC ? 'flat' : timeframe === COARSE_TIMEFRAME ? 'trend' : 'none',
    );

    const result = await serviceFrom(source).scanShrink({ ...params, anchor: US_ANCHOR });

    expect(result.scanned.map((row) => row.instrument)).toEqual([BTC]);
    expect(result.skippedInstruments).toBeUndefined();
  });
});
