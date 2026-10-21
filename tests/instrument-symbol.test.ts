import { describe, expect, it } from 'vitest';
import { BINANCE_SYMBOL_ALIASES, canonicalInstrument, okxInstrumentToBitgetSymbol, resolveCandleChain, shortInstrument } from '../src/domain/instrument-symbol';

const TRADING = new Map([
  ['BTCUSDT', 'TRADING'],
  ['RAYUSDT', 'TRADING'],
  ['RAYSOLUSDT', 'TRADING'],
]);

describe('resolveCandleChain', () => {
  it('returns the plain Binance symbol followed by the OKX fallback', () => {
    expect(resolveCandleChain('BTC-USDT-SWAP', TRADING)).toEqual([
      { kind: 'binance', symbol: 'BTCUSDT', usable: true },
      { kind: 'okx', instrument: 'BTC-USDT-SWAP' },
    ]);
  });

  it('tries the alias before the plain Binance symbol', () => {
    const chain = resolveCandleChain('RAY-USDT-SWAP', TRADING);

    expect(chain[0]).toEqual({ kind: 'binance', symbol: 'RAYSOLUSDT', usable: true });
    expect(chain[1]).toEqual({ kind: 'binance', symbol: 'RAYUSDT', usable: true });
    expect(chain[2]).toEqual({ kind: 'okx', instrument: 'RAY-USDT-SWAP' });
  });

  it('marks a settled contract unusable and reports its status', () => {
    const chain = resolveCandleChain('RAY-USDT-SWAP', new Map([['RAYUSDT', 'SETTLING'], ['RAYSOLUSDT', 'TRADING']]));

    expect(chain[1]).toEqual({ kind: 'binance', symbol: 'RAYUSDT', usable: false, reason: '合约状态 SETTLING' });
  });

  it('marks a symbol Binance does not list as unusable', () => {
    const chain = resolveCandleChain('SHIB-USDT-SWAP', new Map([['BTCUSDT', 'TRADING']]));

    expect(chain[0]).toEqual({ kind: 'binance', symbol: 'SHIBUSDT', usable: false, reason: '无此合约' });
    expect(chain[1]).toEqual({ kind: 'okx', instrument: 'SHIB-USDT-SWAP' });
  });

  it('treats an empty status map as unknown metadata and attempts every Binance candidate', () => {
    const chain = resolveCandleChain('SHIB-USDT-SWAP', new Map());

    expect(chain[0]).toEqual({ kind: 'binance', symbol: 'SHIBUSDT', usable: true });
  });

  it('keeps the OKX fallback last even when every Binance candidate is unusable', () => {
    const chain = resolveCandleChain('RAY-USDT-SWAP', new Map([['RAYUSDT', 'SETTLING'], ['RAYSOLUSDT', 'CLOSE']]));

    expect(chain.filter((step) => step.kind === 'binance').every((step) => !step.usable)).toBe(true);
    expect(chain[chain.length - 1]).toEqual({ kind: 'okx', instrument: 'RAY-USDT-SWAP' });
  });

  it('passes a 1000x-prefixed base asset through unchanged', () => {
    const chain = resolveCandleChain('1000PEPE-USDT-SWAP', new Map([['1000PEPEUSDT', 'TRADING']]));

    expect(chain[0]).toEqual({ kind: 'binance', symbol: '1000PEPEUSDT', usable: true });
  });

  it('returns no chain for an instrument that is not a USDT-margined swap', () => {
    expect(resolveCandleChain('BTCUSDT', TRADING)).toEqual([]);
    expect(resolveCandleChain('BTC-USDC-SWAP', TRADING)).toEqual([]);
    expect(resolveCandleChain('BTC-USDT-SPOT', TRADING)).toEqual([]);
    expect(resolveCandleChain('', TRADING)).toEqual([]);
  });

  it('does not alias SHIB, whose Binance contract carries a 1000x face value', () => {
    // `1000SHIBUSDT` prices at 1000x the trade's entry/exit prices; that case is
    // served by the OKX fallback instead of a price-scaling layer.
    expect(BINANCE_SYMBOL_ALIASES.SHIB).toBeUndefined();
  });
});

describe('canonicalInstrument（匹配用，10/21）', () => {
  it('把三个交易所的写法归一到同一个名', () => {
    // 画线存在 OKX 名（交割单复盘），扫描池是 Bitget/Binance 名 —— 修复前
    // 按名字精确匹配，一根线都匹配不上，「距你标的线」永远是 `—`。
    expect(canonicalInstrument('BTC-USDT-SWAP')).toBe('BTCUSDT');
    expect(canonicalInstrument('BTC-USDT')).toBe('BTCUSDT');
    expect(canonicalInstrument('BTCUSDT')).toBe('BTCUSDT');
  });

  it('大小写不敏感', () => {
    expect(canonicalInstrument('btc-usdt-swap')).toBe('BTCUSDT');
    expect(canonicalInstrument('BtcUsdt')).toBe('BTCUSDT');
  });

  it('剥掉 Bitget 的后缀写法', () => {
    expect(canonicalInstrument('BTCUSDT_PERP')).toBe('BTCUSDT');
    expect(canonicalInstrument('BTCUSDT_SWAP')).toBe('BTCUSDT');
  });

  it('无法识别的形状原样返回（大写）', () => {
    expect(canonicalInstrument('ETHBTC')).toBe('ETHBTC');
    expect(canonicalInstrument('')).toBe('');
  });

  it('不改变面值前缀的币（1000PEPE 与 PEPE 不是同一个币）', () => {
    expect(canonicalInstrument('1000PEPE-USDT-SWAP')).toBe('1000PEPEUSDT');
    expect(canonicalInstrument('1000PEPEUSDT')).toBe('1000PEPEUSDT');
  });
});

describe('shortInstrument（展示用）', () => {
  it('去掉 OKX 后缀，其它原样', () => {
    expect(shortInstrument('BTC-USDT-SWAP')).toBe('BTC');
    expect(shortInstrument('BTCUSDT')).toBe('BTCUSDT');
  });
});

describe('okxInstrumentToBitgetSymbol（10/21：改名，不改尺度）', () => {
  it('把 OKX 名翻译成 Bitget 名', () => {
    // Bitget 与 OKX 是**同一面值**（实测 2026-10-21：OKX PEPE-USDT-SWAP =
    // 0.000004561，Bitget PEPEUSDT = 0.0000045647），所以这只是改名，不涉及
    // 任何价格缩放 —— 这正是「仓位价与 K 线同源」的含义。
    expect(okxInstrumentToBitgetSymbol('PEPE-USDT-SWAP')).toBe('PEPEUSDT');
    expect(okxInstrumentToBitgetSymbol('BTC-USDT-SWAP')).toBe('BTCUSDT');
    expect(okxInstrumentToBitgetSymbol('XAU-USDT-SWAP')).toBe('XAUUSDT');
  });

  it('非 USDT 永续返回 null（而不是问交易所要一个不存在的符号）', () => {
    expect(okxInstrumentToBitgetSymbol('BTC-USDC-SWAP')).toBeNull();
    expect(okxInstrumentToBitgetSymbol('BTC-USDT-SPOT')).toBeNull();
    expect(okxInstrumentToBitgetSymbol('BTCUSDT')).toBeNull();
    expect(okxInstrumentToBitgetSymbol('')).toBeNull();
  });
});
