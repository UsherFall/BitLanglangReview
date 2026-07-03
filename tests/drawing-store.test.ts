import { describe, expect, it } from 'vitest';
import { DrawingStore } from '../src/server/drawing-store';

describe('Drawing Store', () => {
  it('saves, lists, and deletes chart drawings for an instrument across trades and timeframes', () => {
    const store = new DrawingStore(':memory:');

    const horizontal = store.saveDrawing({
      tradeId: 'trade-1',
      instrument: 'BTC-USDT-SWAP',
      timeframe: '5m',
      kind: 'horizontal',
      points: [{ time: 1653381000, price: 29300 }],
    });
    store.saveDrawing({
      tradeId: 'trade-1',
      instrument: 'BTC-USDT-SWAP',
      timeframe: '5m',
      kind: 'segment',
      points: [
        { time: 1653381000, price: 29300 },
        { time: 1653381300, price: 29400 },
      ],
    });
    store.saveDrawing({
      tradeId: 'trade-2',
      instrument: 'ETH-USDT-SWAP',
      timeframe: '5m',
      kind: 'horizontal',
      points: [{ time: 1653381000, price: 1900 }],
    });

    expect(store.listDrawings({ instrument: 'BTC-USDT-SWAP' })).toHaveLength(2);
    expect(store.listDrawings({ instrument: 'ETH-USDT-SWAP' })).toHaveLength(1);

    store.deleteDrawing(horizontal.id);

    expect(store.listDrawings({ instrument: 'BTC-USDT-SWAP' }).map((drawing) => drawing.kind)).toEqual(['segment']);
  });

  it('saves chart drawings without a trade for Free Replay', () => {
    const store = new DrawingStore(':memory:');

    const drawing = store.saveDrawing({
      tradeId: null,
      instrument: 'BTC-USDT-SWAP',
      timeframe: '5m',
      kind: 'horizontal',
      points: [{ time: 1653381000, price: 29300 }],
    });

    expect(drawing.tradeId).toBeNull();
    expect(store.listDrawings({ instrument: 'BTC-USDT-SWAP' })[0]?.tradeId).toBeNull();
  });
});
