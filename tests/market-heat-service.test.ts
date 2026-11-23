import { describe, expect, it, vi } from 'vitest';
import type { Candlestick } from '../src/domain/candlestick';
import type { Ticker } from '../src/server/market-data';
import { MarketHeatService } from '../src/server/market-heat-service';

const STEP = 15 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
// Wednesday 2024-06-12 04:00 UTC — crypto/commodity always open, US equities open.
const ANCHOR = Date.UTC(2024, 5, 12, 4, 0, 0);
// Saturday 2024-06-15 — US equities closed.
const SATURDAY = Date.UTC(2024, 5, 15, 4, 0, 0);

function ticker(instrument: string, quoteVolume24h = 1e9, marketClass?: Ticker['marketClass']): Ticker {
  return { instrument, quoteVolume24h, lastPrice: 100, change24h: 0, marketClass };
}

/**
 * 100 ascending 15m candles ending just before `anchor`: closes are constant
 * except the last one, which lands on `changePct` away from the reference so the
 * computed 24h change equals `changePct` (up to float noise).
 */
function candlesFor(instrument: string, changePct: number, anchor: number, barRangePct = 0): Candlestick[] {
  const close = 100;
  const candles: Candlestick[] = [];
  for (let i = 0; i < 100; i += 1) {
    const isLast = i === 99;
    candles.push({
      instrument,
      timeframe: '15m',
      timestamp: anchor - STEP * (100 - i),
      open: close,
      high: close * (1 + barRangePct / 200),
      low: close * (1 - barRangePct / 200),
      close: isLast ? close * (1 + changePct / 100) : close,
      volume: 10,
    });
  }
  return candles;
}

/** Twenty completed daily bars with deterministic quote volume and range. */
function dailyCandlesFor(instrument: string, anchor: number): Candlestick[] {
  const candles: Candlestick[] = [];
  for (let i = 0; i < 20; i += 1) {
    const timestamp = anchor - (20 - i) * DAY;
    candles.push({
      instrument,
      timeframe: '1D',
      timestamp,
      open: 100,
      high: 110,
      low: 90,
      close: 100,
      volume: 10,
    });
  }
  return candles;
}

/** Builds a service whose candle source maps each instrument to a change %. */
function buildService(options: {
  tickers: Ticker[];
  changes?: Record<string, number>;
  noData?: string[];
  noBaselineData?: string[];
  barRangePct?: number;
  dailyGrid?: 'utc' | 'shanghai';
  warnings?: string[];
  onFetch?: (instrument: string) => void;
  /** Append the anchor's own (still-forming) bar, as the sources now may. */
  anchorBar?: boolean;
}) {
  const warnings = options.warnings ?? [];
  const getCandlesticks = vi.fn(async ({ instrument, anchor, timeframe }: { instrument: string; anchor: number; timeframe: string }) => {
    options.onFetch?.(instrument);
    if (timeframe === '1D') {
      return options.noBaselineData?.includes(instrument) ? [] : dailyCandlesFor(instrument, anchor);
    }
    if (options.noData?.includes(instrument)) return [];
    const candles = candlesFor(instrument, options.changes?.[instrument] ?? 0, anchor, options.barRangePct);
    if (options.anchorBar) {
      candles.push({ instrument, timeframe: '15m', timestamp: anchor, open: 100, high: 100, low: 100, close: 100, volume: 10 });
    }
    return candles;
  });
  const service = new MarketHeatService(
    { listTickers: vi.fn(async () => options.tickers) },
    { getCandlesticks },
    { takeWarnings: () => warnings.splice(0) },
    options.dailyGrid,
  );
  return { service, getCandlesticks };
}

