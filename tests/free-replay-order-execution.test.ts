import { describe, expect, it, vi } from 'vitest';
import { timeframeMs, type Candlestick } from '../src/domain/candlestick';
import type { ReviewTimeframe } from '../src/domain/trade';
import {
  hasAutomaticOrders,
  loadPartialExecutionCandles,
  needsPartialExecution,
  partialExecutionTimeframe,
  processExecutionCandles,
  type ExecutionCandleLoader,
} from '../src/ui/free-replay-order-execution';
import {
  initialPaperTradingSession,
  openMarket,
  placeEntryLimit,
  placeExitLimit,
  placeStopLoss,
  startPaperTrading,
  type PaperTradingSession,
} from '../src/ui/free-replay-paper-trading';

const FROM = 1616744700; // 2021-03-26 07:45Z
const TO = 1616745600; // 2021-03-26 08:00Z

function candle(timestamp: number, timeframe: ReviewTimeframe, overrides: Partial<Candlestick> = {}): Candlestick {
  return {
    instrument: 'BTCUSDT', timeframe, timestamp,
    open: 100, high: 110, low: 90, close: 105, volume: 1,
    ...overrides,
  };
}

function opened(direction: 'long' | 'short' = 'long'): PaperTradingSession {
  return openMarket(
    startPaperTrading(initialPaperTradingSession(), 1),
    candle(0, '15m', { open: 100, high: 100, low: 100, close: 100 }),
    { direction, positionRatioPercent: 100, leverage: 1 },
    1,
  );
}

describe('Free Replay order execution boundary', () => {
  it('detects automatic orders without treating an unprotected position as one', () => {
    expect(hasAutomaticOrders(initialPaperTradingSession())).toBe(false);
    expect(hasAutomaticOrders(opened())).toBe(false);
    const long = opened();
    const stopped = placeStopLoss(long, long.position!.legs[0]!.id, 95, 100, 1);
    expect(hasAutomaticOrders(stopped)).toBe(true);
    const pendingEntry = placeEntryLimit(startPaperTrading(initialPaperTradingSession(), 1), 95, { direction: 'long', positionRatioPercent: 100, leverage: 1 }, 1);
    expect(hasAutomaticOrders(pendingEntry)).toBe(true);
    expect(hasAutomaticOrders(placeExitLimit(long, 105, 5, 1))).toBe(true);
    expect(hasAutomaticOrders({ ...stopped, active: false })).toBe(false);
  });

  it('detects only coarse candles that contain already-revealed progress', () => {
    expect(needsPartialExecution(candle(FROM * 1000 - 3_600_000, '1H'), FROM)).toBe(true);
    expect(needsPartialExecution(candle(FROM * 1000, '15m'), FROM)).toBe(false);
    expect(needsPartialExecution(candle(FROM * 1000 + 900_000, '15m'), FROM)).toBe(false);
  });

  it('chooses the coarsest child timeframe aligned to both execution boundaries', () => {
    expect(partialExecutionTimeframe({ previousProgressTime: FROM, nextProgressTime: TO, timeframe: '1H', grid: 'shanghai' })).toBe('15m');
    expect(partialExecutionTimeframe({ previousProgressTime: FROM + 300, nextProgressTime: TO, timeframe: '1H', grid: 'shanghai' })).toBe('5m');
    expect(partialExecutionTimeframe({ previousProgressTime: FROM + 60, nextProgressTime: TO, timeframe: '1H', grid: 'shanghai' })).toBe('1m');

    const fourHour = Date.parse('2024-05-21T00:00:00Z') / 1000;
    expect(partialExecutionTimeframe({ previousProgressTime: fourHour + 2 * 3600, nextProgressTime: fourHour + 4 * 3600, timeframe: '4H', grid: 'utc' })).toBe('1H');
    expect(partialExecutionTimeframe({ previousProgressTime: Date.parse('2024-05-21T04:00:00Z') / 1000, nextProgressTime: Date.parse('2024-05-22T00:00:00Z') / 1000, timeframe: '1D', grid: 'utc' })).toBe('4H');
    expect(partialExecutionTimeframe({ previousProgressTime: Date.parse('2024-05-21T04:00:00Z') / 1000, nextProgressTime: Date.parse('2024-05-21T16:00:00Z') / 1000, timeframe: '1D', grid: 'shanghai' })).toBe('4H');
    expect(partialExecutionTimeframe({ previousProgressTime: Date.parse('2024-05-20T16:00:00Z') / 1000, nextProgressTime: Date.parse('2024-05-27T16:00:00Z') / 1000, timeframe: '1W', grid: 'shanghai' })).toBe('1D');
    expect(partialExecutionTimeframe({ previousProgressTime: Date.parse('2024-05-15T16:00:00Z') / 1000, nextProgressTime: Date.parse('2024-05-31T16:00:00Z') / 1000, timeframe: '1M', grid: 'shanghai' })).toBe('1D');
    expect(() => partialExecutionTimeframe({ previousProgressTime: FROM, nextProgressTime: TO, timeframe: '1m', grid: 'shanghai' })).toThrow(/细周期/);
  });
});

