import { describe, expect, it } from 'vitest';
import { isAlertTriggered, type PriceAlert } from '../src/domain/price-alert';

function makeAlert(overrides: Partial<PriceAlert>): PriceAlert {
  return {
    id: 1,
    instrument: 'BTC-USDT-SWAP',
    direction: 'above',
    targetPrice: 100,
    status: 'active',
    createdAt: '2026-08-04T00:00:00.000Z',
    triggeredAt: null,
    ...overrides,
  };
}

describe('isAlertTriggered', () => {
  it('triggers an above alert only when the price reaches or exceeds the target', () => {
    const alert = makeAlert({ direction: 'above', targetPrice: 100 });
    expect(isAlertTriggered(alert, 99)).toBe(false);
    expect(isAlertTriggered(alert, 100)).toBe(true);
    expect(isAlertTriggered(alert, 150)).toBe(true);
  });

  it('triggers a below alert only when the price falls to or under the target', () => {
    const alert = makeAlert({ direction: 'below', targetPrice: 100 });
    expect(isAlertTriggered(alert, 101)).toBe(false);
    expect(isAlertTriggered(alert, 100)).toBe(true);
    expect(isAlertTriggered(alert, 50)).toBe(true);
  });

  it('never triggers an alert that already fired', () => {
    const alert = makeAlert({ direction: 'above', targetPrice: 100, status: 'triggered', triggeredAt: '2026-08-04T01:00:00.000Z' });
    expect(isAlertTriggered(alert, 200)).toBe(false);
  });
});
