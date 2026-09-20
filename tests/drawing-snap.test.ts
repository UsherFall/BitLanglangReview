import { describe, expect, it, vi } from 'vitest';
import type { Candlestick } from '../src/domain/candlestick';
import { DEFAULT_MAGNET_SENSITIVITY, snapDrawingPoint, type SnapDrawingPointInput } from '../src/ui/drawing-snap';

const BAR_1000 = Date.parse('2024-05-21T10:00:00+08:00');
const BAR_1005 = Date.parse('2024-05-21T10:05:00+08:00');
const BAR_1010 = Date.parse('2024-05-21T10:10:00+08:00');
const BAR_1000_SECONDS = BAR_1000 / 1000;

/**
 * Linear fake price scale: y = (200 - price) * 2, so 1.00 price unit is exactly
 * 2px and the 8px weak-snap threshold is exactly 4.00 price units.
 */
const priceToY = (price: number) => (200 - price) * 2;

function makeCandle(timestamp: number, ohlc: { open: number; high: number; low: number; close: number }): Candlestick {
  return { instrument: 'BTC-USDT-SWAP', timeframe: '5m', timestamp, volume: 10, ...ohlc };
}

/** open 100 / high 102 / low 98 / close 101 → y 200 / 196 / 204 / 198. */
function narrowCandle(): Candlestick {
  return makeCandle(BAR_1000, { open: 100, high: 102, low: 98, close: 101 });
}

/** open 95 / high 110 / low 90 / close 105 → y 210 / 180 / 220 / 190: gaps wide enough to sit >8px from every OHLC. */
function wideCandle(): Candlestick {
  return makeCandle(BAR_1000, { open: 95, high: 110, low: 90, close: 105 });
}

function snapInput(point: { time: number; price: number }, overrides: Partial<SnapDrawingPointInput> = {}): SnapDrawingPointInput {
  return {
    point,
    pointerY: priceToY(point.price),
    candles: [narrowCandle()],
    timeframe: '5m',
    mode: 'weak',
    priceToY,
    ...overrides,
  };
}

