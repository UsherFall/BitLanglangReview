export type AlertDirection = 'above' | 'below';

export type AlertStatus = 'active' | 'triggered';

export type PriceAlert = {
  id: number;
  instrument: string;
  direction: AlertDirection;
  targetPrice: number;
  status: AlertStatus;
  createdAt: string;
  triggeredAt: string | null;
};

/**
 * A price alert fires at most once while it is active: an `above` alert
 * triggers when `currentPrice >= targetPrice`, a `below` alert when
 * `currentPrice <= targetPrice` (equal price counts as triggered). Alerts
 * that already fired (`status !== 'active'`) never trigger again, so the
 * monitor marks the alert triggered before sending to avoid duplicate pushes.
 */
export function isAlertTriggered(alert: PriceAlert, currentPrice: number): boolean {
  if (alert.status !== 'active') return false;
  return alert.direction === 'above' ? currentPrice >= alert.targetPrice : currentPrice <= alert.targetPrice;
}
