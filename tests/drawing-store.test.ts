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

describe('Drawing Store · 价位基准（10/21）', () => {
  it('存取 refPrice / refTime（画线那一刻的价格坐标系）', () => {
    const store = new DrawingStore(':memory:');

    const saved = store.saveDrawing({
      tradeId: null,
      instrument: 'BTCUSDT',
      timeframe: '1D',
      kind: 'horizontal',
      points: [{ time: 1_700_000_000, price: 100 }],
      refPrice: 99.5,
      refTime: 1_700_000_000_000,
    });

    expect(saved.refPrice).toBe(99.5);
    expect(saved.refTime).toBe(1_700_000_000_000);
    expect(store.listDrawings({ instrument: 'BTCUSDT' })[0]?.refPrice).toBe(99.5);
    store.close();
  });

  it('旧数据没有基准字段时读成 undefined（按不换算处理）', () => {
    const store = new DrawingStore(':memory:');

    const saved = store.saveDrawing({
      tradeId: null,
      instrument: 'BTCUSDT',
      timeframe: '1D',
      kind: 'horizontal',
      points: [{ time: 1_700_000_000, price: 100 }],
    });

    expect(saved.refPrice).toBeUndefined();
    expect(saved.refTime).toBeUndefined();
    store.close();
  });

  it('按 timeframe 过滤（每条线用它自己的周期与尺子）', () => {
    const store = new DrawingStore(':memory:');

    store.saveDrawing({ tradeId: null, instrument: 'BTCUSDT', timeframe: '1D', kind: 'horizontal', points: [{ time: 1, price: 1 }] });
    store.saveDrawing({ tradeId: null, instrument: 'BTCUSDT', timeframe: '5m', kind: 'horizontal', points: [{ time: 1, price: 2 }] });

    expect(store.listDrawings({ instrument: 'BTCUSDT', timeframe: '1D' })).toHaveLength(1);
    expect(store.listDrawings({ instrument: 'BTCUSDT' })).toHaveLength(2);
    store.close();
  });
});
