import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DrawingStore } from '../src/server/drawing-store';

describe('Drawing Store', () => {
  it('saves, lists, and deletes chart drawings for an instrument across trades and timeframes', () => {
    const store = new DrawingStore(':memory:');

    const horizontal = store.saveDrawing({
      tradeId: 'trade-1',
      instrument: 'BTC-USDT-SWAP',
      board: 'review',
      timeframe: '5m',
      kind: 'horizontal',
      points: [{ time: 1653381000, price: 29300 }],
    });
    store.saveDrawing({
      tradeId: 'trade-1',
      instrument: 'BTC-USDT-SWAP',
      board: 'review',
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
      board: 'review',
      timeframe: '5m',
      kind: 'horizontal',
      points: [{ time: 1653381000, price: 1900 }],
    });

    expect(store.listDrawings({ instrument: 'BTC-USDT-SWAP', board: 'review' })).toHaveLength(2);
    expect(store.listDrawings({ instrument: 'ETH-USDT-SWAP', board: 'review' })).toHaveLength(1);

    store.deleteDrawing(horizontal.id);

    expect(store.listDrawings({ instrument: 'BTC-USDT-SWAP', board: 'review' }).map((drawing) => drawing.kind)).toEqual(['segment']);
  });

  it('saves chart drawings without a trade for Free Replay', () => {
    const store = new DrawingStore(':memory:');

    const drawing = store.saveDrawing({
      tradeId: null,
      instrument: 'BTC-USDT-SWAP',
      board: 'review',
      timeframe: '5m',
      kind: 'horizontal',
      points: [{ time: 1653381000, price: 29300 }],
    });

    expect(drawing.tradeId).toBeNull();
    expect(store.listDrawings({ instrument: 'BTC-USDT-SWAP', board: 'review' })[0]?.tradeId).toBeNull();
  });
});

