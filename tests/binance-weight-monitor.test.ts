import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRateGate, createWeightMonitor, defaultFetchJson, fetchJsonWithRetry, type WeightMonitor } from '../src/server/http';

// `defaultFetchJson` (the OKX path) reaches the network through undici's fetch,
// so the non-Binance case below mocks the module instead of injecting an impl.
const undiciMocks = vi.hoisted(() => ({ fetch: vi.fn() }));

vi.mock('undici', () => ({ fetch: undiciMocks.fetch, ProxyAgent: class {} }));

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function capturingSink(): { messages: string[]; sink: (message: string) => void } {
  const messages: string[] = [];
  return { messages, sink: (message) => messages.push(message) };
}

function highWaterValues(messages: string[]): (string | undefined)[] {
  return messages.map((message) => message.match(/high-water=(\d+)/)?.[1]);
}

function capturingMonitor(): {
  observed: (number | null)[];
  limits: Array<[number, number | null, number | null]>;
  monitor: WeightMonitor;
} {
  const observed: (number | null)[] = [];
  const limits: Array<[number, number | null, number | null]> = [];
  return {
    observed,
    limits,
    monitor: {
      observe: (usedWeight) => observed.push(usedWeight),
      recordLimit: (status, usedWeight, retryAfterSeconds) => limits.push([status, usedWeight, retryAfterSeconds]),
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('createWeightMonitor — high-water line', () => {
  it('prints one line per crossed step and carries the self ceiling plus the 2400 limit', () => {
    const { messages, sink } = capturingSink();
    const monitor = createWeightMonitor(sink, 200);

    monitor.observe(150); // below the first boundary: nothing yet
    monitor.observe(210); // crosses 200 → exactly one line
    monitor.observe(220); // same step → no repeat
    monitor.observe(120); // the high-water mark never goes back down

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('[binance] used-weight-1m high-water=210');
    expect(messages[0]).toContain('本进程权重上限 ≈≤1090/min');
    expect(messages[0]).toContain('限额 2400/min');
  });

  it('advances one step at a time and never logs a lower observation', () => {
    const { messages, sink } = capturingSink();
    const monitor = createWeightMonitor(sink, 200);

    monitor.observe(210);
    monitor.observe(399);
    monitor.observe(400);
    monitor.observe(150);

    expect(highWaterValues(messages)).toEqual(['210', '400']);
  });

  it('is a no-op when the response carries no weight header', () => {
    const { messages, sink } = capturingSink();
    const monitor = createWeightMonitor(sink, 200);

    expect(() => monitor.observe(null)).not.toThrow();
    expect(messages).toEqual([]);
  });

  it('defaults the step to 200', () => {
    const { messages, sink } = capturingSink();
    const monitor = createWeightMonitor(sink);

    monitor.observe(199);
    monitor.observe(200);

    expect(highWaterValues(messages)).toEqual(['200']);
  });

  it('honors BINANCE_WEIGHT_LOG_STEP', () => {
    vi.stubEnv('BINANCE_WEIGHT_LOG_STEP', '500');
    const { messages, sink } = capturingSink();
    const monitor = createWeightMonitor(sink);

    monitor.observe(400);
    monitor.observe(520);

    expect(highWaterValues(messages)).toEqual(['520']);
  });

  it('falls back to the default step for a non-finite or negative env value', () => {
    for (const value of ['abc', '-5']) {
      vi.stubEnv('BINANCE_WEIGHT_LOG_STEP', value);
      const { messages, sink } = capturingSink();
      const monitor = createWeightMonitor(sink);

      monitor.observe(199);
      monitor.observe(200);

      expect(highWaterValues(messages), 'env=' + JSON.stringify(value)).toEqual(['200']);
    }
  });

  it('reads an empty env value as 0, which silences the high-water line', () => {
    // Number('') === 0 and 0 is a meaningful step here (OFF), so an empty value
    // disables the high-water line rather than falling back to 200.
    vi.stubEnv('BINANCE_WEIGHT_LOG_STEP', '');
    const { messages, sink } = capturingSink();
    const monitor = createWeightMonitor(sink);

    monitor.observe(2400);

    expect(messages).toEqual([]);
  });

  it('silences the high-water line when the step is 0', () => {
    const { messages, sink } = capturingSink();
    const monitor = createWeightMonitor(sink, 0);

    monitor.observe(900);
    monitor.observe(2400);

    expect(messages).toEqual([]);
  });

  it('writes through console.warn by default', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const monitor = createWeightMonitor(undefined, 200);

    monitor.observe(250);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('high-water=250');
  });
});

describe('createWeightMonitor — limit events', () => {
  it('always logs the status, weight and Retry-After, step or no step', () => {
    const { messages, sink } = capturingSink();
    const monitor = createWeightMonitor(sink, 0);

    monitor.observe(900); // step 0 → silent
    monitor.recordLimit(429, 900, 12);
    monitor.recordLimit(418, 2380, 1659);

    expect(messages).toEqual([
      '[binance] HTTP 429 used-weight-1m=900 retry-after=12s',
      '[binance] HTTP 418 used-weight-1m=2380 retry-after=1659s',
    ]);
  });

  it('keeps the column layout when the header or Retry-After is missing', () => {
    const { messages, sink } = capturingSink();
    const monitor = createWeightMonitor(sink, 200);

    monitor.recordLimit(418, null, null);

    expect(messages).toEqual(['[binance] HTTP 418 used-weight-1m=unknown retry-after=unknown']);
  });

  it('logs a limit event even when the high-water line was already printed for that weight', () => {
    const { messages, sink } = capturingSink();
    const monitor = createWeightMonitor(sink, 200);

    monitor.observe(2400);
    monitor.observe(2400);
    monitor.recordLimit(418, 2400, 60);

    expect(messages).toHaveLength(2);
    expect(messages[1]).toBe('[binance] HTTP 418 used-weight-1m=2400 retry-after=60s');
  });
});

describe('fetchJsonWithRetry → weight monitor', () => {
  it('observes OK responses and records no limit event', async () => {
    const { observed, limits, monitor } = capturingMonitor();
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }, 200, { 'x-mbx-used-weight-1m': '42' }));

    await expect(fetchJsonWithRetry('https://x', fetchImpl, undefined, monitor)).resolves.toEqual({ ok: true });

    expect(observed).toEqual([42]);
    expect(limits).toEqual([]);
  });

  it('observes a header-less (OKX) response as null without logging or throwing', async () => {
    const { observed, limits, monitor } = capturingMonitor();
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));

    await expect(fetchJsonWithRetry('https://x', fetchImpl, undefined, monitor)).resolves.toEqual({ ok: true });

    expect(observed).toEqual([null]);
    expect(limits).toEqual([]);
  });

  it('treats an unparsable weight header as null', async () => {
    const { observed, monitor } = capturingMonitor();
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }, 200, { 'x-mbx-used-weight-1m': 'n/a' }));

    await expect(fetchJsonWithRetry('https://x', fetchImpl, undefined, monitor)).resolves.toEqual({ ok: true });

    expect(observed).toEqual([null]);
  });

  it('reports the weight and Retry-After of the 418 response that tripped the ban', async () => {
    vi.useFakeTimers();
    const { observed, limits, monitor } = capturingMonitor();
    const gate = createRateGate();
    const fetchImpl = vi.fn(async () => jsonResponse({}, 418, { 'x-mbx-used-weight-1m': '2380', 'retry-after': '1659' }));

    const assertion = expect(fetchJsonWithRetry('https://x', fetchImpl, gate, monitor)).rejects.toThrow(/HTTP 418/);
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;

    expect(observed).toEqual([2380]);
    expect(limits).toEqual([[418, 2380, 1659]]);
  });

  it('reports the weight of the 429 response that triggered the backoff', async () => {
    vi.useFakeTimers();
    const { observed, limits, monitor } = capturingMonitor();
    const gate = createRateGate();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 429, { 'x-mbx-used-weight-1m': '2412', 'retry-after': '2' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }, 200, { 'x-mbx-used-weight-1m': '100' }));

    const promise = fetchJsonWithRetry('https://x', fetchImpl, gate, monitor);
    await vi.advanceTimersByTimeAsync(100_000);
    await expect(promise).resolves.toEqual({ ok: true });

    expect(observed).toEqual([2412, 100]);
    expect(limits).toEqual([[429, 2412, 2]]);
  });
});

describe('defaultFetchJson (OKX path)', () => {
  it('stays silent on an OKX rate limit, so no line is attributed to Binance', async () => {
    vi.useFakeTimers();
    undiciMocks.fetch.mockResolvedValue(jsonResponse({}, 429, { 'retry-after': '1' }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const assertion = expect(defaultFetchJson('https://www.okx.com/api/v5/market/candles')).rejects.toThrow(/OKX request failed/);
    await vi.advanceTimersByTimeAsync(100_000);
    await assertion;

    expect(undiciMocks.fetch).toHaveBeenCalledTimes(3);
    expect(warn).not.toHaveBeenCalled();
  });
});
