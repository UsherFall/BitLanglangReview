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
 * Pushes a notification through Server酱. `keyOrUrl` is one of three formats:
 * - a full send URL (ServerChan³ `sctp` 推送通道 or self-hosted) → used as-is,
 *   e.g. `https://12345.push.ft07.com/send/sctp...send`;
 * - a bare ServerChan³ `sctp{uid}t...` SendKey → built into `https://{uid}.push.ft07.com/send/{key}.send`
 *   (uid extracted per the official regex `/^sctp(\d+)t/`);
 * - a bare Server酱 Turbo `SCT...` SendKey → built into `https://sctapi.ftqq.com/{key}.send`
 *   (WeChat 测试号/服务号).
 * Other notification channels (email, QQ) can follow the same `Notifier` contract later.
 */
export class ServerChanNotifier implements Notifier {
  constructor(
    private readonly keyOrUrl: string,
    private readonly fetchFn: FetchLike = fetch,
  ) {}

  async send(title: string, message: string): Promise<void> {
    const url = resolveSendUrl(this.keyOrUrl);
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
 * Maps the configured Server酱 value to its send endpoint. Full URLs are used
 * verbatim; bare `sctp{uid}t...` keys (ServerChan³ 推送通道) get the uid-specific
 * `{uid}.push.ft07.com` host; anything else (Server酱 Turbo `SCT...`) hits the
 * `sctapi.ftqq.com` endpoint.
 */
function resolveSendUrl(config: string): string {
  if (config.startsWith('http')) return config;
  const sctp = /^sctp(\d+)t/.exec(config);
  if (sctp) return `https://${sctp[1]}.push.ft07.com/send/${encodeURIComponent(config)}.send`;
  return `https://sctapi.ftqq.com/${encodeURIComponent(config)}.send`;
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
