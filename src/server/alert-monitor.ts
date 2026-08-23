import { isAlertTriggered, type PriceAlert } from '../domain/price-alert';
import type { AlertStore } from './alert-store';
import { BinanceTickerSource } from './binance-tickers';
import type { TickerSource } from './market-data';
import type { Notifier } from './notify';

export type AlertMonitorOptions = {
  store: AlertStore;
  notifier: Notifier;
  tickerSource?: TickerSource;
  intervalMs?: number;
  logger?: (message: string) => void;
};

/**
 * Periodically checks active price alerts against the latest market prices and
 * pushes a notification for each alert whose condition is met. The ticker
 * source is injectable (defaults to Binance, matching the coin scan) so an alert
 * placed from the scan's 「设警报」 button monitors the same instrument name that
 * produced the scan row. Alerts fire at most once: the store marks the alert
 * triggered before the notification is sent, so a failure between mark and send
 * cannot cause a duplicate push.
 *
 * A tick that is still running when the next interval fires is skipped, so a
 * slow ticker fetch never queues up overlapping checks.
 */
export class AlertMonitor {
  private readonly store: AlertStore;
  private readonly notifier: Notifier;
  private readonly tickerSource: TickerSource;
  private readonly intervalMs: number;
  private readonly logger: (message: string) => void;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(options: AlertMonitorOptions) {
    this.store = options.store;
    this.notifier = options.notifier;
    this.tickerSource = options.tickerSource ?? new BinanceTickerSource();
    this.intervalMs = options.intervalMs ?? 60_000;
    this.logger = options.logger ?? ((message) => console.log(`[alert-monitor] ${message}`));
  }

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const alerts = this.store.listActiveAlerts();
      if (alerts.length === 0) return;
      const tickers = await this.tickerSource.listTickers();
      const priceByInstrument = new Map(tickers.map((ticker) => [ticker.instrument, ticker.lastPrice]));
      for (const alert of alerts) {
        const price = priceByInstrument.get(alert.instrument);
        if (price === undefined) continue;
        if (!isAlertTriggered(alert, price)) continue;
        this.store.markTriggered(alert.id);
        try {
          await this.notifier.send(alertTitle(alert, price), alertMessage(alert, price));
        } catch (error) {
          this.logger(`failed to notify ${alert.instrument}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (error) {
      this.logger(`tick failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }
}

function alertTitle(alert: PriceAlert, price: number): string {
  const direction = alert.direction === 'above' ? '上破' : '下破';
  return `价格警报: ${shortInstrument(alert.instrument)} ${direction} ${formatPrice(alert.targetPrice)}`;
}

function alertMessage(alert: PriceAlert, price: number): string {
  const direction = alert.direction === 'above' ? '上破' : '下破';
  return [
    `币: ${shortInstrument(alert.instrument)}`,
    `方向: ${direction}`,
    `目标价: ${formatPrice(alert.targetPrice)}`,
    `当前价: ${formatPrice(price)}`,
    `触发时间: ${new Date().toISOString()}`,
  ].join('\n');
}

function shortInstrument(instrument: string): string {
  return instrument.endsWith('-USDT-SWAP') ? instrument.slice(0, -'-USDT-SWAP'.length) : instrument;
}

function formatPrice(value: number): string {
  if (value >= 1000) return value.toFixed(0);
  if (value >= 1) return value.toFixed(2);
  return value.toFixed(4);
}
