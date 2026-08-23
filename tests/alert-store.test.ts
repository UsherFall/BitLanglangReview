import { describe, expect, it } from 'vitest';
import { AlertStore } from '../src/server/alert-store';

describe('AlertStore', () => {
  it('saves and lists alerts with an id and createdAt', () => {
    const store = new AlertStore(':memory:');

    const alert = store.saveAlert({ instrument: 'BTC-USDT-SWAP', direction: 'above', targetPrice: 120000 });
    expect(alert.id).toBeGreaterThan(0);
    expect(alert.status).toBe('active');
    expect(alert.triggeredAt).toBeNull();
    expect(alert.createdAt).toBeTypeOf('string');

    const listed = store.listAlerts();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ instrument: 'BTC-USDT-SWAP', direction: 'above', targetPrice: 120000, status: 'active' });
  });

  it('marks an active alert triggered and reactivates it', () => {
    const store = new AlertStore(':memory:');
    const alert = store.saveAlert({ instrument: 'SOL-USDT-SWAP', direction: 'below', targetPrice: 150 });

    store.markTriggered(alert.id);

    const triggered = store.getById(alert.id);
    expect(triggered?.status).toBe('triggered');
    expect(triggered?.triggeredAt).toBeTypeOf('string');
    expect(store.listActiveAlerts()).toHaveLength(0);

    store.reactivate(alert.id);

    const reactivated = store.getById(alert.id);
    expect(reactivated?.status).toBe('active');
    expect(reactivated?.triggeredAt).toBeNull();
    expect(store.listActiveAlerts().map((item) => item.id)).toEqual([alert.id]);
  });

  it('marking a non-active alert is a no-op', () => {
    const store = new AlertStore(':memory:');
    const alert = store.saveAlert({ instrument: 'BTC-USDT-SWAP', direction: 'above', targetPrice: 120000 });
    store.markTriggered(alert.id);

    store.markTriggered(alert.id);
    expect(store.listAlerts()[0]?.status).toBe('triggered');
  });

  it('deletes an alert', () => {
    const store = new AlertStore(':memory:');
    const alert = store.saveAlert({ instrument: 'ETH-USDT-SWAP', direction: 'above', targetPrice: 3500 });

    store.deleteAlert(alert.id);

    expect(store.listAlerts()).toHaveLength(0);
  });
});
