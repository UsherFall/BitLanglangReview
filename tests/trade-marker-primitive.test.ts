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
    muted: false,
    detail: null,
  };
}

/** Attaches the primitive to a fake chart whose x coordinate is shiftable. */
function attachWith(shift: () => number) {
  const primitive = new TradeMarkerPrimitive([], []);
  const chart = {
    timeScale: () => ({ timeToCoordinate: (time: number) => time - CHART_TIME + shift() }),
  } as unknown as IChartApi;
  const series = { priceToCoordinate: () => 200 } as unknown as ISeriesApi<'Candlestick'>;
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

  it('anchors a dot to its own candlestick low/high', () => {
    const primitive = attachWith(() => 0);
    const candle = makeCandle();

    primitive.setPoints([makePoint()], [candle]);

    const drawn = primitive.drawnPoints()[0];
    // Opens hang below the candle's low (90) plus the fixed gap and radius.
    expect(drawn.y).toBeGreaterThan(200);
    expect(drawn.radius).toBe(5.5);
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
