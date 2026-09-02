import { describe, expect, it } from 'vitest';
import type { Candlestick } from '../src/domain/candlestick';
import {
  availableMargin,
  cancelPendingOrder,
  cancelStopLoss,
  closeLegMarket,
  closeMarket,
  currentCursorCandle,
  initialPaperTradingSession,
  normalizePaperTradingSession,
  openMarket,
  paperTradeMarkers,
  paperTradingStats,
  placeEntryLimit,
  placeExitLimit,
  placeStopLoss,
  processRevealedCandle,
  startPaperTrading,
  type PaperTradingSettings,
} from '../src/ui/free-replay-paper-trading';

describe('Free Replay Paper Trading', () => {
  it('opens and closes a long market position at the cursor candle close', () => {
    const settings: PaperTradingSettings = { direction: 'long', positionRatioPercent: 50, leverage: 2 };
    const entryTime = Date.parse('2024-05-21T10:05:00+08:00') / 1000;
    const exitTime = Date.parse('2024-05-21T10:10:00+08:00') / 1000;
    const opened = openMarket(startPaperTrading(initialPaperTradingSession(), entryTime), makeCandle('2024-05-21T10:00:00+08:00', { close: 100 }), settings, entryTime);
    const closed = closeMarket(opened, makeCandle('2024-05-21T10:05:00+08:00', { close: 110 }), exitTime);

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
      positionOpenPrice: 100,
      positionOpenTime: entryTime * 1000,
      exitTime: exitTime * 1000,
    });
  });

  it('calculates short pnl, realized stats, and floating pnl without adding floating pnl to realized totals', () => {
    const settings: PaperTradingSettings = { direction: 'short', positionRatioPercent: 100, leverage: 1 };
    const opened = openMarket(startPaperTrading(initialPaperTradingSession(), 1), makeCandle('2024-05-21T10:00:00+08:00', { close: 100 }), settings, 1);

    expect(paperTradingStats(opened, makeCandle('2024-05-21T10:05:00+08:00', { close: 90 }))).toMatchObject({
      realizedPnl: 0,
      totalReturnRate: 0,
      floatingPnl: 100,
    });

    const closed = closeMarket(opened, makeCandle('2024-05-21T10:10:00+08:00', { close: 90 }), 2);
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
    const fillTime = Date.parse('2024-05-21T10:15:00+08:00') / 1000;
    const untouched = processRevealedCandle(pending, makeCandle('2024-05-21T10:05:00+08:00', { low: 96, high: 110 }), Date.parse('2024-05-21T10:10:00+08:00') / 1000);
    const filled = processRevealedCandle(untouched, makeCandle('2024-05-21T10:10:00+08:00', { low: 94, high: 100 }), fillTime);

    expect(untouched.position).toBeNull();
    expect(untouched.pendingEntry?.limitPrice).toBe(95);
    expect(filled.position?.entryPrice).toBe(95);
    expect(filled.position?.entryTime).toBe(fillTime * 1000);
    expect(filled.pendingEntry).toBeNull();
  });

  it('replaces and cancels same-kind pending limit orders', () => {
    const settings: PaperTradingSettings = { direction: 'long', positionRatioPercent: 100, leverage: 1 };
    const first = placeEntryLimit(startPaperTrading(initialPaperTradingSession(), 1), 90, settings, 1);
    const second = placeEntryLimit(first, 95, settings, 1);

    expect(second.pendingEntry?.limitPrice).toBe(95);
    expect(cancelPendingOrder(second, 'entry').pendingEntry).toBeNull();
  });

  it('blocks opposite-direction entries while holding a position but allows same-direction adds', () => {
    const session = startPaperTrading(initialPaperTradingSession(), 1);
    const longSettings: PaperTradingSettings = { direction: 'long', positionRatioPercent: 100, leverage: 1 };
    const shortSettings: PaperTradingSettings = { direction: 'short', positionRatioPercent: 100, leverage: 1 };
    const opened = openMarket(session, makeCandle('2024-05-21T10:00:00+08:00', { close: 100 }), longSettings, 1);
    const ignored = openMarket(opened, makeCandle('2024-05-21T10:05:00+08:00', { close: 90 }), shortSettings, 2);

    expect(ignored.position?.direction).toBe('long');
    expect(ignored.position?.quantity).toBe(10);

    const halfClosed = closeMarket(ignored, makeCandle('2024-05-21T10:10:00+08:00', { close: 100 }), 3, 50);
    expect(halfClosed.position?.quantity).toBe(5);
    expect(availableMargin(halfClosed)).toBe(500);
    const addSettings: PaperTradingSettings = { direction: 'long', positionRatioPercent: 100, leverage: 1 };
    const added = openMarket(halfClosed, makeCandle('2024-05-21T10:15:00+08:00', { close: 100 }), addSettings, 4);
    expect(added.position?.quantity).toBe(10);
    expect(added.position?.margin).toBe(1000);
    expect(added.position?.legs).toHaveLength(2);
    expect(availableMargin(added)).toBe(0);
  });

  it('closes a portion by market close ratio and keeps the rest open', () => {
    const settings: PaperTradingSettings = { direction: 'long', positionRatioPercent: 100, leverage: 1 };
    const opened = openMarket(startPaperTrading(initialPaperTradingSession(), 1), makeCandle('2024-05-21T10:00:00+08:00', { close: 100 }), settings, 1);
    const closed = closeMarket(opened, makeCandle('2024-05-21T10:05:00+08:00', { close: 110 }), 2, 50);

    expect(closed.position?.quantity).toBe(5);
    expect(closed.position?.margin).toBe(500);
    expect(closed.trades).toHaveLength(1);
    expect(closed.trades[0]).toMatchObject({ quantity: 5, margin: 500, entryPrice: 100, exitPrice: 110, pnl: 50, returnRate: 0.1 });

    const fullyClosed = closeMarket(closed, makeCandle('2024-05-21T10:10:00+08:00', { close: 120 }), 3);
    expect(fullyClosed.position).toBeNull();
    expect(fullyClosed.trades).toHaveLength(2);
    expect(fullyClosed.trades[1]).toMatchObject({ quantity: 5, margin: 500, pnl: 100, returnRate: 0.2 });
  });

  it('fills a fixed-quantity exit limit and keeps the rest open', () => {
    const settings: PaperTradingSettings = { direction: 'long', positionRatioPercent: 100, leverage: 1 };
    const opened = openMarket(startPaperTrading(initialPaperTradingSession(), 1), makeCandle('2024-05-21T10:00:00+08:00', { close: 100 }), settings, 1);
    const pendingExit = placeExitLimit(opened, 105, 5, Date.parse('2024-05-21T10:00:00+08:00') / 1000);
    const exitTime = Date.parse('2024-05-21T10:10:00+08:00') / 1000;
    const closed = processRevealedCandle(pendingExit, makeCandle('2024-05-21T10:05:00+08:00', { low: 104, high: 106 }), exitTime);

    expect(closed.position?.quantity).toBe(5);
    expect(closed.pendingExit).toBeNull();
    expect(closed.trades[0].exitPrice).toBe(105);
    expect(closed.trades[0].exitTime).toBe(exitTime * 1000);
    expect(closed.trades[0].pnl).toBe(25);
  });

  it('rejects a global exit limit larger than the position', () => {
    const settings: PaperTradingSettings = { direction: 'long', positionRatioPercent: 100, leverage: 1 };
    const opened = openMarket(startPaperTrading(initialPaperTradingSession(), 1), makeCandle('2024-05-21T10:00:00+08:00', { close: 100 }), settings, 1);
    expect(placeExitLimit(opened, 105, 11, 1).pendingExit).toBeNull();
  });

  it('closes the whole leg when its own stop is touched', () => {
    const settings: PaperTradingSettings = { direction: 'long', positionRatioPercent: 100, leverage: 1 };
    const opened = openMarket(startPaperTrading(initialPaperTradingSession(), 1), makeCandle('2024-05-21T10:00:00+08:00', { close: 100 }), settings, 1);
    const legId = opened.position!.legs[0].id;
    const stopped = placeStopLoss(opened, legId, 95, 100, 1);
    expect(stopped.position?.legs[0].stopPrice).toBe(95);
    const closed = processRevealedCandle(stopped, makeCandle('2024-05-21T10:05:00+08:00', { low: 94, high: 110 }), 2);

    expect(closed.position).toBeNull();
    expect(closed.trades[0]).toMatchObject({ exitPrice: 95, quantity: 10, pnl: -50 });
  });

  it('sets one stop per leg and fills both legs at their own prices in one candle', () => {
    const settings: PaperTradingSettings = { direction: 'long', positionRatioPercent: 100, leverage: 1 };
    const opened = openMarket(startPaperTrading(initialPaperTradingSession(), 1), makeCandle('2024-05-21T10:00:00+08:00', { close: 100 }), settings, 1);
    // Free margin so a second scale-in leg can open.
    const half = closeMarket(opened, makeCandle('2024-05-21T10:05:00+08:00', { close: 100 }), 2, 50);
    const added = openMarket(half, makeCandle('2024-05-21T10:10:00+08:00', { close: 100 }), settings, 3);
    const [leg1, leg2] = added.position!.legs;
    expect(added.position?.legs).toHaveLength(2);
    const withStops = placeStopLoss(placeStopLoss(added, leg1.id, 95, 100, 3), leg2.id, 90, 100, 3);

    const closed = processRevealedCandle(withStops, makeCandle('2024-05-21T10:15:00+08:00', { low: 88, high: 100 }), 4);
    expect(closed.position).toBeNull();
    expect(closed.trades).toHaveLength(3); // 50% manual close + both leg stops
    expect(closed.trades.slice(1)).toEqual([
      expect.objectContaining({ exitPrice: 95, quantity: 5, pnl: -25 }),
      expect.objectContaining({ exitPrice: 90, quantity: 5, pnl: -50 }),
    ]);
  });

  it('closes only the leg whose own stop is touched and keeps other legs', () => {
    const settings: PaperTradingSettings = { direction: 'long', positionRatioPercent: 100, leverage: 1 };
    const opened = openMarket(startPaperTrading(initialPaperTradingSession(), 1), makeCandle('2024-05-21T10:00:00+08:00', { close: 100 }), settings, 1);
    const half = closeMarket(opened, makeCandle('2024-05-21T10:05:00+08:00', { close: 100 }), 2, 50);
    const added = openMarket(half, makeCandle('2024-05-21T10:10:00+08:00', { close: 100 }), settings, 3);
    const leg2 = added.position!.legs[1];
    const withStop = placeStopLoss(added, leg2.id, 95, 100, 3);

    const closed = processRevealedCandle(withStop, makeCandle('2024-05-21T10:15:00+08:00', { low: 92, high: 100 }), 4);
    expect(closed.position?.legs).toHaveLength(1);
    expect(closed.position?.quantity).toBe(5);
    expect(closed.trades).toHaveLength(2); // 50% manual close + the leg stop
    expect(closed.trades[1]).toMatchObject({ exitPrice: 95, quantity: 5, pnl: -25 });
  });

  it('moves and removes the stop of a specific leg', () => {
    const settings: PaperTradingSettings = { direction: 'long', positionRatioPercent: 100, leverage: 1 };
    const opened = openMarket(startPaperTrading(initialPaperTradingSession(), 1), makeCandle('2024-05-21T10:00:00+08:00', { close: 100 }), settings, 1);
    const legId = opened.position!.legs[0].id;
    const stopped = placeStopLoss(opened, legId, 95, 100, 1);
    // Invalid side: not moved.
    expect(placeStopLoss(stopped, legId, 105, 100, 2).position?.legs[0].stopPrice).toBe(95);
    // Valid move to a profit-side price below the current price.
    expect(placeStopLoss(stopped, legId, 101, 105, 2).position?.legs[0].stopPrice).toBe(101);
    expect(cancelStopLoss(stopped, legId).position?.legs[0].stopPrice).toBeUndefined();
  });

  it('keeps a leg stop after manually closing a part of that same leg', () => {
    const settings: PaperTradingSettings = { direction: 'long', positionRatioPercent: 100, leverage: 1 };
    const opened = openMarket(startPaperTrading(initialPaperTradingSession(), 1), makeCandle('2024-05-21T10:00:00+08:00', { close: 100 }), settings, 1);
    const legId = opened.position!.legs[0].id;
    const stopped = placeStopLoss(opened, legId, 95, 100, 1);
    const half = closeLegMarket(stopped, legId, makeCandle('2024-05-21T10:05:00+08:00', { close: 120 }), 2, 50);
    expect(half.position?.quantity).toBe(5);
    expect(half.position?.legs[0].stopPrice).toBe(95);

    const stoppedOut = processRevealedCandle(half, makeCandle('2024-05-21T10:10:00+08:00', { low: 94, high: 100 }), 3);
    expect(stoppedOut.position).toBeNull();
    expect(stoppedOut.trades).toHaveLength(2);
    expect(stoppedOut.trades[1]).toMatchObject({ exitPrice: 95, quantity: 5, pnl: -25 });
  });

  it('market-closes one whole leg so the remaining leg stop covers the whole position', () => {
    const settings: PaperTradingSettings = { direction: 'long', positionRatioPercent: 100, leverage: 1 };
    const opened = openMarket(startPaperTrading(initialPaperTradingSession(), 1), makeCandle('2024-05-21T10:00:00+08:00', { close: 100 }), settings, 1);
    const half = closeMarket(opened, makeCandle('2024-05-21T10:05:00+08:00', { close: 100 }), 2, 50);
    const added = openMarket(half, makeCandle('2024-05-21T10:10:00+08:00', { close: 100 }), settings, 3);
    const [leg1, leg2] = added.position!.legs;
    const stoppedLeg1 = placeStopLoss(added, leg1.id, 95, 100, 3);

    // User keeps 仓1's stop, closes 仓2 fully: remaining position is 仓1 and
    // 仓1's stop now protects exactly the whole remaining quantity.
    const afterClose = closeLegMarket(stoppedLeg1, leg2.id, makeCandle('2024-05-21T10:15:00+08:00', { close: 105 }), 4);
    expect(afterClose.position?.legs).toHaveLength(1);
    expect(afterClose.position?.legs[0].id).toBe(leg1.id);
    expect(afterClose.position?.quantity).toBe(5);
    expect(afterClose.position?.legs[0].stopPrice).toBe(95);

    const stoppedOut = processRevealedCandle(afterClose, makeCandle('2024-05-21T10:20:00+08:00', { low: 93, high: 100 }), 5);
    expect(stoppedOut.position).toBeNull();
    expect(stoppedOut.trades).toHaveLength(3); // half close + leg2 market close + leg1 stop
    expect(stoppedOut.trades[2]).toMatchObject({ exitPrice: 95, quantity: 5, pnl: -25 });
  });

  it('removes a leg stop after a full market close so it cannot fire later', () => {
    const settings: PaperTradingSettings = { direction: 'long', positionRatioPercent: 100, leverage: 1 };
    const opened = openMarket(startPaperTrading(initialPaperTradingSession(), 1), makeCandle('2024-05-21T10:00:00+08:00', { close: 100 }), settings, 1);
    const legId = opened.position!.legs[0].id;
    const stopped = placeStopLoss(opened, legId, 95, 100, 1);
    const closed = closeMarket(stopped, makeCandle('2024-05-21T10:05:00+08:00', { close: 120 }), 2);

    expect(closed.position).toBeNull();
    expect(closed.trades).toHaveLength(1);
    const later = processRevealedCandle(closed, makeCandle('2024-05-21T10:10:00+08:00', { low: 90, high: 96, close: 91 }), 3);
    expect(later.trades).toHaveLength(1);
    expect(later.position).toBeNull();
  });

  it('validates stop loss direction against current price for shorts', () => {
    const settings: PaperTradingSettings = { direction: 'short', positionRatioPercent: 100, leverage: 1 };
    const opened = openMarket(startPaperTrading(initialPaperTradingSession(), 1), makeCandle('2024-05-21T10:00:00+08:00', { close: 100 }), settings, 1);
    const legId = opened.position!.legs[0].id;
    expect(placeStopLoss(opened, legId, 90, 95, 1).position?.legs[0].stopPrice).toBeUndefined();
    expect(placeStopLoss(opened, legId, 98, 95, 1).position?.legs[0].stopPrice).toBe(98);
  });

  it('caps a later exit-limit fill by the remaining position after manual partial closes', () => {
    const settings: PaperTradingSettings = { direction: 'long', positionRatioPercent: 100, leverage: 1 };
    const opened = openMarket(startPaperTrading(initialPaperTradingSession(), 1), makeCandle('2024-05-21T10:00:00+08:00', { close: 100 }), settings, 1);
    const pendingExit = placeExitLimit(opened, 110, 6, 1);
    const trimmed = closeMarket(pendingExit, makeCandle('2024-05-21T10:05:00+08:00', { close: 105 }), 2, 80);
    expect(trimmed.position?.quantity).toBe(2);

    const closed = processRevealedCandle(trimmed, makeCandle('2024-05-21T10:10:00+08:00', { low: 109, high: 111 }), 3);
    expect(closed.position).toBeNull();
    expect(closed.trades).toHaveLength(2);
    expect(closed.trades[1]).toMatchObject({ exitPrice: 110, quantity: 2, pnl: 20 });
  });

  it('computes FIFO realized pnl across legs and updates the remaining average entry', () => {
    const settings: PaperTradingSettings = { direction: 'long', positionRatioPercent: 100, leverage: 1 };
    const firstEntryTime = Date.parse('2024-05-21T10:00:00+08:00') / 1000;
    const opened = openMarket(startPaperTrading(initialPaperTradingSession(), firstEntryTime), makeCandle('2024-05-21T10:00:00+08:00', { close: 100 }), settings, firstEntryTime);
    const halfClosed = closeMarket(opened, makeCandle('2024-05-21T10:05:00+08:00', { close: 120 }), Date.parse('2024-05-21T10:10:00+08:00') / 1000, 60);
    const addTime = Date.parse('2024-05-21T10:10:00+08:00') / 1000;
    const addSettings: PaperTradingSettings = { direction: 'long', positionRatioPercent: 50, leverage: 1 };
    const added = openMarket(halfClosed, makeCandle('2024-05-21T10:15:00+08:00', { close: 150 }), addSettings, addTime);
    expect(added.position?.legs).toHaveLength(2);
    expect(added.position?.quantity).toBe(6);
    expect(added.position?.margin).toBe(700);

    const closed = closeMarket(added, makeCandle('2024-05-21T10:20:00+08:00', { close: 200 }), Date.parse('2024-05-21T10:25:00+08:00') / 1000);
    expect(closed.position).toBeNull();
    const last = closed.trades[closed.trades.length - 1];
    expect(last).toMatchObject({ quantity: 6, margin: 700, exitPrice: 200, pnl: 500, returnRate: 500 / 700 });
    expect(last.entryPrice).toBeCloseTo((4 * 100 + 2 * 150) / 6, 6);
    expect(last.entryTime).toBe(firstEntryTime * 1000);
  });

  it('cannot add when no available margin remains', () => {
    const settings: PaperTradingSettings = { direction: 'long', positionRatioPercent: 100, leverage: 1 };
    const opened = openMarket(startPaperTrading(initialPaperTradingSession(), 1), makeCandle('2024-05-21T10:00:00+08:00', { close: 100 }), settings, 1);
    expect(availableMargin(opened)).toBe(0);
    const ignored = openMarket(opened, makeCandle('2024-05-21T10:05:00+08:00', { close: 110 }), settings, 2);

    expect(ignored.position?.quantity).toBe(10);
    expect(ignored.position?.legs).toHaveLength(1);
  });

  it('creates one entry marker per position and one exit marker per close fill', () => {
    const settings: PaperTradingSettings = { direction: 'short', positionRatioPercent: 100, leverage: 1 };
    const opened = openMarket(startPaperTrading(initialPaperTradingSession(), 1), makeCandle('2024-05-21T10:00:00+08:00', { close: 100 }), settings, Date.parse('2024-05-21T10:05:00+08:00') / 1000);
    const half = closeMarket(opened, makeCandle('2024-05-21T10:05:00+08:00', { close: 90 }), Date.parse('2024-05-21T10:10:00+08:00') / 1000, 50);
    const closed = closeMarket(half, makeCandle('2024-05-21T10:10:00+08:00', { close: 85 }), Date.parse('2024-05-21T10:15:00+08:00') / 1000);
    const candles = [makeCandle('2024-05-21T10:00:00+08:00'), makeCandle('2024-05-21T10:05:00+08:00'), makeCandle('2024-05-21T10:10:00+08:00')];

    const markers = paperTradeMarkers(closed.trades, '5m', candles);
    expect(markers.filter((marker) => marker.text?.startsWith('开 '))).toHaveLength(1);
    expect(markers.filter((marker) => marker.text?.startsWith('平 '))).toHaveLength(2);
    expect(markers[0].text).toBe('开 100');
  });

  it('normalizes a legacy single-block session and attaches the old stop to its leg', () => {
    const legacy = {
      active: true,
      startedAtCursorTime: 5,
      nextId: 3,
      pendingEntry: null,
      pendingExit: null,
      pendingStopLoss: { id: 'stop-2', kind: 'exit', direction: 'long', limitPrice: 95, closeRatioPercent: 100, createdAtCursorTime: 3 },
      position: { id: 'position-1', direction: 'long', entryPrice: 100, entryTime: 1000, margin: 1000, notional: 1000, quantity: 10, leverage: 1 },
      trades: [{ id: 'position-1', direction: 'long', entryPrice: 100, entryTime: 1000, exitPrice: 110, exitTime: 2000, margin: 1000, notional: 1000, quantity: 10, leverage: 1, pnl: 100, returnRate: 0.1 }],
    };

    const normalized = normalizePaperTradingSession(legacy);
    expect(normalized.position?.legs).toHaveLength(1);
    expect(normalized.position?.originPrice).toBe(100);
    expect(normalized.position?.legs[0].stopPrice).toBe(95);
    expect(normalized.trades[0]).toMatchObject({ positionId: 'position-1', positionOpenPrice: 100, positionOpenTime: 1000 });
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
