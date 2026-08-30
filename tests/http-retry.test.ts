import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchJsonWithRetry } from '../src/server/http';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('fetchJsonWithRetry', () => {
  it('returns JSON on the first OK response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));
    await expect(fetchJsonWithRetry('https://x', fetchImpl)).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries a 429 and succeeds on the retry, honoring Retry-After', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 429, { 'retry-after': '2' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const promise = fetchJsonWithRetry('https://x', fetchImpl);
    await vi.advanceTimersByTimeAsync(100_000);

    await expect(promise).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('waits the full ban (Retry-After) after a 418, retries once, and succeeds', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 418, { 'retry-after': '60' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const promise = fetchJsonWithRetry('https://x', fetchImpl);
    await vi.advanceTimersByTimeAsync(100_000);

    await expect(promise).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('gives up after one recovery attempt against a persistent 418 ban (no hammering)', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => jsonResponse({}, 418, { 'retry-after': '60' }));

    const assertion = expect(fetchJsonWithRetry('https://x', fetchImpl)).rejects.toThrow(/HTTP 418/);
    await vi.advanceTimersByTimeAsync(100_000);
    await assertion;
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('gives up after maxAttempts of a persistent 429 and throws', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => jsonResponse({}, 429));

    // Attach the rejection handler BEFORE advancing timers, or the throw fires
    // as an unhandled rejection mid-advance.
    const assertion = expect(fetchJsonWithRetry('https://x', fetchImpl)).rejects.toThrow(/HTTP 429/);
    await vi.advanceTimersByTimeAsync(100_000);
    await assertion;
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('throws immediately on a non-retryable status (no retry)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 500));
    await expect(fetchJsonWithRetry('https://x', fetchImpl)).rejects.toThrow(/HTTP 500/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
