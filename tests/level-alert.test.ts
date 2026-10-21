import { describe, expect, it } from 'vitest';
import {
  LEVEL_ALERT_RATIO,
  levelAlert,
  levelPriceAt,
  linesFromDrawings,
  median,
  scaleStartIndex,
  volatilityScale,
  type LevelLine,
} from '../src/domain/level-alert';
import type { Candlestick } from '../src/domain/candlestick';
import type { ChartDrawing } from '../src/domain/drawing';

const DAY = 86_400_000;

function candle(index: number, close: number, range = close * 0.02): Candlestick {
  return {
    instrument: 'TESTUSDT',
    timeframe: '1D',
    timestamp: 1_700_000_000_000 + index * DAY,
    open: close,
    high: close + range / 2,
    low: close - range / 2,
    close,
    volume: 1,
  };
}

describe('median', () => {
  it('takes the middle value of an odd-length list', () => {
    expect(median([3, 1, 2], 0)).toBe(2);
  });

  it('falls back when the list is empty or non-finite', () => {
    expect(median([], 0.05)).toBe(0.05);
    expect(median([Number.NaN], 0.05)).toBe(0.05);
  });
});

describe('levelPriceAt', () => {
  it('returns a horizontal line price unchanged', () => {
    expect(levelPriceAt({ kind: 'horizontal', price: 42 }, 1_000)).toBe(42);
  });

  it('interpolates a ray between its two points', () => {
    const line: LevelLine = {
      kind: 'ray',
      price: 20,
      p1: { time: 0, price: 10 },
      p2: { time: 100, price: 20 },
    };
    expect(levelPriceAt(line, 0)).toBe(10);
    expect(levelPriceAt(line, 50)).toBe(15);
    expect(levelPriceAt(line, 100)).toBe(20);
    // Beyond the second point the line keeps going.
    expect(levelPriceAt(line, 150)).toBe(25);
  });

  it('does not divide by zero when both points share a timestamp', () => {
    const line: LevelLine = {
      kind: 'ray',
      price: 7,
      p1: { time: 5, price: 3 },
      p2: { time: 5, price: 7 },
    };
    expect(levelPriceAt(line, 5)).toBe(7);
  });
});

describe('volatilityScale', () => {
  it('uses the last 60 bars when no start index is given', () => {
    const candles = Array.from({ length: 120 }, (_, i) => candle(i, 100, 4));
    // Every bar has a 4% range, so the scale is 4% whatever the window.
    expect(volatilityScale(candles)).toBeCloseTo(0.04, 6);
  });

  it('measures only from the given start index', () => {
    const quiet = Array.from({ length: 10 }, (_, i) => candle(i, 100, 1));
    const loud = Array.from({ length: 10 }, (_, i) => candle(10 + i, 100, 9));
    const candles = [...quiet, ...loud];
    // From index 10 every bar has a 9% range.
    expect(volatilityScale(candles, 10)).toBeCloseTo(0.09, 6);
    // From the start the median over all 20 bars is 9% (10 bars of 1%, 10 of 9%
    // — the median of an even-length list is the upper-middle value here).
    expect(volatilityScale(candles, 0)).toBeCloseTo(0.09, 6);
    // A window of only the quiet bars gives 1%.
    expect(volatilityScale(candles.slice(0, 10), 0)).toBeCloseTo(0.01, 6);
  });

  it('falls back to 2% for an empty series', () => {
    expect(volatilityScale([])).toBe(0.02);
  });
});

