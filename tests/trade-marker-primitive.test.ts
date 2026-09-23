import type { IChartApi, ISeriesApi, SeriesAttachedParameter, Time } from 'lightweight-charts';
import { describe, expect, it } from 'vitest';
import type { Candlestick } from '../src/domain/candlestick';
import { TradeMarkerPrimitive } from '../src/ui/trade-marker-primitive';
import type { MarkerPoint } from '../src/ui/trade-markers';

const CHART_TIME = 1_700_000_000;

function makeCandle(): Candlestick {
  return {
    instrument: 'BTC-USDT-SWAP',
    timeframe: '5m',
    timestamp: CHART_TIME * 1000,
    open: 100,
    high: 110,
    low: 90,
    close: 105,
    volume: 1,
  };
}

function makePoint(): MarkerPoint {
  return {
    key: 'bg-1#open',
    tradeId: 'bg-1',
    time: CHART_TIME,
    timeMs: CHART_TIME * 1000,
    price: 100,
    kind: 'open',
    direction: '多',
    muted: false,
    detail: null,
  };
}

/** Chart y of a price under the fake price scale used by `attachWith`. */
function yFor(price: number): number {
  return 200 + (price - 100);
}

/**
 * Attaches the primitive to a fake chart whose x coordinate is shiftable and
 * whose price scale is zoomable (`scale`), so tests can drive both pan and
 * zoom the way the real chart does.
 */
function attachWith(shift: () => number, scale: () => number = () => 1) {
  const primitive = new TradeMarkerPrimitive([], []);
  const chart = {
    timeScale: () => ({ timeToCoordinate: (time: number) => time - CHART_TIME + shift() }),
  } as unknown as IChartApi;
  const series = {
    priceToCoordinate: (price: number) => 200 + (price - 100) * scale(),
  } as unknown as ISeriesApi<'Candlestick'>;
  primitive.attached({ chart, series, requestUpdate: () => undefined } as unknown as SeriesAttachedParameter<Time>);
  return primitive;
}

describe('TradeMarkerPrimitive', () => {
  it('recomputes dot coordinates on every repaint, so dots follow panning', () => {
    let shift = 0;
    const primitive = attachWith(() => shift);
    const candle = makeCandle();
    const point = makePoint();

    primitive.setPoints([point], [candle]);
    expect(primitive.drawnPoints()).toHaveLength(1);
    expect(primitive.drawnPoints()[0].x).toBe(0);

    // The chart is dragged 120px: the dot must move with it. Refreshing the
    // data alone would leave it frozen at x = 0.
    shift = 120;
    primitive.updateAllViews();

    expect(primitive.drawnPoints()[0].x).toBe(120);
  });

  it('anchors a long entry under its own candlestick low', () => {
    const primitive = attachWith(() => 0);
    const candle = makeCandle();

    primitive.setPoints([makePoint()], [candle]);

    const drawn = primitive.drawnPoints()[0];
    // A long entry hangs below the candle's low (90) plus the fixed gap and radius.
    expect(drawn.y).toBeGreaterThan(yFor(90));
    expect(drawn.radius).toBe(5.5);
  });

  it('straddles a long: entry under the low, exit over the high', () => {
    const primitive = attachWith(() => 0);
    const entry: MarkerPoint = { ...makePoint(), kind: 'open', direction: '多' };
    const exit: MarkerPoint = { ...makePoint(), kind: 'close', direction: '多', key: 'bg-1#close' };

    primitive.setPoints([entry, exit], [makeCandle()]);

    const [drawnEntry, drawnExit] = primitive.drawnPoints();
    expect(drawnEntry.y).toBeGreaterThan(yFor(90));
    expect(drawnExit.y).toBeLessThan(yFor(110));
  });

  it('mirrors a short: entry over the high, exit under the low', () => {
    const primitive = attachWith(() => 0);
    const entry: MarkerPoint = { ...makePoint(), kind: 'open', direction: '空' };
    const exit: MarkerPoint = { ...makePoint(), kind: 'close', direction: '空', key: 'bg-1#close' };

    primitive.setPoints([entry, exit], [makeCandle()]);

    const [drawnEntry, drawnExit] = primitive.drawnPoints();
    expect(drawnEntry.y).toBeLessThan(yFor(110));
    expect(drawnExit.y).toBeGreaterThan(yFor(90));
  });

  it('keeps the two sides of one candle in separate stacks', () => {
    // A short entry (above) and a long exit (above) share a candle; both are
    // above, so they stack. A long entry (below) must not consume a slot in
    // that stack just because it shares the candle's time.
    const primitive = attachWith(() => 0);
    const belowEntry: MarkerPoint = { ...makePoint(), kind: 'open', direction: '多' };
    const aboveShortEntry: MarkerPoint = { ...makePoint(), kind: 'open', direction: '空', key: 'bg-2#open' };
    const aboveLongExit: MarkerPoint = { ...makePoint(), kind: 'close', direction: '多', key: 'bg-1#close' };

    primitive.setPoints([belowEntry, aboveShortEntry, aboveLongExit], [makeCandle()]);

    const [drawnBelow, drawnAboveFirst, drawnAboveSecond] = primitive.drawnPoints();
    const step = 5.5 * 2 + 3;
    expect(drawnBelow.y).toBeCloseTo(yFor(90) + 8 + 5.5, 6);
    expect(drawnAboveFirst.y).toBeCloseTo(yFor(110) - 8 - 5.5, 6);
    expect(drawnAboveSecond.y).toBeCloseTo(yFor(110) - 8 - 5.5 - step, 6);
  });

  it('fans out dots that share a candle by an offset zooming cannot change', () => {
    // Two adds on the same candle and side: they must stack, and the stacking
    // gap must stay put while the price scale zooms. Deriving the gap from
    // measured pixel distances made it change with the zoom level, which is
    // what made dots visibly drift up and down.
    let scale = 1;
    const primitive = attachWith(() => 0, () => scale);
    const candle = makeCandle();
    const first: MarkerPoint = { ...makePoint(), key: 'bg-1#a' };
    const second: MarkerPoint = { ...makePoint(), key: 'bg-1#b' };

    primitive.setPoints([first, second], [candle]);
    const drawn = primitive.drawnPoints();
    expect(drawn).toHaveLength(2);
    const gapAtOneToOne = drawn[1].y - drawn[0].y;
    expect(gapAtOneToOne).toBeGreaterThan(0);

    scale = 4;
    primitive.updateAllViews();

    const zoomed = primitive.drawnPoints();
    expect(zoomed[1].y - zoomed[0].y).toBeCloseTo(gapAtOneToOne, 6);
  });

  it('hit-tests the newest dot positions', () => {
    let shift = 0;
    const primitive = attachWith(() => shift);
    const candle = makeCandle();
    const point = makePoint();
    primitive.setPoints([point], [candle]);

    const before = primitive.drawnPoints()[0];
    expect(primitive.findPointAt(before.x, before.y)).toBe(point);

    shift = 300;
    primitive.updateAllViews();
    // The old position is no longer a hit once the chart has moved.
    expect(primitive.findPointAt(before.x, before.y)).toBeNull();
    const after = primitive.drawnPoints()[0];
    expect(primitive.findPointAt(after.x, after.y)).toBe(point);
  });
});
