import { ProxyAgent, fetch as fetchWithDispatcher } from 'undici';

export type FetchJson = (url: string) => Promise<unknown>;

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

/**
 * Shared JSON GET helper with a timeout, routed through the configured proxy
 * (or direct when none is set). Throws on non-OK responses so route handlers
 * can convert failures to HTTP 502 without crashing.
 */
export async function defaultFetchJson(url: string): Promise<unknown> {
  return fetchJsonWithProxy(url, 'OKX request failed');
}

/**
 * Same timeout/error contract as `defaultFetchJson` but for Binance endpoints,
 * so a failed fapi call surfaces as a readable 502 instead of crashing.
 */
export async function defaultBinanceFetchJson(url: string): Promise<unknown> {
  return fetchJsonWithProxy(url, 'Binance request failed');
}

async function fetchJsonWithProxy(url: string, errorLabel: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetchWithDispatcher(url, {
      signal: controller.signal,
      ...(dispatcher ? { dispatcher } : {}),
    });
    if (!response.ok) {
      throw new Error(`${errorLabel}: ${response.status}`);
    }
    return response.json();
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
  } finally {
    clearTimeout(timeout);
  }
}
