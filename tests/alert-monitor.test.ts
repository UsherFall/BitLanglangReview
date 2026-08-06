import { describe, expect, it, vi } from 'vitest';
import { AlertMonitor } from '../src/server/alert-monitor';
import { AlertStore } from '../src/server/alert-store';
import type { Ticker } from '../src/server/market-data';
import type { Notifier } from '../src/server/notify';

function makeStore() {
  return new AlertStore(':memory:');
}

function makeNotifier() {
  const send = vi.fn(async () => undefined);
  return { send, notifier: { send } as Notifier };
}

const tickers: Ticker[] = [
  { instrument: 'BTC-USDT-SWAP', quoteVolume24h: 1, lastPrice: 120000, change24h: 0 },
  { instrument: 'ETH-USDT-SWAP', quoteVolume24h: 1, lastPrice: 3000, change24h: 0 },
];

describe('AlertMonitor.tick', () => {
  it('fires a qualifying alert once, marks it triggered, and sends the notification', async () => {
    const store = makeStore();
    const { send, notifier } = makeNotifier();
    const alert = store.saveAlert({ instrument: 'BTC-USDT-SWAP', direction: 'above', targetPrice: 119000 });
    const monitor = new AlertMonitor({ store, notifier, tickerSource: { listTickers: async () => tickers }, logger: vi.fn() });

    await monitor.tick();
    await monitor.tick();

    expect(send).toHaveBeenCalledTimes(1);
    const [title, message] = send.mock.calls[0] as unknown as [string, string];
    expect(title).toContain('BTC');
    expect(title).toContain('上破');
    expect(message).toContain('当前价: 120000');
    expect(store.getById(alert.id)?.status).toBe('triggered');
  });

  it('does not fire an alert whose condition is not met', async () => {
    const store = makeStore();
    const { send, notifier } = makeNotifier();
    const alert = store.saveAlert({ instrument: 'BTC-USDT-SWAP', direction: 'above', targetPrice: 150000 });
    const monitor = new AlertMonitor({ store, notifier, tickerSource: { listTickers: async () => tickers }, logger: vi.fn() });

    await monitor.tick();

    expect(send).not.toHaveBeenCalled();
    expect(store.getById(alert.id)?.status).toBe('active');
  });

  it('skips an alert whose instrument is missing from the tickers', async () => {
    const store = makeStore();
    const { send, notifier } = makeNotifier();
    store.saveAlert({ instrument: 'SOL-USDT-SWAP', direction: 'above', targetPrice: 150 });
    const monitor = new AlertMonitor({ store, notifier, tickerSource: { listTickers: async () => tickers }, logger: vi.fn() });

    await monitor.tick();

    expect(send).not.toHaveBeenCalled();
  });

  it('does not re-fire an alert that was already triggered', async () => {
    const store = makeStore();
    const { send, notifier } = makeNotifier();
    const alert = store.saveAlert({ instrument: 'BTC-USDT-SWAP', direction: 'above', targetPrice: 119000 });
    store.markTriggered(alert.id);
    const monitor = new AlertMonitor({ store, notifier, tickerSource: { listTickers: async () => tickers }, logger: vi.fn() });

    await monitor.tick();

    expect(send).not.toHaveBeenCalled();
  });

  it('skips the tick entirely when there are no active alerts', async () => {
    const store = makeStore();
    const { send, notifier } = makeNotifier();
    const listTickers = vi.fn(async () => tickers);
    const monitor = new AlertMonitor({ store, notifier, tickerSource: { listTickers }, logger: vi.fn() });

    await monitor.tick();

    expect(listTickers).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('does not overlap ticks when the previous tick is still running', async () => {
    const store = makeStore();
    const { notifier } = makeNotifier();
    store.saveAlert({ instrument: 'BTC-USDT-SWAP', direction: 'above', targetPrice: 100 });
    const listTickers = vi.fn(async () => tickers);
    const monitor = new AlertMonitor({ store, notifier, tickerSource: { listTickers }, logger: vi.fn() });

    const first = monitor.tick();
    await monitor.tick();
    await first;

    expect(listTickers).toHaveBeenCalledTimes(1);
  });
});
