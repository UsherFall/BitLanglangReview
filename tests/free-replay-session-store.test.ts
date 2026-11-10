import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { FreeReplaySessionStore } from '../src/server/free-replay-session-store';

describe('Free Replay Session Store', () => {
  it('saves, lists, and deletes sessions keyed by instrument and start time', async () => {
    const store = new FreeReplaySessionStore(':memory:');

    store.saveSession({
      instrument: 'BTC-USDT-SWAP',
      startTime: '2024-05-21 10:00',
      dataAnchorTime: '2024-05-21 10:00',
      startCursorTime: 1716267600,
      startProgressTime: 1716268800,
      progressTime: 1716269400,
      cursorTime: 1716268800,
      timeframe: '5m',
      paperTrading: { active: true, trades: [] },
    });
    await new Promise((resolve) => setTimeout(resolve, 2));
    store.saveSession({
      instrument: 'ETH-USDT-SWAP',
      startTime: '2024-05-21 09:00',
      dataAnchorTime: '2024-05-21 09:00',
      startCursorTime: 1716267600,
      startProgressTime: 1716267600,
      progressTime: 1716267600,
      cursorTime: 1716267600,
      timeframe: '15m',
      paperTrading: { active: false, trades: [] },
    });
    await new Promise((resolve) => setTimeout(resolve, 2));

    const sessions = store.listSessions();
    expect(sessions).toHaveLength(2);
    // Most recently saved session comes first.
    expect(sessions[0]?.instrument).toBe('ETH-USDT-SWAP');
    expect(sessions[0]?.updatedAt).toBeTypeOf('string');
    expect(sessions[1]?.paperTrading).toEqual({ active: true, trades: [] });

    const updated = store.saveSession({
      instrument: 'BTC-USDT-SWAP',
      startTime: '2024-05-21 10:00',
      dataAnchorTime: '2024-05-21 10:00',
      startCursorTime: 1716267600,
      startProgressTime: 1716268800,
      progressTime: 1716269400,
      cursorTime: 1716268860,
      timeframe: '5m',
      paperTrading: { active: true, trades: [{ id: 'trade-1' }] },
    });
    await new Promise((resolve) => setTimeout(resolve, 2));

    // Upsert keeps one row per (instrument, start_time) and bumps it to the top.
    expect(store.listSessions()).toHaveLength(2);
    expect(updated.cursorTime).toBe(1716268860);
    const reordered = store.listSessions();
    expect(reordered[0]?.instrument).toBe('BTC-USDT-SWAP');
    expect(reordered[0]?.paperTrading).toEqual({ active: true, trades: [{ id: 'trade-1' }] });

    store.deleteSession('BTC-USDT-SWAP', '2024-05-21 10:00');

    expect(store.listSessions().map((session) => session.instrument)).toEqual(['ETH-USDT-SWAP']);
  });
});

describe('Free Replay Session Store · 记录回放用的行情源（10/21）', () => {
  const base = {
    instrument: 'BTCUSDT',
    startTime: '2024-05-21 10:00',
    dataAnchorTime: '2024-05-21 10:00',
    startCursorTime: 1716267600,
    startProgressTime: 1716268800,
    progressTime: 1716269400,
    cursorTime: 1716268800,
    timeframe: '5m',
    paperTrading: { active: false, trades: [] },
  };

  it('存取 candleSource', () => {
    const store = new FreeReplaySessionStore(':memory:');

    const saved = store.saveSession({ ...base, candleSource: 'bitget' });

    expect(saved.candleSource).toBe('bitget');
    expect(store.listSessions()[0]?.candleSource).toBe('bitget');
    store.close();
  });

  it('没有 candleSource 的旧会话读成 undefined（按旧行为：币安）', () => {
    const store = new FreeReplaySessionStore(':memory:');

    const saved = store.saveSession({ ...base });

    expect(saved.candleSource).toBeUndefined();
    expect(store.listSessions()[0]?.candleSource).toBeUndefined();
    store.close();
  });
});

describe('Free Replay Session Store · 结束/恢复复盘状态（11/10）', () => {
  const base = {
    instrument: 'BTCUSDT',
    startTime: '2024-05-21 10:00',
    dataAnchorTime: '2024-05-21 10:00',
    startCursorTime: 1716267600,
    startProgressTime: 1716268800,
    progressTime: 1716269400,
    cursorTime: 1716268800,
    timeframe: '5m',
    paperTrading: { active: true, trades: [] },
  };

  it('round-trips ended, defaults a missing status to active, and upserts back to active', () => {
    const store = new FreeReplaySessionStore(':memory:');
    try {
      expect(store.saveSession({ ...base }).reviewStatus).toBe('active');
      expect(store.saveSession({ ...base, reviewStatus: 'ended' }).reviewStatus).toBe('ended');
      expect(store.listSessions()[0]?.reviewStatus).toBe('ended');
      expect(store.saveSession({ ...base, reviewStatus: 'active' }).reviewStatus).toBe('active');
      expect(store.listSessions()).toHaveLength(1);
      expect(store.listSessions()[0]?.reviewStatus).toBe('active');
    } finally {
      store.close();
    }
  });

  it('adds review_status to a real legacy schema and preserves the existing row', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-review-status-'));
    const filename = path.join(directory, 'review.sqlite');
    const legacy = new Database(filename);
    legacy.exec(`
      create table free_replay_sessions (
        instrument text not null,
        candle_source text,
        start_time text not null,
        timeframe text not null,
        data_anchor_time text not null,
        start_cursor_time integer not null,
        start_progress_time integer not null,
        progress_time integer not null,
        cursor_time integer not null,
        paper_trading_json text not null,
        updated_at text not null,
        primary key (instrument, start_time)
      );
      insert into free_replay_sessions values (
        'BTCUSDT', 'bitget', '2024-05-21 10:00', '5m', '2024-05-21 10:00',
        1716267600, 1716268800, 1716269400, 1716268800,
        '{"active":true,"trades":[]}', '2024-05-21T12:00:00+08:00'
      );
    `);
    legacy.close();

    const store = new FreeReplaySessionStore(filename);
    try {
      const migrated = store.listSessions();
      expect(migrated).toHaveLength(1);
      expect(migrated[0]).toMatchObject({
        instrument: 'BTCUSDT',
        candleSource: 'bitget',
        reviewStatus: 'active',
        paperTrading: { active: true, trades: [] },
      });
      store.saveSession({ ...base, reviewStatus: 'ended' });
      expect(store.listSessions()[0]?.reviewStatus).toBe('ended');
    } finally {
      store.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
