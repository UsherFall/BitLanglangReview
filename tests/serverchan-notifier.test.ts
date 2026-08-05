import { describe, expect, it, vi } from 'vitest';
import { NoopNotifier, ServerChanNotifier } from '../src/server/notify';

function mockResponse(init: { ok: boolean; status: number; json: unknown }) {
  return {
    ok: init.ok,
    status: init.status,
    json: async () => init.json,
  } as Response;
}

describe('ServerChanNotifier', () => {
  it('posts the title and message to the Server酱 send URL', async () => {
    const fetchFn = vi.fn(async () => mockResponse({ ok: true, status: 200, json: { code: 0, message: '' } }));
    const notifier = new ServerChanNotifier('test-key', fetchFn);

    await notifier.send('价格警报: BTC 上破 120000', '币: BTC\n方向: 上破');

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, { method: string; headers: Record<string, string>; body: string }];
    expect(url).toBe('https://sctapi.ftqq.com/test-key.send');
    expect(init.method).toBe('POST');
    expect(init.body).toContain('title=%E4%BB%B7%E6%A0%BC%E8%AD%A6%E6%8A%A5%3A+BTC+%E4%B8%8A%E7%A0%B4+120000');
    expect(init.body).toContain('desp=');
  });

  it('throws when Server酱 returns a non-zero code', async () => {
    const fetchFn = vi.fn(async () => mockResponse({ ok: true, status: 200, json: { code: 40015, message: 'bad key' } }));
    const notifier = new ServerChanNotifier('bad-key', fetchFn);

    await expect(notifier.send('t', 'm')).rejects.toThrow(/bad key/);
  });

  it('throws when the request itself fails', async () => {
    const fetchFn = vi.fn(async () => mockResponse({ ok: false, status: 502, json: {} }));
    const notifier = new ServerChanNotifier('test-key', fetchFn);

    await expect(notifier.send('t', 'm')).rejects.toThrow(/502/);
  });
});

describe('NoopNotifier', () => {
  it('logs a warning instead of pushing', async () => {
    const logger = vi.fn();
    const notifier = new NoopNotifier(logger);

    await notifier.send('t', 'm');

    expect(logger).toHaveBeenCalledWith(expect.stringContaining('SERVERCHAN_KEY'));
  });
});
