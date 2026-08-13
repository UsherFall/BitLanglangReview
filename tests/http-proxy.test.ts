import { describe, expect, it } from 'vitest';
import { resolveProxyUrl } from '../src/server/http';

describe('resolveProxyUrl', () => {
  it('defaults to the local 7897 mixed proxy when no proxy env is set', () => {
    expect(resolveProxyUrl({})).toBe('http://127.0.0.1:7897');
  });

  it('prefers the standard HTTPS_PROXY / http_proxy env vars', () => {
    expect(resolveProxyUrl({ HTTPS_PROXY: 'http://127.0.0.1:7890', HTTP_PROXY: 'http://127.0.0.1:8888' })).toBe(
      'http://127.0.0.1:7890',
    );
    expect(resolveProxyUrl({ http_proxy: 'http://127.0.0.1:10809' })).toBe('http://127.0.0.1:10809');
  });

  it('treats an empty HTTPS_PROXY as a forced direct connection', () => {
    expect(resolveProxyUrl({ HTTPS_PROXY: '' })).toBeUndefined();
  });
});
