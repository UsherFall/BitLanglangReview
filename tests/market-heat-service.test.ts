import { describe, expect, it, vi } from 'vitest';
import type { Candlestick } from '../src/domain/candlestick';
import type { Ticker } from '../src/server/market-data';
import { MarketHeatService } from '../src/server/market-heat-service';

const STEP = 15 * 60 * 1000;
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
function candlesFor(instrument: string, changePct: number, anchor: number): Candlestick[] {
  const close = 100;
  const candles: Candlestick[] = [];
  for (let i = 0; i < 100; i += 1) {
    const isLast = i === 99;
    candles.push({
      instrument,
      timeframe: '15m',
      timestamp: anchor - STEP * (100 - i),
      open: close,
      high: close,
      low: close,
      close: isLast ? close * (1 + changePct / 100) : close,
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
  warnings?: string[];
  onFetch?: (instrument: string) => void;
  /** Append the anchor's own (still-forming) bar, as the sources now may. */
  anchorBar?: boolean;
}) {
  const warnings = options.warnings ?? [];
  const getCandlesticks = vi.fn(async ({ instrument, anchor }: { instrument: string; anchor: number }) => {
    options.onFetch?.(instrument);
    if (options.noData?.includes(instrument)) return [];
    const candles = candlesFor(instrument, options.changes?.[instrument] ?? 0, anchor);
    if (options.anchorBar) {
      candles.push({ instrument, timeframe: '15m', timestamp: anchor, open: 100, high: 100, low: 100, close: 100, volume: 10 });
    }
    return candles;
  });
  const service = new MarketHeatService(
    { listTickers: vi.fn(async () => options.tickers) },
    { getCandlesticks },
    { takeWarnings: () => warnings.splice(0) },
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
    expect(getCandlesticks).toHaveBeenCalledTimes(10);
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
    expect(result.warnings).toEqual(['币安限频(HTTP 429)，已自动退避 10 秒']);
  });
});
