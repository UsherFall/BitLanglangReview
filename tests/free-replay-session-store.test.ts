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
