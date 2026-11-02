import { describe, expect, it } from 'vitest';
import type { Candlestick } from '../src/domain/candlestick';
import { firstGapInRange, nextFreeReplayCursor, nextFreeReplayProgress, previousFreeReplayCursor, previousFreeReplayProgress, replayCandleGrid, replayRequestInstrument, shouldBackfillFreeReplayHistory, shouldPrefetchFutureCandles, visibleCandlesForFreeReplay } from '../src/ui/free-replay-chart';

describe('Free Replay Chart', () => {
  it('shows candlesticks through the free replay cursor and hides future candlesticks', () => {
    const candles = [
      makeCandle('2024-05-21T09:50:00+08:00'),
      makeCandle('2024-05-21T09:55:00+08:00'),
      makeCandle('2024-05-21T10:00:00+08:00'),
      makeCandle('2024-05-21T10:05:00+08:00'),
    ];

    expect(visibleCandlesForFreeReplay(candles, Date.parse('2024-05-21T10:00:00+08:00') / 1000).map((candle) => candle.timestamp)).toEqual([
      Date.parse('2024-05-21T09:50:00+08:00'),
      Date.parse('2024-05-21T09:55:00+08:00'),
      Date.parse('2024-05-21T10:00:00+08:00'),
    ]);
  });

  it('reveals the next loaded candlestick', () => {
    const candles = [
      makeCandle('2024-05-21T10:00:00+08:00'),
      makeCandle('2024-05-21T10:05:00+08:00'),
      makeCandle('2024-05-21T10:10:00+08:00'),
    ];

    expect(nextFreeReplayCursor(candles, Date.parse('2024-05-21T10:00:00+08:00') / 1000)).toBe(Date.parse('2024-05-21T10:05:00+08:00') / 1000);
  });

  it('rewinds to the previous loaded candlestick without moving before the start cursor', () => {
    const candles = [
      makeCandle('2024-05-21T10:00:00+08:00'),
      makeCandle('2024-05-21T10:05:00+08:00'),
      makeCandle('2024-05-21T10:10:00+08:00'),
    ];
    const startCursor = Date.parse('2024-05-21T10:00:00+08:00') / 1000;

    expect(previousFreeReplayCursor(candles, Date.parse('2024-05-21T10:10:00+08:00') / 1000, startCursor)).toBe(Date.parse('2024-05-21T10:05:00+08:00') / 1000);
    expect(previousFreeReplayCursor(candles, startCursor, startCursor)).toBe(startCursor);
  });

  it('advances progress to the revealed candle completion time', () => {
    const candles = [
      makeCandle('2024-05-21T04:00:00+08:00'),
      makeCandle('2024-05-21T08:00:00+08:00'),
    ];
    const currentCursor = Date.parse('2024-05-21T04:00:00+08:00') / 1000;
    const progress = Date.parse('2024-05-21T10:35:00+08:00') / 1000;

    expect(nextFreeReplayProgress(candles, currentCursor, progress, '4H')).toEqual({
      cursorTime: Date.parse('2024-05-21T08:00:00+08:00') / 1000,
      progressTime: Date.parse('2024-05-21T12:00:00+08:00') / 1000,
    });
  });

  it('rewinds progress to the current displayed candlestick start time', () => {
    expect(previousFreeReplayProgress(Date.parse('2024-05-21T08:00:00+08:00') / 1000)).toBe(Date.parse('2024-05-21T08:00:00+08:00') / 1000);
  });

  it('prefetches more future candlesticks before the hidden buffer is exhausted', () => {
    const candles = [
      makeCandle('2024-05-21T10:00:00+08:00'),
      makeCandle('2024-05-21T10:05:00+08:00'),
      makeCandle('2024-05-21T10:10:00+08:00'),
    ];

    expect(shouldPrefetchFutureCandles(candles, Date.parse('2024-05-21T10:05:00+08:00') / 1000, 1)).toBe(true);
    expect(shouldPrefetchFutureCandles(candles, Date.parse('2024-05-21T10:00:00+08:00') / 1000, 1)).toBe(false);
  });

  it('prefetches when the cursor falls between loaded candlestick timestamps', () => {
    const candles = [
      makeCandle('2024-05-21T10:00:00+08:00'),
      makeCandle('2024-05-21T10:05:00+08:00'),
      makeCandle('2024-05-21T10:10:00+08:00'),
    ];

    expect(shouldPrefetchFutureCandles(candles, Date.parse('2024-05-21T10:05:30+08:00') / 1000, 1)).toBe(true);
  });

  it('prefetches when the cursor is past every loaded candlestick', () => {
    const candles = [
      makeCandle('2024-05-21T10:00:00+08:00'),
      makeCandle('2024-05-21T10:05:00+08:00'),
    ];

    expect(shouldPrefetchFutureCandles(candles, Date.parse('2024-05-21T10:10:00+08:00') / 1000, 20)).toBe(true);
  });

  it('backfills history when preserved zoom needs more candles before the cursor', () => {
    const candles = [
      makeCandle('2024-05-21T09:50:00+08:00'),
      makeCandle('2024-05-21T09:55:00+08:00'),
      makeCandle('2024-05-21T10:00:00+08:00'),
      makeCandle('2024-05-21T10:05:00+08:00'),
    ];

    expect(shouldBackfillFreeReplayHistory(candles, Date.parse('2024-05-21T10:00:00+08:00') / 1000, 20, 10)).toBe(true);
    expect(shouldBackfillFreeReplayHistory(candles, Date.parse('2024-05-21T10:00:00+08:00') / 1000, 13, 10)).toBe(false);
  });
  it('maps the session grid by source VALUE, not by field presence (restored legacy sessions)', () => {
    // 11/02：恢复路径会把 legacy null 改写成 'binance-only' —— 若按「字段存在
    // 即 shanghai」映射，币安会话被锚到北京日界。必须按源值映射。
    expect(replayCandleGrid({ candleSource: 'binance-only' })).toBe('utc');
    expect(replayCandleGrid({})).toBe('utc'); // 未记录源 = 旧会话（Binance）
    expect(replayCandleGrid(null)).toBe('shanghai'); // 无会话 = 当前默认 Bitget
    expect(replayCandleGrid({ candleSource: 'bitget' })).toBe('shanghai');
    expect(replayCandleGrid({ candleSource: 'okx' })).toBe('shanghai');
  });

  it('translates the request instrument between venue vocabularies', () => {
    expect(replayRequestInstrument('BTCUSDT', 'okx')).toBe('BTC-USDT-SWAP');
    expect(replayRequestInstrument('BTC-USDT-SWAP', 'okx')).toBe('BTC-USDT-SWAP');
    expect(replayRequestInstrument('BTC-USDT-SWAP', 'bitget')).toBe('BTCUSDT');
    expect(replayRequestInstrument('BTC-USDT-SWAP', 'binance-only')).toBe('BTCUSDT');
    expect(replayRequestInstrument('BTCUSDT', 'bitget')).toBe('BTCUSDT');
    // 不认识的词汇保持原样 —— 目标所无此标的时返回空窗口（错误可见，不静默换所）。
    expect(replayRequestInstrument('XXX-BTC', 'okx')).toBe('XXX-BTC');
  });

  it('finds the first in-range gap in the loaded candles', () => {
    const candles = [
      makeCandle('2024-05-21T10:00:00+08:00'),
      makeCandle('2024-05-21T10:05:00+08:00'),
      // 洞：10:05 → 11:35（缺 18 根）
      makeCandle('2024-05-21T11:35:00+08:00'),
      makeCandle('2024-05-21T11:40:00+08:00'),
    ];

    const gap = firstGapInRange(candles, Date.parse('2024-05-21T10:00:00+08:00'), Date.parse('2024-05-21T12:00:00+08:00'), '5m');
    expect(gap).toEqual({
      from: Date.parse('2024-05-21T10:05:00+08:00'),
      to: Date.parse('2024-05-21T11:35:00+08:00'),
    });
    // 范围不覆盖洞 → null。
    expect(firstGapInRange(candles, Date.parse('2024-05-21T11:40:00+08:00'), Date.parse('2024-05-21T12:00:00+08:00'), '5m')).toBeNull();
    // 相邻正常间隔不是洞。
    expect(firstGapInRange(candles.slice(0, 2), Date.parse('2024-05-21T10:00:00+08:00'), Date.parse('2024-05-21T10:05:00+08:00'), '5m')).toBeNull();
    expect(firstGapInRange([], 0, 1e12, '5m')).toBeNull();
  });
});

function makeCandle(time: string): Candlestick {
  return {
    instrument: 'BTC-USDT-SWAP',
    timeframe: '5m',
    timestamp: Date.parse(time),
    open: 1,
    high: 2,
    low: 0.5,
    close: 1.5,
    volume: 10,
  };
}