describe('levelAlert', () => {
  const candles = Array.from({ length: 60 }, (_, i) => candle(i, 100, 4)); // 4% bars

  it('alerts when the price is within half a scale of the line', () => {
    const alert = levelAlert(candles, [{ kind: 'horizontal', price: 101 }], candles.at(-1)!.timestamp);
    expect(alert).not.toBeNull();
    expect(alert!.state).toBe('alert');
    expect(alert!.scalePct).toBeCloseTo(4, 6);
    expect(alert!.ratio).toBeLessThan(LEVEL_ALERT_RATIO);
  });

  it('watches when the price is between half and one scale away', () => {
    const alert = levelAlert(candles, [{ kind: 'horizontal', price: 103 }], candles.at(-1)!.timestamp);
    expect(alert!.state).toBe('watch');
  });

  it('is far when the price is more than one scale away', () => {
    const alert = levelAlert(candles, [{ kind: 'horizontal', price: 120 }], candles.at(-1)!.timestamp);
    expect(alert!.state).toBe('far');
  });

  it('reports a negative distance when the price is below the line', () => {
    const alert = levelAlert(candles, [{ kind: 'horizontal', price: 110 }], candles.at(-1)!.timestamp);
    expect(alert!.distancePct).toBeLessThan(0);
    expect(alert!.ratio).toBeCloseTo(Math.abs(alert!.distancePct) / alert!.scalePct, 6);
  });

  it('picks the closest of several lines', () => {
    const alert = levelAlert(
      candles,
      [
        { kind: 'horizontal', price: 130 },
        { kind: 'horizontal', price: 101 },
      ],
      candles.at(-1)!.timestamp,
    );
    expect(alert!.line.price).toBe(101);
  });

  it('returns null without candles or without lines', () => {
    expect(levelAlert([], [{ kind: 'horizontal', price: 1 }], 0)).toBeNull();
    expect(levelAlert(candles, [], candles.at(-1)!.timestamp)).toBeNull();
  });

  it('measures a ray at the evaluation time, not at its second point', () => {
    const at = candles.at(-1)!.timestamp;
    const line: LevelLine = {
      kind: 'ray',
      price: 100,
      p1: { time: candles[0].timestamp, price: 100 },
      p2: { time: at, price: 100 },
    };
    const alert = levelAlert(candles, [line], at);
    expect(alert!.distancePct).toBeCloseTo(0, 6);
    expect(alert!.state).toBe('alert');
  });
});

describe('linesFromDrawings', () => {
  const drawings: ChartDrawing[] = [
    {
      id: '1',
      tradeId: null,
      instrument: 'BTCUSDT',
      timeframe: '1D',
      kind: 'horizontal',
      points: [{ time: 1, price: 100 }],
      createdAt: '',
      updatedAt: '',
    },
    {
      id: '2',
      tradeId: null,
      instrument: 'BTCUSDT',
      timeframe: '1D',
      kind: 'ray',
      points: [
        { time: 1, price: 100 },
        { time: 2, price: 90 },
      ],
      createdAt: '',
      updatedAt: '',
    },
    {
      id: '3',
      tradeId: null,
      instrument: 'BTCUSDT',
      timeframe: '5m',
      kind: 'horizontal',
      points: [{ time: 1, price: 5 }],
      createdAt: '',
      updatedAt: '',
    },
    {
      id: '4',
      tradeId: null,
      instrument: 'ETHUSDT',
      timeframe: '1D',
      kind: 'horizontal',
      points: [{ time: 1, price: 7 }],
      createdAt: '',
      updatedAt: '',
    },
  ];

  it('keeps only the requested instrument and timeframe', () => {
    const lines = linesFromDrawings(drawings, 'BTCUSDT', '1D');
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => line.kind)).toEqual(['horizontal', 'ray']);
  });

  it('drops the legacy segment kind', () => {
    const legacy: ChartDrawing[] = [
      {
        ...drawings[0],
        id: '5',
        kind: 'segment',
        points: [
          { time: 1, price: 1 },
          { time: 2, price: 2 },
        ],
      },
    ];
    expect(linesFromDrawings(legacy, 'BTCUSDT', '1D')).toHaveLength(0);
  });
});

describe('scaleStartIndex', () => {
  it('finds the first candle at or after the ray start', () => {
    const candles = Array.from({ length: 10 }, (_, i) => candle(i, 100));
    const lines: LevelLine[] = [
      {
        kind: 'ray',
        price: 100,
        p1: { time: candles[3].timestamp, price: 100 },
        p2: { time: candles[5].timestamp, price: 100 },
      },
    ];
    expect(scaleStartIndex(candles, lines)).toBe(3);
  });

  it('is undefined without a ray', () => {
    expect(scaleStartIndex(Array.from({ length: 5 }, (_, i) => candle(i, 100)), [])).toBeUndefined();
  });
});
