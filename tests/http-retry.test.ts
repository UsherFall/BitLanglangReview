import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRateGate, fetchJsonWithRetry } from '../src/server/http';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('fetchJsonWithRetry (no gate — OKX path, per-request behavior)', () => {
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
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('throws immediately on a non-retryable status (no retry)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 500));
    await expect(fetchJsonWithRetry('https://x', fetchImpl)).rejects.toThrow(/HTTP 500/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('fetchJsonWithRetry (with gate — Binance path, IP-level behavior)', () => {
  it('records a 429 warning on the gate, pauses the pipeline, and succeeds after the backoff', async () => {
    vi.useFakeTimers();
    const gate = createRateGate();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 429, { 'retry-after': '2' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const promise = fetchJsonWithRetry('https://x', fetchImpl, gate);
    await vi.advanceTimersByTimeAsync(100_000);

    await expect(promise).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(gate.takeWarnings()).toEqual([expect.stringContaining('币安限频(HTTP 429)')]);
  });

  it('fails fast on 418 and blocks every subsequent request until the ban lifts', async () => {
    vi.useFakeTimers();
    const gate = createRateGate();
    const fetchImpl = vi.fn(async () => jsonResponse({}, 418, { 'retry-after': '60' }));

    // First hit: 418 → the gate records the ban and the request fails fast (no retry).
    const assertion = expect(fetchJsonWithRetry('https://x', fetchImpl, gate)).rejects.toThrow(/HTTP 418/);
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(gate.reason()).toBe('418');

    // A second request during the ban also fails fast WITHOUT touching the network.
    await expect(fetchJsonWithRetry('https://y', fetchImpl, gate)).rejects.toThrow(/HTTP 418/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('waits out an active 429 gate before sending', async () => {
    vi.useFakeTimers();
    const gate = createRateGate();
    gate.block(Date.now() + 5_000, '429', '币安限频(HTTP 429)，已自动退避 5 秒');
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));

    const promise = fetchJsonWithRetry('https://x', fetchImpl, gate);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchImpl).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(promise).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
