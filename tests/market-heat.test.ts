import { describe, expect, it } from 'vitest';
import { classifyTier, normalizeToBinance } from '../src/domain/market-heat';

describe('classifyTier', () => {
  it('classifies broad, strongly-up pools as hot', () => {
    expect(classifyTier(0.8, 3)).toBe('hot');
    // Exact thresholds count (>=).
    expect(classifyTier(0.6, 1)).toBe('hot');
  });

  it('classifies broad, strongly-down pools as cold', () => {
    expect(classifyTier(0.2, -3)).toBe('cold');
    expect(classifyTier(0.4, -1)).toBe('cold');
  });

  it('classifies one-sided readings as warm/cool even when the other side is flat', () => {
    expect(classifyTier(0.7, 0)).toBe('warm'); // broad up, flat median
    expect(classifyTier(0.5, 2)).toBe('warm'); // median up, split breadth
    expect(classifyTier(0.3, 0)).toBe('cool'); // broad down, flat median
    expect(classifyTier(0.5, -2)).toBe('cool'); // median down, split breadth
  });

  it('classifies split/flat markets as neutral', () => {
    expect(classifyTier(0.5, 0)).toBe('neutral');
    expect(classifyTier(0.55, 0.4)).toBe('neutral');
  });

  it('classifies breadth-majority pools whose magnitude stays below the median tier', () => {
    // 涨家占比 >= 60% but median < +1% → 偏热 (not 热市).
    expect(classifyTier(0.75, 0.8)).toBe('warm');
    // 跌家占比 >= 60% but median > -1% → 偏冷 (not 冷市).
    expect(classifyTier(0.25, -0.8)).toBe('cool');
  });
});

describe('normalizeToBinance', () => {
  it('maps OKX SWAP symbols onto the Binance USDT-M name', () => {
    expect(normalizeToBinance('BTC-USDT-SWAP')).toBe('BTCUSDT');
    expect(normalizeToBinance('XAU-USDT-SWAP')).toBe('XAUUSDT');
    expect(normalizeToBinance('1000PEPE-USDT-SWAP')).toBe('1000PEPEUSDT');
  });

  it('passes Binance/Bitget names through unchanged (case-insensitive, trimmed)', () => {
    expect(normalizeToBinance('BTCUSDT')).toBe('BTCUSDT');
    expect(normalizeToBinance(' btcusdt ')).toBe('BTCUSDT');
  });

  it('returns null for symbols with no Binance USDT-M interpretation', () => {
    expect(normalizeToBinance('DOGE-USD-SWAP')).toBeNull();
    expect(normalizeToBinance('FOO')).toBeNull();
    expect(normalizeToBinance('')).toBeNull();
  });
});
