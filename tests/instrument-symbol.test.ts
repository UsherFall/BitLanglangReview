import { describe, expect, it } from 'vitest';
import { BINANCE_SYMBOL_ALIASES, resolveCandleChain } from '../src/domain/instrument-symbol';

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
