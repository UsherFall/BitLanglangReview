import { describe, expect, it, vi } from 'vitest';
import type { Candlestick } from '../src/domain/candlestick';
import { COARSE_TIMEFRAME, DEFAULT_COARSE_PARAMS, scanTimeframes, type ShrinkScanParams } from '../src/domain/coin-scan';
import type { ReviewTimeframe } from '../src/domain/trade';
import { timeframeMs } from '../src/server/candlestick-service';
import { CoinScanService } from '../src/server/coin-scan-service';
import { DrawingStore } from '../src/server/drawing-store';
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

/**
 * Wraps a source so the matching (instrument, timeframe) fetches REJECT, leaving
 * every other request on the original implementation. Used to prove a single
 * failed klines request is isolated to its own instrument instead of rejecting
 * `mapLimit`'s `Promise.all` and taking the whole scan with it.
 */
function sourceFailingOn(source: Source, fails: (instrument: string, timeframe: ReviewTimeframe) => boolean, error: Error): Source {
  const original = source.getCandlesticks.getMockImplementation();
  if (!original) throw new Error('source has no implementation to wrap');
  source.getCandlesticks.mockImplementation(async (request: CandleRequest) => {
    if (fails(request.instrument, request.timeframe)) throw error;
    return original(request);
  });
  return source;
}

/** The Bitget error string a stalled request produces (12s timeout, see `http.ts`). */
const TIMEOUT_ERROR = new Error('Bitget request failed: request timed out after 12s');

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

