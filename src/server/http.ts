import { ProxyAgent, fetch as fetchWithDispatcher } from 'undici';

export type FetchJson = (url: string) => Promise<unknown>;

/** RequestInit shape undici's fetch accepts (avoids DOM/undici type drift). */
type FetchInit = NonNullable<Parameters<typeof fetchWithDispatcher>[1]>;

/**
 * Minimal response surface `fetchJsonWithRetry` relies on. Decoupled from
 * undici's `Response` type so test mocks (DOM `Response`) satisfy it.
 */
export interface FetchResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}

/** A raw fetch implementation, injectable into `fetchJsonWithRetry` for tests. */
export type FetchImpl = (url: string, init?: FetchInit) => Promise<FetchResponse>;

/**
 * Outbound proxy for market-data hosts (Binance fapi / OKX www). By default
 * requests go direct, so a system-level transparent proxy (for example Clash
 * TUN mode) can handle routing without this process knowing the proxy port.
 * If an explicit proxy is needed, set `HTTPS_PROXY` / `https_proxy` /
 * `HTTP_PROXY` / `http_proxy`; set one of them to an empty string to force a
 * direct connection.
 * Server酱 notify keeps using global fetch — `ftqq.com` is reachable from CN.
 */
export function resolveProxyUrl(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const fromEnv =
    env.HTTPS_PROXY ??
    env.https_proxy ??
    env.HTTP_PROXY ??
    env.http_proxy;
  return fromEnv === '' ? undefined : fromEnv;
}

const proxyUrl = resolveProxyUrl();
const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

/** Per-attempt timeout (unchanged contract from the previous single-attempt fetch). */
const REQUEST_TIMEOUT_MS = 12_000;

/** Retry tuning per retryable HTTP status (Binance futures rate limits). */
type StatusRetry = { maxAttempts: number; baseDelayMs: number; maxDelayMs: number };
const RETRY_BY_STATUS: Record<number, StatusRetry> = {
  // Weight-limit hit: the weight window is per-minute, so without a Retry-After
  // the backoff starts at 10s (long enough to straddle the minute boundary in
  // the common case) and grows to 30s. The global gate (when attached) stops
  // the WHOLE pipeline during this window, so we never "continue sending after
  // a 429" — which is exactly what Binance escalates to an IP ban (418).
  429: { maxAttempts: 3, baseDelayMs: 10_000, maxDelayMs: 30_000 },
  // IP auto-ban: wait the FULL ban (Retry-After, else 2min). Per Binance,
  // "IP bans ... scale in duration for repeat offenders, from 2 minutes to 3
  // days", and requesting DURING a ban prolongs it. With a gate attached the
  // ban stops all outbound requests and the triggering request fails fast
  // instead of hanging; without a gate (OKX path) the old wait-then-retry-once
  // behavior is kept.
  418: { maxAttempts: 2, baseDelayMs: 120_000, maxDelayMs: 120_000 },
};

/**
 * IP-level rate-limit gate. Binance's 429/418 are signals about the whole IP,
 * not about a single request — a scan's 5 concurrent workers plus the alert
 * monitor must ALL stop when one of them trips a limit, or the ban self-extends
 * (429 → 418 → up to 3 days). The gate is shared module state so every Binance
 * caller checks it before each request.
 */
export type RateLimitKind = '429' | '418';
export type RateGate = {
  /** Epoch-ms until outbound requests are paused, or 0 when open. */
  blockedUntil(): number;
  /** Which limit tripped the gate; null when open/expired. */
  reason(): RateLimitKind | null;
  /** Records a global backoff/ban plus a user-facing warning (consecutive dups dropped). */
  block(until: number, reason: RateLimitKind, message: string): void;
  /** Returns and clears all accumulated warnings. */
  takeWarnings(): string[];
};

export function createRateGate(): RateGate {
  let until = 0;
  let currentReason: RateLimitKind | null = null;
  const warnings: string[] = [];
  return {
    blockedUntil: () => until,
    reason: () => (until > Date.now() ? currentReason : null),
    block(nextUntil, nextReason, message) {
      // A heavier ban (418) extends the gate; a milder backoff never shortens it.
      if (nextUntil > until) {
        until = nextUntil;
        currentReason = nextReason;
      }
      if (warnings[warnings.length - 1] !== message) warnings.push(message);
    },
    takeWarnings: () => warnings.splice(0),
  };
}

/** Shared Binance IP-level gate, so concurrent scans and the alert monitor stop together. */
export const binanceRateGate = createRateGate();

/**
 * JSON GET with exponential-backoff retry for Binance rate-limit responses.
 * HTTP 429 / 418 are retried (429 honoring `Retry-After`, both with jitter);
 * any other non-OK status throws immediately, keeping the previous single-attempt
 * contract. Network/timeout errors are NOT retried — they are not rate-limit
 * signals, and retrying them would only multiply proxy failures.
 *
 * When a `gate` is attached (the Binance path), 429/418 additionally block the
 * WHOLE pipeline for the backoff/ban duration and surface a user-facing warning:
 * - 429 → record warning + global backoff, then the current request retries;
 * - 418 → record warning + global ban, then fail fast (never fire during a ban).
 * Without a gate (OKX path) the previous per-request behavior is preserved.
 */