describe('Drawing Snap', () => {
  it('AC1 weak snap outside [low, high] uses the 8px threshold and includes exactly 8px', () => {
    const sevenPx = { time: BAR_1000_SECONDS + 50, price: 105.5 };
    const eightPx = { time: BAR_1000_SECONDS + 50, price: 106 };
    const ninePx = { time: BAR_1000_SECONDS + 50, price: 106.5 };

    // The three constructions sit 7 / 8 / 9 px above the candle high (102 → y 196).
    expect(Math.abs(priceToY(sevenPx.price) - priceToY(102))).toBe(7);
    expect(Math.abs(priceToY(eightPx.price) - priceToY(102))).toBe(8);
    expect(Math.abs(priceToY(ninePx.price) - priceToY(102))).toBe(9);
    expect(DEFAULT_MAGNET_SENSITIVITY).toBe(8);

    expect(snapDrawingPoint(snapInput(sevenPx))).toEqual({ time: BAR_1000_SECONDS, price: 102 });
    expect(snapDrawingPoint(snapInput(eightPx))).toEqual({ time: BAR_1000_SECONDS, price: 102 });
    expect(snapDrawingPoint(snapInput(ninePx))).toEqual({ time: BAR_1000_SECONDS, price: 106.5 });
  });

  it('AC2 weak snap inside [low, high] ignores the pixel threshold', () => {
    const candle = wideCandle();
    const point = { time: BAR_1000_SECONDS + 50, price: 99.5 };

    // Inside [90, 110], but 9px away from the nearest OHLC (open 95 → y 210) — well past the 8px threshold.
    expect(point.price).toBeGreaterThan(candle.low);
    expect(point.price).toBeLessThan(candle.high);
    expect(Math.abs(priceToY(point.price) - priceToY(candle.open))).toBe(9);

    expect(snapDrawingPoint(snapInput(point, { candles: [candle] }))).toEqual({ time: BAR_1000_SECONDS, price: candle.open });
  });

  it('AC3 strong snap ignores the distance entirely outside [low, high]', () => {
    const point = { time: BAR_1000_SECONDS + 50, price: 150 };

    // 96px above the candle high, i.e. 12x the weak threshold.
    expect(Math.abs(priceToY(point.price) - priceToY(102))).toBe(96);

    expect(snapDrawingPoint(snapInput(point, { mode: 'strong' }))).toEqual({ time: BAR_1000_SECONDS, price: 102 });
  });

  it('AC4 off returns the input point untouched', () => {
    const priceToYSpy = vi.fn(priceToY);
    const point = { time: BAR_1000_SECONDS + 50, price: 150 };

    expect(snapDrawingPoint(snapInput(point, { mode: 'off', priceToY: priceToYSpy }))).toBe(point);
    expect(priceToYSpy).not.toHaveBeenCalled();
  });

  it('AC5 leaves time and price alone when the pointer time cannot be attributed to a candlestick', () => {
    const insideBar = { time: BAR_1000_SECONDS + 50, price: 101.2 };

    const emptyCandles = snapDrawingPoint(snapInput(insideBar, { candles: [], mode: 'strong' }));
    expect(emptyCandles.time).toBe(insideBar.time);
    expect(emptyCandles.price).toBe(insideBar.price);

    const beforeFirstBar = { time: BAR_1000_SECONDS - 600, price: 150 };
    const before = snapDrawingPoint(snapInput(beforeFirstBar, { mode: 'strong' }));
    expect(before.time).toBe(beforeFirstBar.time);
    expect(before.price).toBe(beforeFirstBar.price);

    // 400s after the only bar start, i.e. past the trailing 5m fallback window.
    const afterLastBar = { time: BAR_1000_SECONDS + 400, price: 101.2 };
    const after = snapDrawingPoint(snapInput(afterLastBar, { mode: 'strong' }));
    expect(after.time).toBe(afterLastBar.time);
    expect(after.price).toBe(afterLastBar.price);
  });

  it('AC6 drops candidates that cannot be placed on the price scale without producing NaN', () => {
    const candle = wideCandle();
    const point = { time: BAR_1000_SECONDS + 50, price: 111 };
    // The high is the closest candidate (2px) but has no pixel coordinate here.
    expect(Math.abs(priceToY(point.price) - priceToY(candle.high))).toBe(2);

    const droppingHigh = (price: number) => (price === candle.high ? null : priceToY(price));
    const result = snapDrawingPoint(snapInput(point, { candles: [candle], mode: 'strong', priceToY: droppingHigh }));
    expect(result.price).toBe(candle.close);
    expect(Number.isFinite(result.price)).toBe(true);
    expect(Number.isFinite(result.time)).toBe(true);

    const noCandidates = snapDrawingPoint(snapInput(point, { candles: [candle], mode: 'strong', priceToY: () => null }));
    expect(noCandidates.price).toBe(point.price);
    expect(Number.isFinite(noCandidates.price)).toBe(true);
    expect(Number.isFinite(noCandidates.time)).toBe(true);
  });

  it('AC7 snaps the time to the bar time of the containing candlestick, in seconds', () => {
    const candles = [BAR_1000, BAR_1005, BAR_1010].map((timestamp) => makeCandle(timestamp, { open: 100, high: 102, low: 98, close: 101 }));
    const snapAt = (seconds: number) => snapDrawingPoint(snapInput({ time: seconds, price: 101.2 }, { candles }));

    expect(snapAt(BAR_1000_SECONDS + 120)).toEqual({ time: BAR_1000 / 1000, price: 101 }); // 10:02 → 10:00 bar
    expect(snapAt(BAR_1000_SECONDS + 45 + 300)).toEqual({ time: BAR_1005 / 1000, price: 101 }); // 10:05:45 → 10:05 bar
    expect(snapAt(BAR_1000_SECONDS + 240 + 600)).toEqual({ time: BAR_1010 / 1000, price: 101 }); // 10:14 → 10:10 bar
  });
});