describe('CoinScanService (coarse screen → 距你标的线)', () => {
  it('fetches 1D for the whole pool and NO other timeframe when nobody drew a line', async () => {
    const source = poolSource({
      [BTC]: { '5m': 'strong', '15m': 'strong', '1H': 'strong', '4H': 'strong', '1D': 'strong' },
      [ETH]: { '5m': 'strong', '1H': 'strong', '1D': 'flat' },
    });
    await serviceFrom(source).scanShrink(params);

    // Every candidate pays exactly one request (the coarse timeframe)...
    expect([...requestedInstruments(source)].sort()).toEqual([...POOL].sort());
    for (const instrument of POOL) {
      expect(requestedTimeframes(source, instrument)).toEqual([COARSE_TIMEFRAME]);
    }
    // 10/20: the other four timeframes are fetched ONLY for instruments the user
    // drew a line on. With no lines at all, the scan costs one request per coin.
    expect(source.getCandlesticks).toHaveBeenCalledTimes(POOL_SIZE);
  });

  it('fetches a second timeframe ONLY for the instruments that drew a line on it', async () => {
    const store = new DrawingStore(':memory:');
    store.saveDrawing({
      tradeId: null,
      instrument: BTC,
      timeframe: '5m',
      kind: 'horizontal',
      points: [{ time: 1, price: 100 }],
    });
    const source = poolSource({
      [BTC]: { '5m': 'strong', '1D': 'strong' },
      [ETH]: { '5m': 'strong', '1D': 'flat' },
    });
    const service = new CoinScanService(
      { listTickers: source.listTickers },
      { getCandlesticks: source.getCandlesticks },
      undefined,
      store,
    );
    await service.scanShrink(params);

    // BTC has a 5m line → 5m was fetched for it. ETH has none → 5m untouched.
    expect(requestedTimeframes(source, BTC)).toContain('5m');
    expect(requestedTimeframes(source, ETH)).toEqual([COARSE_TIMEFRAME]);
    store.close();
  });

  it('fetches each (coin, timeframe) with a uniform window for every timeframe', async () => {
    const source = poolSource({ [BTC]: { '5m': 'strong', '15m': 'strong', '1H': 'strong', '4H': 'strong', '1D': 'strong' } });
    await serviceFrom(source).scanShrink(params);

    // Without lines only the coarse timeframe is requested, and it uses the
    // same uniform window as every other request would.
    expect(source.getCandlesticks).toHaveBeenCalledWith(
      expect.objectContaining({ timeframe: COARSE_TIMEFRAME, limit: 100, direction: 'earlier', anchor: expect.any(Number), refresh: true }),
    );
  });

  it('carries the 24h change percentage and last price from the ticker onto each row', async () => {
    const source = poolSource({ [BTC]: { '1D': 'flat' } });
    const result = await serviceFrom(source).scanShrink(params);
    const row = result.scanned.find((candidate) => candidate.instrument === BTC);
    expect(row?.lastPrice).toBe(100);
    expect(row?.change24h).toBe(1.5);
    expect(row?.quoteVolume24h).toBe(20_000_000_000);
  });

  it('drops a coin sitting on its series absolute bottom — even when a small timeframe is drawn on', async () => {
    const source = poolSource({
      // BTC's 23-day window is the TIGHTEST box in the pool (2% range, zero drift),
      // so both pool-relative cuts admit it — but its 40-bar series dumped from 220
      // to 100 and its newest close is 101, i.e. it hugs the absolute bottom. Only
      // the ABSOLUTE position floor can reject it, and a drawn 5m line must not
      // buy it a row.
      [BTC]: { '5m': 'strong', '1D': 'bottom' },
      [ETH]: { '1D': 'flat' },
    });
    const result = await serviceFrom(source).scanShrink(params);

    expect(result.scanned.map((row) => row.instrument)).toEqual([ETH]);
    // The rejected coin paid exactly ONE request: the coarse timeframe.
    expect(requestedTimeframes(source, BTC)).toEqual([COARSE_TIMEFRAME]);
    expect(source.getCandlesticks).toHaveBeenCalledTimes(POOL_SIZE);
  });

  it('filters out instruments below the minimum 24h quote volume before the coarse screen', async () => {
    const source = poolSource({ [BTC]: { '1D': 'flat' } });
    // tickersFor gives index i a volume of (20 - i)e9, so a 5e9 floor keeps 16.
    const result = await serviceFrom(source).scanShrink({ ...params, minQuoteVolume24h: 5e9 });

    expect(requestedInstruments(source)).toEqual(POOL.slice(0, 16));
    expect(result.coarse?.candidates).toBe(16);
    expect(result.coarse?.poolSize).toBe(16);
  });

  it('applies a past anchor to every request and echoes it in params', async () => {
    const source = poolSource({ [BTC]: { '5m': 'strong', '1D': 'flat' } });
    const pastAnchor = Date.parse('2026-08-04T00:00:00Z');
    const result = await serviceFrom(source).scanShrink({ ...params, anchor: pastAnchor });

    for (const call of source.getCandlesticks.mock.calls) {
      expect(call[0]).toEqual(expect.objectContaining({ anchor: pastAnchor }));
    }
    expect(result.params.anchor).toBe(pastAnchor);
    expect(result.scanned.length).toBeGreaterThan(0);
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
      { takeWarnings: () => warnings.splice(0), reason: () => null },
    );
    // A warning left over from an earlier scan is dropped...
    warnings.push('stale');
    const resultPromise = service.scanShrink(params);
    // ...while one raised mid-scan is surfaced on the response.
    warnings.push('币安限频(HTTP 429)，已自动退避 10 秒');
    const result = await resultPromise;
    expect(result.warnings).toEqual(['币安限频(HTTP 429)，已自动退避 10 秒']);
  });

  // -------------------------------------------------------------------------
  // Fetch-failure isolation (10/13).
  //
  // One timed-out klines request used to reject `mapLimit`'s `Promise.all`,
  // which threw out of `scanShrink` and surfaced as a 502 — the UI then showed
  // only "扫描失败" and every already-scanned row was lost. The three failures
  // below are asserted separately because they have DIFFERENT answers: a stage-1
  // failure is absorbed by the existing "no measure" path, a stage-2 failure
  // drops the row outright, and an IP ban must still stop everything.
  // -------------------------------------------------------------------------

  it('isolates a stage-1 fetch failure to its own instrument and keeps the rest of the scan intact', async () => {
    const shapes = { [BTC]: { '1D': 'flat' }, [ETH]: { '1D': 'flat' }, [SOL]: { '1D': 'flat' } } as const;
    const control = await serviceFrom(poolSource(shapes)).scanShrink(params);
    // Sanity: the three subjects are the screen's survivors, so dropping one of
    // them is observable — and a clean run carries NO failure list at all.
    expect(control.scanned.map((row) => row.instrument)).toEqual([BTC, ETH, SOL]);
    expect(control.failedInstruments).toBeUndefined();

    const source = sourceFailingOn(poolSource(shapes), (instrument) => instrument === BTC, TIMEOUT_ERROR);
    const result = await serviceFrom(source).scanShrink(params);

    // The scan still RESOLVES: the other survivors are the control's rows minus
    // BTC, not an empty list.
    expect(result.scanned.map((row) => row.instrument)).toEqual([ETH, SOL]);
    expect(result.scanned[0]?.levelAlerts).toEqual(control.scanned[1]?.levelAlerts);
    expect(result.coarse?.candidates).toBe(POOL_SIZE);
    // An unmeasurable candidate leaves the percentile base, exactly like a short
    // history — the failed fetch is not a third kind of pool member.
    expect(result.coarse?.poolSize).toBe(POOL_SIZE - 1);
    expect(result.failedInstruments).toEqual([BTC]);
  });

  it('drops the whole row when a line-timeframe fetch fails, rather than judging it on partial data', async () => {
    const store = new DrawingStore(':memory:');
    store.saveDrawing({
      tradeId: null,
      instrument: BTC,
      timeframe: '4H',
      kind: 'horizontal',
      points: [{ time: 1, price: 100 }],
    });
    const source = poolSource({
      [BTC]: { '5m': 'strong', '15m': 'strong', '1H': 'strong', '4H': 'strong', '1D': 'flat' },
      [ETH]: { '5m': 'strong', '15m': 'strong', '1H': 'strong', '4H': 'strong', '1D': 'flat' },
    } as const);
    const service = new CoinScanService(
      { listTickers: source.listTickers },
      { getCandlesticks: source.getCandlesticks },
      undefined,
      store,
    );
    const control = await service.scanShrink(params);
    expect(control.scanned.map((row) => row.instrument)).toEqual([BTC, ETH]);

    const failing = sourceFailingOn(
      poolSource({
        [BTC]: { '5m': 'strong', '15m': 'strong', '1H': 'strong', '4H': 'strong', '1D': 'flat' },
        [ETH]: { '5m': 'strong', '15m': 'strong', '1H': 'strong', '4H': 'strong', '1D': 'flat' },
      } as const),
      (instrument, timeframe) => instrument === BTC && timeframe === '4H',
      TIMEOUT_ERROR,
    );
    const failed = await new CoinScanService(
      { listTickers: failing.listTickers },
      { getCandlesticks: failing.getCandlesticks },
      undefined,
      store,
    ).scanShrink(params);

    // The coin whose 4H fetch failed loses its row rather than reporting a
    // half-measured alert.
    expect(failed.scanned.map((row) => row.instrument)).toEqual([ETH]);
    expect(failed.failedInstruments).toEqual([BTC]);
    store.close();
  });

  it('aborts the whole scan when the IP was banned (HTTP 418), instead of skipping the instrument', async () => {
    // Every request fails, so a per-instrument policy alone would turn a ban
    // into "scan succeeded with an empty result" — the one outcome that must
    // NOT happen, because firing more requests prolongs the ban.
    const source = sourceFailingOn(poolSource({ [BTC]: { '1D': 'flat' } }), () => true, new Error('HTTP 418 (IP auto-banned)'));
    const service = new CoinScanService(
      { listTickers: source.listTickers },
      { getCandlesticks: source.getCandlesticks },
      { takeWarnings: () => [], reason: () => '418' },
    );

    await expect(service.scanShrink(params)).rejects.toThrow('HTTP 418');
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

    // The identical candle series is scanned for crypto — and the equity's
    // closed overnight candles are dropped before the series is measured, so the
    // equity row carries no 距线 while the crypto one does.
    expect(cryptoResult.scanned.map((row) => row.instrument)).toEqual([BTC]);
    expect(equityResult.scanned.map((row) => row.instrument)).toEqual([TSLA]);
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

describe('CoinScanService · 距线的匹配与价位换算（10/21）', () => {
  it('OKX 名的线能匹配到 base+USDT 的扫描行', async () => {
    // 修复前：线存的是画线那张图的 instrument（交割单复盘 = OKX 名），扫描池是
    // Bitget/Binance 名，按名字精确匹配一根都对不上 → 距线永远是 `—`。
    const store = new DrawingStore(':memory:');
    store.saveDrawing({
      tradeId: null,
      instrument: 'BTC-USDT-SWAP',
      timeframe: '5m',
      kind: 'horizontal',
      points: [{ time: 1, price: 100 }],
    });
    const source = poolSource({
      [BTC]: { '5m': 'strong', '1D': 'strong' },
      [ETH]: { '5m': 'strong', '1D': 'flat' },
    });
    const result = await new CoinScanService(
      { listTickers: source.listTickers },
      { getCandlesticks: source.getCandlesticks },
      undefined,
      store,
    ).scanShrink(params);

    const btc = result.scanned.find((row) => row.instrument === BTC);
    expect(btc?.levelAlerts['5m']).not.toBeNull();
    expect(btc?.levelAlerts['5m']?.distancePct).toBeCloseTo(0, 6);
    store.close();
  });

  it('基准价齐全时线价被换算到扫描源的坐标系', async () => {
    // 线画在价格为 100 的坐标系里；扫描源的同一时刻收盘价是 101 → 因子 1.01，
    // 线价 100 要先变成 101 再算距线（否则差 1%）。
    const store = new DrawingStore(':memory:');
    const anchor = 1_700_000_000_000;
    store.saveDrawing({
      tradeId: null,
      instrument: BTC,
      timeframe: '1D',
      kind: 'horizontal',
      points: [{ time: 1, price: 100 }],
      refPrice: 100,
      refTime: anchor - timeframeMs('1D'),
    });
    const source = poolSource({ [BTC]: { '1D': 'flat' } });
    const result = await new CoinScanService(
      { listTickers: source.listTickers },
      { getCandlesticks: source.getCandlesticks },
      undefined,
      store,
    ).scanShrink({ ...params, anchor });

    const btc = result.scanned.find((row) => row.instrument === BTC);
    // flatBars 的收盘价是 100，与 refPrice 相同 → 因子 1，距线 0%。
    expect(btc?.levelAlerts['1D']?.distancePct).toBeCloseTo(0, 6);
    store.close();
  });

  it('没有基准价的旧线照常测量（因子 1），并说明退化原因', async () => {
    const store = new DrawingStore(':memory:');
    store.saveDrawing({
      tradeId: null,
      instrument: BTC,
      timeframe: '1D',
      kind: 'horizontal',
      points: [{ time: 1, price: 100 }],
    });
    const source = poolSource({ [BTC]: { '1D': 'flat' } });
    const result = await new CoinScanService(
      { listTickers: source.listTickers },
      { getCandlesticks: source.getCandlesticks },
      undefined,
      store,
    ).scanShrink(params);

    const btc = result.scanned.find((row) => row.instrument === BTC);
    expect(btc?.levelAlerts['1D']).not.toBeNull();
    expect(result.levelScaleNotes?.length).toBeGreaterThan(0);
    store.close();
  });
});
