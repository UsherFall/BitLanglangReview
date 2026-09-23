import { describe, expect, it } from 'vitest';
import type { Candlestick } from '../src/domain/candlestick';
import type { ReviewedTrade } from '../src/domain/review-queue';
import type { TradePoint } from '../src/domain/trade';
import { LONG_COLOR, SHORT_COLOR, allTradeChartPoints, pointColor, tradeChartPoints } from '../src/ui/trade-markers';

describe('Trade chart points', () => {
  it('colours an entry with its own direction and an exit with the opposite one', () => {
    // 多单开青平红, 空单开红平青.
    expect(pointColor('open', '多')).toBe(LONG_COLOR);
    expect(pointColor('close', '多')).toBe(SHORT_COLOR);
    expect(pointColor('open', '空')).toBe(SHORT_COLOR);
    expect(pointColor('close', '空')).toBe(LONG_COLOR);
  });

  it('falls back to an entry/exit pair when the source has no orders', () => {
    const candles = [makeCandle('2024-05-21T00:00:00+08:00'), makeCandle('2024-05-21T04:00:00+08:00'), makeCandle('2024-05-21T08:00:00+08:00')];

    const points = tradeChartPoints(makeTrade(), '4H', candles);

    expect(points.map((point) => point.kind)).toEqual(['open', 'close']);
    expect(points.map((point) => point.time)).toEqual([
      Date.parse('2024-05-21T00:00:00+08:00') / 1000,
      Date.parse('2024-05-21T04:00:00+08:00') / 1000,
    ]);
    expect(points.map((point) => point.price)).toEqual([3100, 3500]);
    // No per-action detail: the tooltip falls back to the round's own figures.
    expect(points.map((point) => point.detail)).toEqual([null, null]);
    expect(points.every((point) => !point.muted)).toBe(true);
    // Direction rides along on every point: the renderer picks the dot's side
    // and colour from it.
    expect(points.every((point) => point.direction === '多')).toBe(true);
  });

  it('expands a Bitget round into one point per order, snapped like the old markers', () => {
    const candles = [makeCandle('2024-05-21T00:00:00+08:00'), makeCandle('2024-05-21T04:00:00+08:00')];
    const trade = makeTrade({
      id: 'bg-1',
      points: [
        makePoint('open', '2024-05-21T00:30:00+08:00', 80400.1),
        makePoint('open', '2024-05-21T01:00:00+08:00', 81508.3),
        makePoint('close', '2024-05-21T02:30:00+08:00', 81145.2, { source: 'loss_market', profit: 0.3176 }),
        makePoint('open', '2024-05-21T04:30:00+08:00', 81543.7),
        makePoint('close', '2024-05-21T04:45:00+08:00', 81390, { source: 'loss_market', profit: -1.15 }),
      ],
    });

    const points = tradeChartPoints(trade, '4H', candles);

    expect(points.map((point) => point.kind)).toEqual(['open', 'open', 'close', 'open', 'close']);
    // Points snap to the containing candlestick, exactly like the old markers.
    expect(points.map((point) => point.time)).toEqual([
      Date.parse('2024-05-21T00:00:00+08:00') / 1000,
      Date.parse('2024-05-21T00:00:00+08:00') / 1000,
      Date.parse('2024-05-21T00:00:00+08:00') / 1000,
      Date.parse('2024-05-21T04:00:00+08:00') / 1000,
      Date.parse('2024-05-21T04:00:00+08:00') / 1000,
    ]);
    expect(points[2].detail?.source).toBe('loss_market');
    expect(points[2].detail?.profit).toBe(0.3176);
    expect(points[0].detail?.profit).toBeNull();
    expect(new Set(points.map((point) => point.key)).size).toBe(5);
    expect(points.every((point) => point.tradeId === 'bg-1')).toBe(true);
  });

  it('drops actions outside the loaded candles instead of flooring them onto empty slots', () => {
    // The renderer anchors a point's price to the candlestick behind its chart
    // time. A floored time (onto a slot no candle occupies) would pair that
    // time with some other candle's low/high and draw the point in mid-air —
    // the drift this guards against.
    const candles = [makeCandle('2024-05-21T00:00:00+08:00'), makeCandle('2024-05-21T04:00:00+08:00')];
    const trade = makeTrade({
      id: 'bg-out-of-range',
      points: [
        makePoint('open', '2024-05-21T00:30:00+08:00', 100),
        makePoint('close', '2024-05-21T08:30:00+08:00', 200),
      ],
    });

    const points = tradeChartPoints(trade, '4H', candles);

    expect(points).toHaveLength(1);
    expect(points[0].kind).toBe('open');
  });

  it('snaps an action inside a data gap onto the candle before the gap', () => {
    const candles = [makeCandle('2024-05-21T00:00:00+08:00'), makeCandle('2024-05-21T08:00:00+08:00')];
    const trade = makeTrade({ id: 'bg-gap', points: [makePoint('close', '2024-05-21T05:00:00+08:00', 150)] });

    const points = tradeChartPoints(trade, '4H', candles);

    expect(points).toHaveLength(1);
    expect(points[0].time).toBe(Date.parse('2024-05-21T00:00:00+08:00') / 1000);
    expect(points[0].price).toBe(150);
  });

  it('mutes every trade except the active one in the all-trades mode', () => {
    const candles = [makeCandle('2024-05-21T00:00:00+08:00'), makeCandle('2024-05-21T04:00:00+08:00'), makeCandle('2024-05-21T08:00:00+08:00')];
    const trades = [
      makeTrade({ id: 't1' }),
      makeTrade({ id: 't2', entryTime: '2024-05-21T04:10:00.000+08:00', exitTime: '2024-05-21T08:20:00.000+08:00', entryPrice: 3200, exitPrice: 3300, direction: '空' }),
    ];

    const points = allTradeChartPoints(trades, 't1', '4H', candles);

    expect(points).toHaveLength(4);
    expect(points.filter((point) => !point.muted).map((point) => point.tradeId)).toEqual(['t1', 't1']);
    expect(points.filter((point) => point.muted).map((point) => point.tradeId)).toEqual(['t2', 't2']);
    expect(points.map((point) => point.direction)).toEqual(['多', '多', '空', '空']);
  });
});

function makeCandle(time: string): Candlestick {
  return {
    instrument: 'ETH-USDT-SWAP',
    timeframe: '4H',
    timestamp: Date.parse(time),
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 1,
  };
}

function makePoint(kind: 'open' | 'close', time: string, price: number, overrides: Partial<TradePoint> = {}): TradePoint {
  return {
    kind,
    time,
    timeMs: Date.parse(time),
    price,
    qty: 0.0029,
    fee: 0.14,
    profit: null,
    source: 'market',
    leverage: 30,
    ...overrides,
  };
}

function makeTrade(overrides: Partial<ReviewedTrade> = {}): ReviewedTrade {
  return {
    id: 't1',
    sequence: 1,
    instrument: 'ETH-USDT-SWAP',
    direction: '多',
    entryTime: '2024-05-21T01:17:00.000+08:00',
    exitTime: '2024-05-21T05:30:00.000+08:00',
    entryPrice: 3100,
    exitPrice: 3500,
    profit: 1,
    leverage: 1,
    margin: 1,
    returnRate: 0.1,
    turnover: 1,
    size: 1,
    maxPositionValue: 1,
    fee: 0,
    holdingMinutes: 253,
    amplitude: null,
    sourceNote: '',
    review: null,
    ...overrides,
  };
}