describe('loadPartialExecutionCandles', () => {
  const input = {
    instrument: 'BTCUSDT', source: 'bitget' as const,
    previousProgressTime: FROM, nextProgressTime: TO, timeframe: '1H' as const, grid: 'shanghai' as const,
  };

  it('loads the same source and returns only the new 15m segment', async () => {
    const loader = vi.fn<ExecutionCandleLoader>(async () => [
      candle(1616742000000, '15m', { low: 52398.5 }),
      candle(1616742900000, '15m'),
      candle(1616743800000, '15m'),
      candle(1616744700000, '15m', { low: 53099.5 }),
      candle(1616745600000, '15m'),
    ]);

    await expect(loadPartialExecutionCandles(input, loader)).resolves.toEqual([
      candle(1616744700000, '15m', { low: 53099.5 }),
    ]);
    expect(loader).toHaveBeenCalledTimes(1);
    const params = loader.mock.calls[0]![0];
    expect(params.get('instrument')).toBe('BTCUSDT');
    expect(params.get('source')).toBe('bitget');
    expect(params.get('timeframe')).toBe('15m');
    expect(params.get('mode')).toBe('initial');
    expect(params.get('anchor')).toBe(String(FROM * 1000));
    expect(params.get('entryTime')).toBe(new Date(FROM * 1000).toISOString());
  });

  it('pages later until the exact new segment is complete', async () => {
    const from = Date.parse('2024-05-21T00:00:00Z') / 1000;
    const to = from + 4 * 3600;
    const bars = [0, 1, 2, 3].map((index) => candle((from + index * 3600) * 1000, '1H'));
    const loader = vi.fn<ExecutionCandleLoader>(async (params) => {
      if (params.get('mode') === 'initial') return bars.slice(0, 2);
      const anchor = Number(params.get('anchor'));
      return bars.filter((bar) => bar.timestamp > anchor);
    });

    await expect(loadPartialExecutionCandles({ ...input, previousProgressTime: from, nextProgressTime: to, timeframe: '4H', grid: 'utc' }, loader)).resolves.toEqual(bars);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(loader.mock.calls[1]![0].get('mode')).toBe('later');
    expect(loader.mock.calls[1]![0].get('anchor')).toBe(String(bars[1]!.timestamp));
  });

  it('rejects a missing middle candle instead of executing an incomplete segment', async () => {
    const from = Date.parse('2024-05-21T00:00:00Z') / 1000;
    const to = from + 4 * 3600;
    const bars = [0, 1, 3].map((index) => candle((from + index * 3600) * 1000, '1H'));
    const loader: ExecutionCandleLoader = async () => bars;
    await expect(loadPartialExecutionCandles({ ...input, previousProgressTime: from, nextProgressTime: to, timeframe: '4H', grid: 'utc' }, loader)).rejects.toThrow(/不完整/);
  });

  it('rejects empty data and a later page that does not advance', async () => {
    await expect(loadPartialExecutionCandles(input, async () => [])).rejects.toThrow(/不完整/);

    const from = Date.parse('2024-05-21T00:00:00Z') / 1000;
    const to = from + 4 * 3600;
    const partial = [0, 1].map((index) => candle((from + index * 3600) * 1000, '1H'));
    await expect(loadPartialExecutionCandles({ ...input, previousProgressTime: from, nextProgressTime: to, timeframe: '4H', grid: 'utc' }, async () => partial)).rejects.toThrow(/不完整/);
  });

  it('propagates a loader failure', async () => {
    await expect(loadPartialExecutionCandles(input, async () => { throw new Error('rate limited'); })).rejects.toThrow('rate limited');
  });
});

describe('processExecutionCandles', () => {
  it('uses each child candle completion time and stops processing after a stop fill', () => {
    const long = opened();
    const stopped = placeStopLoss(long, long.position!.legs[0]!.id, 95, 100, 1);
    const first = candle(0, '5m', { low: 94, high: 100 });
    const second = candle(300_000, '5m', { low: 80, high: 100 });
    const result = processExecutionCandles(stopped, [first, second]);
    expect(result.position).toBeNull();
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({ exitPrice: 95, exitTime: 300_000 });
  });

  it('fills a short stop only on a child candle whose high reaches it', () => {
    const short = opened('short');
    const stopped = placeStopLoss(short, short.position!.legs[0]!.id, 105, 100, 1);
    const untouched = processExecutionCandles(stopped, [candle(0, '5m', { high: 104, low: 90 })]);
    expect(untouched.position).not.toBeNull();
    const filled = processExecutionCandles(untouched, [candle(300_000, '5m', { high: 106, low: 90 })]);
    expect(filled.trades[0]).toMatchObject({ direction: 'short', exitPrice: 105, exitTime: 600_000 });
  });

  it('fills a pending entry at the child completion time', () => {
    const pending = placeEntryLimit(startPaperTrading(initialPaperTradingSession(), 1), 95, { direction: 'long', positionRatioPercent: 100, leverage: 1 }, 1);
    const result = processExecutionCandles(pending, [
      candle(0, '5m', { low: 96, high: 100 }),
      candle(300_000, '5m', { low: 94, high: 100 }),
    ]);
    expect(result.position?.entryPrice).toBe(95);
    expect(result.position?.entryTime).toBe(600_000);
    expect(result.pendingEntry).toBeNull();
  });

  it('keeps stop-before-take-profit ordering inside every child candle', () => {
    const long = opened();
    const stopped = placeStopLoss(long, long.position!.legs[0]!.id, 95, 100, 1);
    const withExit = placeExitLimit(stopped, 105, 10, 1);
    const result = processExecutionCandles(withExit, [candle(0, '5m', { low: 94, high: 106 })]);
    expect(result.position).toBeNull();
    expect(result.pendingExit).toBeNull();
    expect(result.trades[0]?.exitPrice).toBe(95);
  });

  it('rejects non-contiguous or mixed-timeframe execution input', () => {
    const long = opened();
    expect(() => processExecutionCandles(long, [candle(0, '5m'), candle(600_000, '5m')])).toThrow(/连续/);
    expect(() => processExecutionCandles(long, [candle(0, '5m'), candle(300_000, '15m')])).toThrow(/周期/);
    expect(timeframeMs('5m')).toBe(300_000);
  });
});