describe('Drawing Store · 价位基准（10/21）', () => {
  it('存取 refPrice / refTime（画线那一刻的价格坐标系）', () => {
    const store = new DrawingStore(':memory:');

    const saved = store.saveDrawing({
      tradeId: null,
      instrument: 'BTCUSDT',
      board: 'scan',
      timeframe: '1D',
      kind: 'horizontal',
      points: [{ time: 1_700_000_000, price: 100 }],
      refPrice: 99.5,
      refTime: 1_700_000_000_000,
    });

    expect(saved.refPrice).toBe(99.5);
    expect(saved.refTime).toBe(1_700_000_000_000);
    expect(store.listDrawings({ instrument: 'BTCUSDT', board: 'scan' })[0]?.refPrice).toBe(99.5);
    store.close();
  });

  it('旧数据没有基准字段时读成 undefined（按不换算处理）', () => {
    const store = new DrawingStore(':memory:');

    const saved = store.saveDrawing({
      tradeId: null,
      instrument: 'BTCUSDT',
      board: 'scan',
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

    store.saveDrawing({ tradeId: null, instrument: 'BTCUSDT', board: 'scan', timeframe: '1D', kind: 'horizontal', points: [{ time: 1, price: 1 }] });
    store.saveDrawing({ tradeId: null, instrument: 'BTCUSDT', board: 'scan', timeframe: '5m', kind: 'horizontal', points: [{ time: 1, price: 2 }] });

    expect(store.listDrawings({ instrument: 'BTCUSDT', board: 'scan', timeframe: '1D' })).toHaveLength(1);
    expect(store.listDrawings({ instrument: 'BTCUSDT', board: 'scan' })).toHaveLength(2);
    store.close();
  });
});

describe('Drawing Store · 画线板（10/26）', () => {
  it('板隔离：同一 instrument 名下两个板的线互不串扰', () => {
    const store = new DrawingStore(':memory:');

    store.saveDrawing({ tradeId: 'trade-1', instrument: 'BTC-USDT-SWAP', board: 'review', timeframe: '1D', kind: 'horizontal', points: [{ time: 1, price: 100 }] });
    store.saveDrawing({ tradeId: null, instrument: 'BTC-USDT-SWAP', board: 'scan', timeframe: '1D', kind: 'horizontal', points: [{ time: 1, price: 200 }] });

    const review = store.listDrawings({ instrument: 'BTC-USDT-SWAP', board: 'review' });
    const scan = store.listDrawings({ instrument: 'BTC-USDT-SWAP', board: 'scan' });
    expect(review.map((drawing) => drawing.points[0]?.price)).toEqual([100]);
    expect(scan.map((drawing) => drawing.points[0]?.price)).toEqual([200]);
    store.close();
  });

  it('板内 canonical 互见：JUP-USDT-SWAP 存的线，查 JUPUSDT 同板可见、异板不可见', () => {
    const store = new DrawingStore(':memory:');

    store.saveDrawing({ tradeId: null, instrument: 'JUP-USDT-SWAP', board: 'scan', timeframe: '1D', kind: 'horizontal', points: [{ time: 1, price: 0.3 }] });
    store.saveDrawing({ tradeId: 'trade-9', instrument: 'JUP-USDT-SWAP', board: 'review', timeframe: '1D', kind: 'horizontal', points: [{ time: 1, price: 0.4 }] });

    // 扫描源从 OKX 切到 Bitget 后，抽屉查的是 JUPUSDT —— 同板仍可见。
    expect(store.listDrawings({ instrument: 'JUPUSDT', board: 'scan' })).toHaveLength(1);
    // 复盘板只看到自己的那条，scan 板的线不漏过去。
    expect(store.listDrawings({ instrument: 'JUPUSDT', board: 'review' })).toHaveLength(1);
    expect(store.listDrawings({ instrument: 'JUPUSDT', board: 'review' })[0]?.points[0]?.price).toBe(0.4);
    store.close();
  });

  it('listDrawingsByTimeframe 按板过滤：扫描只拿到 scan 板的线', () => {
    const store = new DrawingStore(':memory:');

    store.saveDrawing({ tradeId: 'trade-1', instrument: 'BTC-USDT-SWAP', board: 'review', timeframe: '1D', kind: 'horizontal', points: [{ time: 1, price: 100 }] });
    store.saveDrawing({ tradeId: null, instrument: 'ETHUSDT', board: 'scan', timeframe: '1D', kind: 'horizontal', points: [{ time: 1, price: 2000 }] });
    store.saveDrawing({ tradeId: null, instrument: 'SOLUSDT', board: 'scan', timeframe: '5m', kind: 'horizontal', points: [{ time: 1, price: 30 }] });

    expect(store.listDrawingsByTimeframe('1D', 'scan').map((drawing) => drawing.instrument)).toEqual(['ETHUSDT']);
    expect(store.listDrawingsByTimeframe('1D', 'review').map((drawing) => drawing.instrument)).toEqual(['BTC-USDT-SWAP']);
    expect(store.listDrawingsByTimeframe('5m', 'scan')).toHaveLength(1);
    store.close();
  });

  it('迁移：存量行默认 review，10-21 后无 trade_id 的 native 命名行归 scan（R4）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drawing-store-'));
    const file = join(dir, 'review.sqlite');
    try {
      // 造一个 board 列存在之前的旧库（10/21  schema：含 ref 列、trade_id 可空）。
      const seed = new Database(file);
      seed.exec(`
        create table chart_drawings (
          id text primary key,
          trade_id text,
          instrument text not null,
          timeframe text not null,
          kind text not null,
          points_json text not null,
          ref_price real,
          ref_time integer,
          created_at text not null,
          updated_at text not null
        );
      `);
      const insert = seed.prepare(
        `insert into chart_drawings (id, trade_id, instrument, timeframe, kind, points_json, ref_price, ref_time, created_at, updated_at)
         values (@id, @tradeId, @instrument, '1D', 'horizontal', '[]', null, null, @createdAt, @createdAt)`,
      );
      // 复盘图的线（有 trade_id）→ review
      insert.run({ id: 'r1', tradeId: 'trade-1', instrument: 'JUP-USDT-SWAP', createdAt: '2026-09-16T15:53:58.238Z' });
      // 回溯图的线（无 trade_id，OKX 名）→ review
      insert.run({ id: 'r2', tradeId: null, instrument: 'UB-USDT-SWAP', createdAt: '2026-10-22T02:48:36.907Z' });
      // 回溯图的线（无 trade_id，native 名，但早于抽屉上线 10-21）→ review
      insert.run({ id: 'r3', tradeId: null, instrument: 'QNTUSDT', createdAt: '2026-10-04T07:28:20.929Z' });
      // 抽屉的线（无 trade_id，native 名，10-21 后）→ scan
      insert.run({ id: 's1', tradeId: null, instrument: 'JUPUSDT', createdAt: '2026-10-26T02:26:53.937Z' });
      insert.run({ id: 's2', tradeId: null, instrument: 'ASTERUSDT', createdAt: '2026-10-26T02:27:26.328Z' });
      seed.close();

      const store = new DrawingStore(file);
      expect(store.listDrawings({ instrument: 'JUPUSDT', board: 'scan' }).map((drawing) => drawing.id).sort()).toEqual(['s1']);
      expect(store.listDrawings({ instrument: 'ASTERUSDT', board: 'scan' }).map((drawing) => drawing.id)).toEqual(['s2']);
      expect(store.listDrawings({ instrument: 'JUP-USDT-SWAP', board: 'review' }).map((drawing) => drawing.id)).toEqual(['r1']);
      expect(store.listDrawings({ instrument: 'UB-USDT-SWAP', board: 'review' }).map((drawing) => drawing.id)).toEqual(['r2']);
      expect(store.listDrawings({ instrument: 'QNTUSDT', board: 'review' }).map((drawing) => drawing.id)).toEqual(['r3']);
      // 幂等：再开一次不重复迁移、不改归类。
      store.close();
      const reopened = new DrawingStore(file);
      expect(reopened.listDrawings({ instrument: 'JUPUSDT', board: 'scan' })).toHaveLength(1);
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
