export type FetchJson = (url: string) => Promise<unknown>;

/**
 * Shared JSON GET helper with a timeout. Throws on non-OK responses so route
 * handlers can convert failures to HTTP 502 without crashing.
 */
export async function defaultFetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  const response = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeout));
  if (!response.ok) {
    throw new Error(`OKX request failed: ${response.status}`);
  }
  return response.json();
}