describe('MarketHeatService.computeHeat', () => {
  it('classifies a broad, strongly-up pool as hot and splits gainers/losers', async () => {
    const changes: Record<string, number> = {
      BTCUSDT: 2,
      ETHUSDT: 1.5,
      XRPUSDT: 1.1,
      DOGEUSDT: 1.1,
      LTCUSDT: 1.1,
      ADAUSDT: 1.1,
      LINKUSDT: 1.05,
      SOLUSDT: 1.05,
      ATOMUSDT: -0.5,
      NEARUSDT: -0.6,
    };
    const tickers = Object.keys(changes).map((instrument) => ticker(instrument));
    const { service, getCandlesticks } = buildService({ tickers, changes });
    const result = await service.computeHeat({ anchor: ANCHOR });

    expect(result.tier).toBe('hot');
    expect(result.stats.poolSize).toBe(10);
    expect(result.stats.coveredCount).toBe(10);
    expect(result.stats.medianChangePct).toBeCloseTo(1.1, 5);
    expect(result.stats.upCount).toBe(8);
    expect(result.stats.downCount).toBe(2);
    expect(result.stats.volatileCount).toBe(0);
    expect(result.skipped).toMatchObject({ closedCount: 0, noDataCount: 0, unmappedReviewInstrument: false });
    // Gainers are the strictly-up coins sorted desc; losers the strictly-down asc.
    expect(result.topGainers[0]?.instrument).toBe('BTCUSDT');
    expect(result.topGainers).toHaveLength(8);
    expect(result.topLosers[0]?.instrument).toBe('NEARUSDT');
    expect(result.topLosers).toHaveLength(2);
    expect(getCandlesticks).toHaveBeenCalledTimes(20);
  });

  it('computes relative activity from rolling 24h and the 20-day baseline', async () => {
    const tickers = [ticker('BTCUSDT')];
    const { service } = buildService({ tickers, changes: { BTCUSDT: 0 }, barRangePct: 2 });
    const result = await service.computeHeat({ anchor: ANCHOR });
    const row = result.activityCandidates?.[0];

    // 97 bars including the reference candle × 100×10 quote = 97,000; daily baseline = 1,000.
    expect(row?.quoteVolumeRatio20d).toBeCloseTo(97, 6);
    // 24h range 2% / daily baseline range 20% = 0.1.
    expect(row?.rangeRatio20d).toBeCloseTo(0.1, 6);
    expect(row?.activityScore).toBeCloseTo(Math.sqrt(97 * 0.1), 6);
    expect(row?.recent4hVolumeIntensity).toBeCloseTo(1, 6);
  });

  it('floors intraday and UTC daily fetch anchors without changing the heat anchor', async () => {
    const tickers = [ticker('BTCUSDT')];
    const { service, getCandlesticks } = buildService({ tickers });
    const anchor = ANCHOR + 7 * 60 * 1000;
    await service.computeHeat({ anchor });

    const intraday = getCandlesticks.mock.calls.find(([call]) => call.timeframe === '15m');
    const daily = getCandlesticks.mock.calls.find(([call]) => call.timeframe === '1D');
    expect(intraday?.[0].anchor).toBe(ANCHOR);
    expect(daily?.[0].anchor).toBe(Date.UTC(2024, 5, 12));
  });

  it('uses the Shanghai daily grid when the source requires it', async () => {
    const tickers = [ticker('BTC-USDT-SWAP')];
    const { service, getCandlesticks } = buildService({ tickers, dailyGrid: 'shanghai' });
    const anchor = ANCHOR + 7 * 60 * 1000;
    await service.computeHeat({ anchor });

    const daily = getCandlesticks.mock.calls.find(([call]) => call.timeframe === '1D');
    expect(daily?.[0].anchor).toBe(Date.UTC(2024, 5, 11, 16));
  });

  it('keeps the Top80 market reading separate from the Top120 activity universe', async () => {
    const tickers = Array.from({ length: 85 }, (_, index) => ticker(`COIN${index}USDT`));
    const { service } = buildService({ tickers });
    const result = await service.computeHeat({ anchor: ANCHOR });

    expect(result.stats.poolSize).toBe(80);
    expect(result.stats.coveredCount).toBe(80);
    expect(result.activityPoolSize).toBe(120);
    expect(result.activityCandidates).toHaveLength(85);
  });

  it('returns null activity metrics when the 20-day baseline is unavailable', async () => {
    const tickers = [ticker('BTCUSDT')];
    const { service } = buildService({ tickers, noBaselineData: ['BTCUSDT'] });
    const result = await service.computeHeat({ anchor: ANCHOR });

    expect(result.stats.coveredCount).toBe(1);
    expect(result.activityCandidates?.[0]).toMatchObject({
      quoteVolumeRatio20d: null,
      rangeRatio20d: null,
      activityScore: null,
    });
  });

  it('drops session-closed TradFi pool members at the anchor and reports them', async () => {
    const tickers = [ticker('BTCUSDT', 1e9), ticker('XAUUSDT', 2e9), ticker('TSLAUSDT', 3e9, 'US_EQUITY')];
    const { service, getCandlesticks } = buildService({ tickers, changes: { BTCUSDT: 1, XAUUSDT: 0.5 } });
    const result = await service.computeHeat({ anchor: SATURDAY, poolTopN: 10 });

    expect(result.skipped.closedCount).toBe(1);
    expect(result.stats.poolSize).toBe(2);
    expect(getCandlesticks.mock.calls.map(([call]) => call.instrument)).not.toContain('TSLAUSDT');
    // 2/2 covered coins up, median (0.5 + 1)/2 = 0.75 → breadth up only → warm.
    expect(result.tier).toBe('warm');
  });

  it('keeps out-of-scope classes out of the pool without counting them as closed', async () => {
    // Hong Kong / A-share / pre-IPO instruments are not part of the scan pool, so
    // they are not part of the 场子 reading either — and they are a pool
    // definition, not a session skip.
    const tickers = [
      ticker('BTCUSDT', 1e9),
      ticker('HK0700USDT', 3e9, 'HK_EQUITY'),
      ticker('CXMTUSDT', 2.5e9, 'CN_EQUITY'),
      ticker('OPENAIUSDT', 2e9, 'PRE_IPO'),
    ];
    const { service, getCandlesticks } = buildService({ tickers, changes: { BTCUSDT: 1 } });
    const result = await service.computeHeat({ anchor: ANCHOR, poolTopN: 10 });

    expect(result.skipped.closedCount).toBe(0);
    expect(result.stats.poolSize).toBe(1);
    expect(getCandlesticks.mock.calls.map(([call]) => call.instrument)).toEqual(['BTCUSDT', 'BTCUSDT']);
  });

  it('drops the anchor bar instead of degrading the instrument to no-data', async () => {
    const tickers = [ticker('BTCUSDT', 1e9)];
    // The source now hands back the anchor's own bar (OKX always did; Binance
    // does since `earlier` includes the anchor bar). It must be filtered out,
    // not treated as an incomplete-history skip.
    const { service } = buildService({ tickers, changes: { BTCUSDT: 1 }, anchorBar: true });
    const result = await service.computeHeat({ anchor: ANCHOR });

    expect(result.stats.coveredCount).toBe(1);
    expect(result.skipped.noDataCount).toBe(0);
    expect(result.stats.medianChangePct).toBeCloseTo(1, 5);
  });

  it('skips members whose history does not reach 24h back as no-data', async () => {
    const tickers = [ticker('BTCUSDT', 1e9), ticker('NEWUSDT', 1e9)];
    const { service } = buildService({ tickers, changes: { BTCUSDT: 1 }, noData: ['NEWUSDT'] });
    const result = await service.computeHeat({ anchor: ANCHOR });

    expect(result.stats.coveredCount).toBe(1);
    expect(result.skipped.noDataCount).toBe(1);
    expect(result.reviewCoin).toBeNull();
    expect(result.tier).toBe('hot'); // 1/1 covered up, median +1
  });

  it('forces the reviewed coin into the pool and flags its row', async () => {
    // Pool slicing assumes a volume-desc-sorted ticker list (the contract of
    // Binance/OKX ticker sources), so ETHUSDT (higher volume) is listed first.
    const tickers = [ticker('ETHUSDT', 2e9), ticker('BTCUSDT', 1e9)];
    const { service, getCandlesticks } = buildService({
      tickers,
      changes: { ETHUSDT: 0.5, SOLUSDT: 3 },
    });
    const result = await service.computeHeat({ anchor: ANCHOR, reviewInstrument: 'SOL-USDT-SWAP', poolTopN: 1 });

    expect(result.skipped.unmappedReviewInstrument).toBe(false);
    expect(result.reviewCoin?.instrument).toBe('SOLUSDT');
    expect(result.reviewCoin?.changePct).toBeCloseTo(3, 5);
    expect(result.reviewCoin?.isReviewCoin).toBe(true);
    const requested = getCandlesticks.mock.calls.map(([call]) => call.instrument);
    expect(requested).toContain('SOLUSDT');
    expect(requested).not.toContain('BTCUSDT'); // dropped from the top-1 pool
    expect(result.stats.coveredCount).toBe(2);
  });

  it('reports an unmapped review symbol without failing', async () => {
    const tickers = [ticker('BTCUSDT', 1e9)];
    const { service } = buildService({ tickers, changes: { BTCUSDT: 1 } });
    const result = await service.computeHeat({ anchor: ANCHOR, reviewInstrument: 'FOO' });

    expect(result.skipped.unmappedReviewInstrument).toBe(true);
    expect(result.reviewCoin).toBeNull();
    expect(result.stats.coveredCount).toBe(1);
  });

  it('memoizes rows per anchor so the same anchor does not refetch the pool', async () => {
    const tickers = [ticker('BTCUSDT', 1e9), ticker('ETHUSDT', 2e9)];
    const { service, getCandlesticks } = buildService({ tickers, changes: { BTCUSDT: 1, ETHUSDT: 0.5 } });
    await service.computeHeat({ anchor: ANCHOR });
    const firstCount = getCandlesticks.mock.calls.length;
    await service.computeHeat({ anchor: ANCHOR });
    expect(getCandlesticks.mock.calls.length).toBe(firstCount);

    // A different anchor needs the pool again.
    await service.computeHeat({ anchor: ANCHOR + 2 * 24 * 60 * 60 * 1000 });
    expect(getCandlesticks.mock.calls.length).toBeGreaterThan(firstCount);
  });

  it('surfaces rate-limit warnings raised during computation', async () => {
    const warnings: string[] = [];
    const tickers = [ticker('BTCUSDT', 1e9)];
    const { service } = buildService({
      tickers,
      changes: { BTCUSDT: 1 },
      warnings,
      onFetch: () => warnings.push('币安限频(HTTP 429)，已自动退避 10 秒'),
    });
    const result = await service.computeHeat({ anchor: ANCHOR });
    expect(result.warnings).toEqual(['币安限频(HTTP 429)，已自动退避 10 秒', '币安限频(HTTP 429)，已自动退避 10 秒']);
  });
});
