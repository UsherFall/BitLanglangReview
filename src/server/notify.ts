export interface Notifier {
  send(title: string, message: string): Promise<void>;
}

type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<Response>;

type ServerChanResponse = {
  code?: number;
  message?: string;
};

/**
 * Pushes a WeChat notification through Server酱 (sctapi.ftqq.com). `key` is
 * the SendKey from https://sct.ftqq.com/. Other notification channels (email,
 * QQ) can follow the same `Notifier` contract later.
 */
export class ServerChanNotifier implements Notifier {
  constructor(
    private readonly key: string,
    private readonly fetchFn: FetchLike = fetch,
  ) {}

  async send(title: string, message: string): Promise<void> {
    const url = `https://sctapi.ftqq.com/${encodeURIComponent(this.key)}.send`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await this.fetchFn(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ title, desp: message }).toString(),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Server酱 request failed: ${response.status}`);
      }
      const payload = (await response.json()) as ServerChanResponse;
      if (payload.code !== 0) {
        throw new Error(`Server酱 rejected: ${payload.message ?? String(payload.code)}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Used when no Server酱 SendKey is configured. The monitor still runs, but
 * notifications are skipped and the alert lifecycle stays unchanged.
 */
export class NoopNotifier implements Notifier {
  constructor(private readonly logger: (message: string) => void = console.warn) {}

  async send(_title: string, _message: string): Promise<void> {
    this.logger('SERVERCHAN_KEY is not configured; notification skipped');
  }
}
