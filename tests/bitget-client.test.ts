import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BitgetApiError, BitgetClient, type BitgetFetchJson } from '../src/server/bitget-client';

const SECRET = 'test-secret';
const FIXED_SERVER_TIME = '1700000000000';
const BASE = 'https://api.bitget.com';

function payload(url: string, headers: Record<string, string>) {
  if (url.includes('/public/time')) {
    return Promise.resolve({ code: '00000', msg: 'success', data: { serverTime: FIXED_SERVER_TIME } });
  }
  if (url.includes('history-position')) {
    return Promise.resolve({
      code: '00000',
      msg: 'success',
      data: {
        list: [
          {
            symbol: 'XRPUSDT',
            marginCoin: 'USDT',
            holdSide: 'long',
            marginMode: 'isolated',
            openAvgPrice: '0.64967',
            closeAvgPrice: '0.58799',
            openTotalPos: '10',
            closeTotalPos: '10',
            pnl: '-0.62976205',
            netProfit: '-0.65356802',
            totalFunding: '-0.01638',
            openFee: '-0.00389802',
            closeFee: '-0.00352794',
            ctime: '1709590322199',
            utime: '1709667583395',
          },
        ],
      },
    });
  }
  return Promise.reject(new Error(`unexpected url ${url}`));
}

describe('Bitget Client', () => {
  it('signs GET requests with ACCESS headers and the sorted raw query string', async () => {
    const requests: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchJson: BitgetFetchJson = async (url, headers) => {
      requests.push({ url, headers });
      return payload(url, headers);
    };
    const client = new BitgetClient({ apiKey: 'key', secret: SECRET, passphrase: 'pass', fetchJson });

    const rows = await client.fetchHistoryPositionsPage({ startTime: 1700000000000, endTime: 1702592000000 });

    const signedRequest = requests.find((request) => request.url.includes('history-position'));
    expect(signedRequest).toBeDefined();
    const path = new URL(signedRequest!.url).pathname + new URL(signedRequest!.url).search;
    expect(path).toContain('productType=USDT-FUTURES');
    const timestamp = signedRequest!.headers['ACCESS-TIMESTAMP'];
    const expected = createHmac('sha256', SECRET).update(`${timestamp}GET${path}`).digest('base64');
    expect(signedRequest!.headers['ACCESS-KEY']).toBe('key');
    expect(signedRequest!.headers['ACCESS-PASSPHRASE']).toBe('pass');
    expect(signedRequest!.headers['ACCESS-SIGN']).toBe(expected);
    expect(signedRequest!.url.startsWith(`${BASE}/api/v2/mix/position/history-position?`)).toBe(true);

    expect(rows).toHaveLength(1);
    expect(rows[0].symbol).toBe('XRPUSDT');
    expect(rows[0].holdSide).toBe('long');
  });

  it('throws a readable business error when the exchange code is not 00000', async () => {
    const fetchJson: BitgetFetchJson = async (url) => {
      if (url.includes('/public/time')) return { code: '00000', data: { serverTime: FIXED_SERVER_TIME } };
      return { code: '40006', msg: 'Invalid ACCESS_KEY' };
    };
    const client = new BitgetClient({ apiKey: 'bad', secret: SECRET, passphrase: 'pass', fetchJson });
    await expect(client.fetchHistoryPositionsPage({ startTime: 1, endTime: 2 })).rejects.toBeInstanceOf(BitgetApiError);
    await expect(client.fetchHistoryPositionsPage({ startTime: 1, endTime: 2 })).rejects.toThrow(/Invalid ACCESS_KEY/);
  });

  it('skips rows whose holdSide is missing', async () => {
    const fetchJson: BitgetFetchJson = async (url) => {
      if (url.includes('/public/time')) return { code: '00000', data: { serverTime: FIXED_SERVER_TIME } };
      return { code: '00000', data: { list: [{ symbol: 'BTCUSDT', holdSide: 'weird', ctime: '1', utime: '2' }] } };
    };
    const client = new BitgetClient({ apiKey: 'key', secret: SECRET, passphrase: 'pass', fetchJson });
    const rows = await client.fetchHistoryPositionsPage({ startTime: 1, endTime: 2 });
    expect(rows).toHaveLength(0);
  });
});
