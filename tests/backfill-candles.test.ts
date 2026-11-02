import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Candlestick } from '../src/domain/candlestick';
import { CandlestickStore } from '../src/server/candlestick-store';
import { backfillCandles, fetchBinanceRange, fetchBitgetRange, fetchOkxRange, scanGaps } from '../tools/backfill-candles';

describe('backfill-candles', () => {
  it('scans gaps between adjacent candles at 1.5x the step', () => {
    const step = 5 * 60_000;
    const ts = (minutes: number) => Date.parse('2024-05-21T10:00:00+08:00') + minutes * step;

    // 正常相邻 → 无洞。
    expect(scanGaps([ts(0), ts(1), ts(2)], '5m')).toEqual([]);
    // 中间缺一段 → 一个洞。
    expect(scanGaps([ts(0), ts(1), ts(5), ts(6)], '5m')).toEqual([{ from: ts(1), to: ts(5) }]);
    // 1M 名义步长 30 天，相邻月份不会误报。
    const jan = Date.UTC(2024, 0, 1);
    const feb = Date.UTC(2024, 1, 1);
    expect(scanGaps([jan, feb], '1M')).toEqual([]);
  });

  it('fetches a Binance range page by page, filtering closed bars and hole bounds', async () => {
    const from = Date.parse('2024-05-21T10:00:00Z');
    const to = Date.parse('2024-05-21T12:00:00Z');
    const page = (startMinute: number) => Array.from({ length: 10 }, (_, i) => String(from + (startMinute + i) * 60_000));

    const urls: string[] = [];
    const candles = await fetchBinanceRange(async (url) => {
      urls.push(url);
      const start = Number(new URL(url).searchParams.get('startTime'));
      const startMinute = Math.ceil((start - from) / 60_000); // startTime 含当根，cursor=last+1ms → 下一整分
      return page(startMinute).map((t) => [t, '1', '2', '0.5', '1.5', '10', String(Number(t) + 59_999)]);
    }, 'BTCUSDT', 'BTCUSDT', '1m', from, to);

    expect(urls.length).toBeGreaterThanOrEqual(2); // 分页拉满整段
    expect(candles).toHaveLength(119); // 洞两侧开区间 (from, to)：不含两端，分钟 1..119
    expect(candles[0]).toMatchObject({ instrument: 'BTCUSDT', timeframe: '1m', timestamp: from + 60_000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 });
  });

  it('pages OKX history backwards with after until it covers the gap', async () => {
    const from = Date.parse('2024-05-21T10:00:00Z');
    const to = Date.parse('2024-05-21T11:00:00Z');
    let calls = 0;
    const candles = await fetchOkxRange(async (url) => {
      calls += 1;
      const after = Number(new URL(url).searchParams.get('after'));
      const first = after - 10 * 60_000;
      // OKX 返回新→旧：rows[rows.length - 1] 是最旧一根。
      return { data: Array.from({ length: 10 }, (_, i) => [String(first + (9 - i) * 60_000), '1', '2', '0.5', '1.5', '10', '0', '0', '1']) };
    }, 'BTC-USDT-SWAP', 'BTC-USDT-SWAP', '1m', from, to);

    expect(calls).toBeGreaterThanOrEqual(1);
    expect(candles).toHaveLength(59); // (from, to) 开区间：分钟 1..59
    expect(candles.every((candle) => candle.timestamp > from && candle.timestamp < to)).toBe(true);
  });

  it('pages Bitget history backwards with endTime semantics', async () => {
    const from = Date.parse('2024-05-21T10:00:00Z');
    const to = Date.parse('2024-05-21T11:00:00Z');
    let calls = 0;
    const candles = await fetchBitgetRange(async (url) => {
      calls += 1;
      const endTime = Number(new URL(url).searchParams.get('endTime'));
      // Bitget 实测返回旧→新（升序）：一页 5 根、收盘时刻 ≤ endTime。
      return { code: '00000', data: Array.from({ length: 5 }, (_, i) => [String(endTime - (5 - i) * 60_000), '1', '2', '0.5', '1.5', '10', '0']) };
    }, 'bitget:BTCUSDT', 'BTCUSDT', '1m', from, to);

    expect(calls).toBeGreaterThanOrEqual(1);
    expect(candles.length).toBeGreaterThan(0);
    // 存储键带前缀（不污染裸键命名空间），交易所请求用原生符号。
    expect(candles.every((candle) => candle.instrument === 'bitget:BTCUSDT')).toBe(true);
    expect(candles.every((candle) => candle.timestamp > from && candle.timestamp < to)).toBe(true);
  });

  it('backfills a real sqlite cache end to end and the gap disappears', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'backfill-test-'));
    const dbPath = join(dir, 'review.sqlite');
    try {
      const store = new CandlestickStore(dbPath);
      const before = Date.parse('2024-05-21T10:00:00Z');
      const after = Date.parse('2024-05-21T11:00:00Z');
      store.save([
        makeCandle(before - 60_000), makeCandle(before),
        makeCandle(after), makeCandle(after + 60_000),
      ]);
      store.close();

      // 交易所“有”洞里的数据：以洞内任一时间点为中心返回 ±10 根 1m。
      const result = await backfillCandles({
        dbPath,
        fetchPage: async (url) => {
          const parsed = new URL(url);
          if (parsed.hostname.includes('binance')) {
            const startTime = Number(parsed.searchParams.get('startTime'));
            return Array.from({ length: 120 }, (_, i) => {
              const t = before + 60_000 + i * 60_000;
              return [String(t), '1', '2', '0.5', '1.5', '10', String(t + 59_999)];
            }).filter((row) => Number(row[0]) >= startTime && Number(row[0]) <= Number(parsed.searchParams.get('endTime')));
          }
          return {};
        },
        log: () => {},
      });

      expect(result.gaps).toBe(1);
      expect(result.filled).toBe(1);
      expect(result.skipped).toBe(0);

      const verify = new CandlestickStore(dbPath);
      const all = verify.listAfter({ instrument: 'BTCUSDT', timeframe: '1m', after: 0, limit: 10000 });
      verify.close();
      expect(scanGaps(all.map((candle) => candle.timestamp), '1m')).toEqual([]);
      expect(all.length).toBe(63); // 原 4 根 + 补 59 根（洞内开区间，交易所只回这一段）
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes namespaced backfill rows under the namespace key, never the bare one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'backfill-ns-'));
    const dbPath = join(dir, 'review.sqlite');
    try {
      const store = new CandlestickStore(dbPath);
      const before = Date.parse('2024-05-21T10:00:00Z');
      const after = Date.parse('2024-05-21T11:00:00Z');
      store.save([
        { ...makeCandle(before - 60_000), instrument: 'bitget:BTCUSDT' },
        { ...makeCandle(before), instrument: 'bitget:BTCUSDT' },
        { ...makeCandle(after), instrument: 'bitget:BTCUSDT' },
        { ...makeCandle(after + 60_000), instrument: 'bitget:BTCUSDT' },
      ]);
      store.close();

      const result = await backfillCandles({
        dbPath,
        fetchPage: async () => ({
          code: '00000',
          data: Array.from({ length: 59 }, (_, i) => {
            const t = before + 60_000 + i * 60_000;
            return [String(t), '1', '2', '0.5', '1.5', '10', '0'];
          }),
        }),
        log: () => {},
      });

      expect(result.gaps).toBe(1);
      expect(result.filled).toBe(1);
      const verify = new CandlestickStore(dbPath);
      const namespaced = verify.listAfter({ instrument: 'bitget:BTCUSDT', timeframe: '1m', after: 0, limit: 1000 });
      const bare = verify.listAfter({ instrument: 'BTCUSDT', timeframe: '1m', after: 0, limit: 1000 });
      verify.close();
      expect(namespaced).toHaveLength(63); // 原 4 根 + 补 59 根
      expect(bare).toHaveLength(0); // 裸键（Binance 命名空间）一个都没写进去
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports a gap as skipped when the exchange has no data for it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'backfill-empty-'));
    const dbPath = join(dir, 'review.sqlite');
    try {
      const store = new CandlestickStore(dbPath);
      store.save([makeCandle(Date.parse('2024-05-21T10:00:00Z')), makeCandle(Date.parse('2024-05-21T11:00:00Z'))]);
      store.close();

      const result = await backfillCandles({ dbPath, fetchPage: async () => [], log: () => {} });
      expect(result.gaps).toBe(1);
      expect(result.filled).toBe(0);
      expect(result.skipped).toBe(1);

      // 没写进任何新蜡烛。
      const verify = new CandlestickStore(dbPath);
      expect(verify.listAfter({ instrument: 'BTCUSDT', timeframe: '1m', after: 0, limit: 100 })).toHaveLength(2);
      verify.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    // vitest 临时目录由用例自清理；占位以保持结构清晰。
  });
});

function makeCandle(timestamp: number): Candlestick {
  return { instrument: 'BTCUSDT', timeframe: '1m', timestamp, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 };
}
