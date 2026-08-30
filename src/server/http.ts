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
  // Transient weight-limit hit: short backoff, Retry-After honored when present.
  429: { maxAttempts: 4, baseDelayMs: 1_000, maxDelayMs: 5_000 },
  // IP auto-ban: wait the FULL ban (Retry-After, else 2min) then ONE retry. Per
  // Binance, retrying DURING a ban prolongs it (2min → up to 3 days), so a second
  // recovery attempt is never made — a still-banned IP throws instead.
  418: { maxAttempts: 2, baseDelayMs: 120_000, maxDelayMs: 120_000 },
};

/**
 * JSON GET with exponential-backoff retry for Binance rate-limit responses.
 * HTTP 429 / 418 are retried (429 honoring `Retry-After`, both with jitter);
 * any other non-OK status throws immediately, keeping the previous single-attempt
 * contract. Network/timeout errors are NOT retried — they are not rate-limit
 * signals, and retrying them would only multiply proxy failures.
 */
export async function fetchJsonWithRetry(url: string, fetchImpl: FetchImpl): Promise<unknown> {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetchImplWithTimeout(url, fetchImpl);
    if (response.ok) return response.json();
    const retry = RETRY_BY_STATUS[response.status];
    if (!retry || attempt >= retry.maxAttempts) {
      throw new Error(`HTTP ${response.status}`);
    }
    await sleep(retryDelayMs(response, attempt, retry));
  }
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
  return labeledFetch(url, 'Binance request failed');
}

async function labeledFetch(url: string, label: string): Promise<unknown> {
  try {
    return await fetchJsonWithRetry(url, fetchViaProxy);
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