export async function fetchJsonWithRetry(url: string, fetchImpl: FetchImpl, gate?: RateGate): Promise<unknown> {
  for (let attempt = 1; ; attempt += 1) {
    await waitOutGate(gate);
    const response = await fetchImplWithTimeout(url, fetchImpl);
    if (response.ok) return response.json();
    const retry = RETRY_BY_STATUS[response.status];
    if (!retry) throw new Error(`HTTP ${response.status}`);
    const delayMs = retryDelayMs(response, attempt, retry);
    if (response.status === 418) {
      gate?.block(Date.now() + delayMs, '418', `币安 IP 被自动封禁(HTTP 418)，${Math.ceil(delayMs / 1000)} 秒内不再发请求，请稍后重试`);
      if (gate) throw new Error('HTTP 418 (Binance IP auto-banned)');
    }
    if (attempt >= retry.maxAttempts) {
      gate?.block(Date.now() + delayMs, response.status === 418 ? '418' : '429', `币安${response.status === 418 ? ' IP 被自动封禁(HTTP 418)' : '限频(HTTP 429)'}，已自动退避 ${Math.ceil(delayMs / 1000)} 秒`);
      throw new Error(`HTTP ${response.status}`);
    }
    gate?.block(Date.now() + delayMs, '429', `币安限频(HTTP 429)，已自动退避 ${Math.ceil(delayMs / 1000)} 秒`);
    await sleep(delayMs);
  }
}

/**
 * Holds a request until the shared gate opens. A 429 backoff is waited out
 * (scan pauses, then resumes); an active 418 ban fails fast — the IP is banned,
 * so firing would only prolong the ban, and waiting the full 2min inside a scan
 * request would hang the UI with no clear signal.
 */
async function waitOutGate(gate: RateGate | undefined): Promise<void> {
  if (!gate) return;
  const until = gate.blockedUntil();
  if (until <= Date.now()) return;
  if (gate.reason() === '418') {
    throw new Error(`HTTP 418 (Binance IP auto-banned; retry after ~${Math.ceil((until - Date.now()) / 1000)}s)`);
  }
  await sleep(until - Date.now());
}

async function fetchImplWithTimeout(url: string, fetchImpl: FetchImpl): Promise<FetchResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function retryDelayMs(response: FetchResponse, attempt: number, retry: StatusRetry): number {
  // 429 and 418 both carry `Retry-After` (seconds); honor it — especially for
  // 418, where resuming before the ban lifts prolongs the ban.
  const retryAfter = Number(response.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1_000;
  const base = Math.min(retry.baseDelayMs * 2 ** (attempt - 1), retry.maxDelayMs);
  return base + Math.random() * (base / 2);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Shared JSON GET helper with a timeout and rate-limit retry, routed through the
 * configured proxy (or direct when none is set). Throws on non-OK responses so
 * route handlers can convert failures to HTTP 502 without crashing.
 */
export async function defaultFetchJson(url: string): Promise<unknown> {
  return labeledFetch(url, 'OKX request failed');
}

/**
 * Same timeout/error contract as `defaultFetchJson` but for Binance endpoints,
 * so a failed fapi call surfaces as a readable 502 instead of crashing.
 */
export async function defaultBinanceFetchJson(url: string): Promise<unknown> {
  return labeledFetch(url, 'Binance request failed', binanceRateGate);
}

/**
 * JSON GET with custom headers (signed Bitget private-API requests), routed
 * through the shared proxy with the same 12s timeout. Unlike the other default
 * fetchers, a non-OK status keeps the response body so Bitget auth/IP errors
 * surface their `msg` instead of a bare HTTP code.
 */
export async function defaultBitgetFetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchViaProxy(url, { headers, signal: controller.signal });
    if (response.ok) return response.json();
    const detail = await readErrorDetail(response);
    throw new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Bitget request timed out after 12s');
    }
    if (error instanceof Error && error.message.startsWith('HTTP ')) throw error;
    throw new Error(`Bitget request failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function readErrorDetail(response: FetchResponse): Promise<string> {
  try {
    const body = (await response.json()) as { msg?: unknown } | null;
    if (body && typeof body === 'object' && body.msg != null) return String(body.msg);
  } catch {
    // Non-JSON error body; fall back to the bare status code.
  }
  return '';
}

async function labeledFetch(url: string, label: string, gate?: RateGate): Promise<unknown> {
  try {
    return await fetchJsonWithRetry(url, fetchViaProxy, gate);
  } catch (error) {
    throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function fetchViaProxy(url: string, init?: FetchInit): Promise<FetchResponse> {
  try {
    return await fetchWithDispatcher(url, { ...(init ?? {}), ...(dispatcher ? { dispatcher } : {}) });
  } catch (error) {
    // A network-level failure through a configured proxy hides the real cause
    // behind undici's generic "fetch failed"; surface the proxy so the user can
    // tell a blocked host from a dead/misconfigured proxy. Abort (timeout) is
    // not a "fetch failed" TypeError and passes through untouched.
    if (dispatcher && error instanceof TypeError && error.message.startsWith('fetch failed')) {
      const cause = error.cause instanceof Error ? error.cause.message : '';
      throw new Error(`fetch failed via proxy ${proxyUrl}${cause ? `: ${cause}` : ''}`);
    }
    throw error;
  }
}
