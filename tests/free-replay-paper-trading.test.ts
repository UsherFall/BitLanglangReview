import { describe, expect, it } from 'vitest';
import type { Candlestick } from '../src/domain/candlestick';
import {
  cancelPendingOrder,
  closeMarket,
  currentCursorCandle,
  initialPaperTradingSession,
  openMarket,
  paperTradeMarkers,
  paperTradingStats,
  placeEntryLimit,
  placeExitLimit,
  processRevealedCandle,
  startPaperTrading,
  type PaperTradingSettings,
} from '../src/ui/free-replay-paper-trading';

describe('Free Replay Paper Trading', () => {
  it('opens and closes a long market position at the cursor candle close', () => {
    const settings: PaperTradingSettings = { direction: 'long', positionRatioPercent: 50, leverage: 2 };
    const opened = openMarket(startPaperTrading(initialPaperTradingSession(), 1), makeCandle('2024-05-21T10:00:00+08:00', { close: 100 }), settings);
    const closed = closeMarket(opened, makeCandle('2024-05-21T10:05:00+08:00', { close: 110 }));

    expect(closed.trades).toHaveLength(1);
    expect(closed.trades[0]).toMatchObject({
      direction: 'long',
      entryPrice: 100,
      exitPrice: 110,
      margin: 500,
      notional: 1000,
      quantity: 10,
      pnl: 100,
      returnRate: 0.2,
    });
  });

  it('calculates short pnl, realized stats, and floating pnl without adding floating pnl to realized totals', () => {
    const settings: PaperTradingSettings = { direction: 'short', positionRatioPercent: 100, leverage: 1 };
    const opened = openMarket(startPaperTrading(initialPaperTradingSession(), 1), makeCandle('2024-05-21T10:00:00+08:00', { close: 100 }), settings);

    expect(paperTradingStats(opened, makeCandle('2024-05-21T10:05:00+08:00', { close: 90 }))).toMatchObject({
      realizedPnl: 0,
      totalReturnRate: 0,
      floatingPnl: 100,
    });

    const closed = closeMarket(opened, makeCandle('2024-05-21T10:10:00+08:00', { close: 90 }));
    expect(paperTradingStats(closed, null)).toMatchObject({
      realizedPnl: 100,
      totalReturnRate: 0.1,
      winRate: 1,
      profitLossRatio: null,
      tradeCount: 1,
      floatingPnl: null,
    });
  });

  it('fills limit orders only when a newly revealed candle contains the limit price', () => {
    const settings: PaperTradingSettings = { direction: 'long', positionRatioPercent: 100, leverage: 1 };
    const pending = placeEntryLimit(startPaperTrading(initialPaperTradingSession(), Date.parse('2024-05-21T10:00:00+08:00') / 1000), 95, settings, Date.parse('2024-05-21T10:00:00+08:00') / 1000);
    const untouched = processRevealedCandle(pending, makeCandle('2024-05-21T10:05:00+08:00', { low: 96, high: 110 }));
    const filled = processRevealedCandle(untouched, makeCandle('2024-05-21T10:10:00+08:00', { low: 94, high: 100 }));

    expect(untouched.position).toBeNull();
    expect(untouched.pendingEntry?.limitPrice).toBe(95);
    expect(filled.position?.entryPrice).toBe(95);
    expect(filled.pendingEntry).toBeNull();
  });

  it('replaces and cancels same-kind pending limit orders', () => {
    const settings: PaperTradingSettings = { direction: 'long', positionRatioPercent: 100, leverage: 1 };
    const first = placeEntryLimit(startPaperTrading(initialPaperTradingSession(), 1), 90, settings, 1);
    const second = placeEntryLimit(first, 95, settings, 1);

    expect(second.pendingEntry?.limitPrice).toBe(95);
    expect(cancelPendingOrder(second, 'entry').pendingEntry).toBeNull();
  });

  it('enforces a single position and requires closing before another entry', () => {
    const session = startPaperTrading(initialPaperTradingSession(), 1);
    const longSettings: PaperTradingSettings = { direction: 'long', positionRatioPercent: 100, leverage: 1 };
    const shortSettings: PaperTradingSettings = { direction: 'short', positionRatioPercent: 100, leverage: 1 };
    const opened = openMarket(session, makeCandle('2024-05-21T10:00:00+08:00', { close: 100 }), longSettings);
    const ignored = openMarket(opened, makeCandle('2024-05-21T10:05:00+08:00', { close: 90 }), shortSettings);

    expect(ignored.position?.direction).toBe('long');
    expect(ignored.position?.entryPrice).toBe(100);
  });

  it('closes a position when a pending exit limit is touched by a revealed candle', () => {
    const settings: PaperTradingSettings = { direction: 'long', positionRatioPercent: 100, leverage: 1 };
    const opened = openMarket(startPaperTrading(initialPaperTradingSession(), 1), makeCandle('2024-05-21T10:00:00+08:00', { close: 100 }), settings);
    const pendingExit = placeExitLimit(opened, 105, Date.parse('2024-05-21T10:00:00+08:00') / 1000);
    const closed = processRevealedCandle(pendingExit, makeCandle('2024-05-21T10:05:00+08:00', { low: 104, high: 106 }));

    expect(closed.position).toBeNull();
    expect(closed.trades[0].exitPrice).toBe(105);
    expect(closed.pendingExit).toBeNull();
  });

  it('creates Trade Review-style markers for completed paper trades', () => {
    const settings: PaperTradingSettings = { direction: 'short', positionRatioPercent: 100, leverage: 1 };
    const opened = openMarket(startPaperTrading(initialPaperTradingSession(), 1), makeCandle('2024-05-21T10:00:00+08:00', { close: 100 }), settings);
    const closed = closeMarket(opened, makeCandle('2024-05-21T10:05:00+08:00', { close: 90 }));
    const candles = [makeCandle('2024-05-21T10:00:00+08:00'), makeCandle('2024-05-21T10:05:00+08:00')];

    expect(paperTradeMarkers(closed.trades, '5m', candles)).toEqual([
      expect.objectContaining({ color: '#FACC15', position: 'aboveBar', shape: 'arrowDown', text: '开 100' }),
      expect.objectContaining({ color: '#38BDF8', position: 'belowBar', shape: 'arrowUp', text: '平 90' }),
    ]);
  });

  it('finds the cursor candle by second-based cursor time', () => {
    const candle = makeCandle('2024-05-21T10:00:00+08:00');

    expect(currentCursorCandle([candle], candle.timestamp / 1000)).toBe(candle);
  });
});

function makeCandle(time: string, overrides: Partial<Candlestick> = {}): Candlestick {
  return {
    instrument: 'BTC-USDT-SWAP',
    timeframe: '5m',
    timestamp: Date.parse(time),
    open: 100,
    high: 110,
    low: 90,
    close: 100,
    volume: 10,
    ...overrides,
  };
}
