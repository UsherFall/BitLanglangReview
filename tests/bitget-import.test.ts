import { describe, expect, it } from 'vitest';
import type { BitgetOrder } from '../src/domain/bitget-order';
import { bitgetSymbolToOkxInstrument, historyPositionRowKey, type BitgetHistoryPosition } from '../src/domain/bitget-position';
import { attachRoundOrders, historyPositionToTrade, makeBitgetTradeId, toClosedRound } from '../src/server/bitget-import';

function order(overrides: Partial<BitgetOrder> & { orderId: string; tradedAt: number }): BitgetOrder {
  return {
    symbol: 'XRPUSDT',
    posSide: 'long',
    side: 'open',
    qty: 1,
    price: 0.65,
    fee: -0.004,
    profit: 0,
    source: 'market',
    leverage: 10,
    placedAt: null,
    ...overrides,
  };
}

const sampleRow: BitgetHistoryPosition = {
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
};

describe('bitgetSymbolToOkxInstrument', () => {
  it('maps a Bitget USDT-M symbol to the OKX-style chart instrument', () => {
    expect(bitgetSymbolToOkxInstrument('BTCUSDT')).toBe('BTC-USDT-SWAP');
    expect(bitgetSymbolToOkxInstrument('XRPUSDT')).toBe('XRP-USDT-SWAP');
    expect(bitgetSymbolToOkxInstrument('1000PEPEUSDT')).toBe('1000PEPE-USDT-SWAP');
  });

  it('returns null for non-USDT-settled symbols', () => {
    expect(bitgetSymbolToOkxInstrument('BTCUSDC')).toBeNull();
    expect(bitgetSymbolToOkxInstrument('BTC-USD-SWAP')).toBeNull();
    expect(bitgetSymbolToOkxInstrument('')).toBeNull();
  });
});

describe('historyPositionRowKey', () => {
  it('is stable across calls for the same row', () => {
    expect(historyPositionRowKey(sampleRow)).toBe(historyPositionRowKey(sampleRow));
  });

  it('changes when a price or time changes', () => {
    expect(historyPositionRowKey(sampleRow)).not.toBe(historyPositionRowKey({ ...sampleRow, closeAvgPrice: '0.588' }));
  });
});

describe('makeBitgetTradeId', () => {
  it('is deterministic and namespaced for review persistence', () => {
    const id = makeBitgetTradeId(sampleRow);
    expect(id).toMatch(/^bg-[a-f0-9]{64}$/);
    expect(makeBitgetTradeId(sampleRow)).toBe(id);
    expect(makeBitgetTradeId({ ...sampleRow, netProfit: '-0.7' })).not.toBe(id);
  });
});

describe('historyPositionToTrade', () => {
  it('maps a long closed-position row into the review Trade shape', () => {
    const trade = historyPositionToTrade(sampleRow, 1);
    expect(trade).not.toBeNull();
    expect(trade).toMatchObject({
      id: makeBitgetTradeId(sampleRow),
      sequence: 1,
      instrument: 'XRP-USDT-SWAP',
      direction: '多',
      entryPrice: 0.64967,
      exitPrice: 0.58799,
      size: 10,
      profit: -0.65356802,
      fee: 0.00742596,
      sourceNote: 'bitget:history-position',
      // Bitget cannot supply margin/leverage; turnover is the computable
      // entry notional (entryPrice × size) shown in the personal module rows.
      leverage: null,
      margin: null,
      returnRate: null,
      turnover: 0.64967 * 10,
      maxPositionValue: null,
      amplitude: null,
    });
    // 1709667583395 - 1709590322199 = 77261196 ms ≈ 1288 minutes.
    expect(trade?.holdingMinutes).toBe(1288);
  });

  it('maps holdSide short to direction 空', () => {
    const trade = historyPositionToTrade({ ...sampleRow, holdSide: 'short', netProfit: '12.34' }, 2);
    expect(trade?.direction).toBe('空');
    expect(trade?.profit).toBe(12.34);
  });

  it('renders times as Shanghai ISO strings with +08:00', () => {
    const trade = historyPositionToTrade(sampleRow, 1);
    expect(trade?.entryTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000\+08:00$/);
    expect(trade?.exitTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000\+08:00$/);
    // Open happened before close.
    expect(trade && trade.entryTime < trade.exitTime).toBe(true);
  });

  it('returns null when core fields are missing or unparseable', () => {
    expect(historyPositionToTrade({ ...sampleRow, openAvgPrice: '' }, 1)).toBeNull();
    expect(historyPositionToTrade({ ...sampleRow, holdSide: 'flat' as BitgetHistoryPosition['holdSide'] }, 1)).toBeNull();
    expect(historyPositionToTrade({ ...sampleRow, symbol: 'BTCUSDC' }, 1)).toBeNull();
  });
});

describe('toClosedRound', () => {
  it('converts the exchange string fields into the numbers the matcher needs', () => {
    expect(toClosedRound(sampleRow)).toEqual({
      symbol: 'XRPUSDT',
      holdSide: 'long',
      ctime: 1709590322199,
      utime: 1709667583395,
      openTotalPos: 10,
      closeTotalPos: 10,
    });
  });
});

describe('attachRoundOrders', () => {
  const baseTrade = historyPositionToTrade(sampleRow, 1)!;

  it('attaches one point per order and takes leverage from the first open', () => {
    const trade = attachRoundOrders(baseTrade, [
      // Deliberately out of order: the mapper must sort by traded time.
      order({ orderId: 'o2', tradedAt: 1709590322299, qty: 4, price: 0.66, source: 'normal', leverage: 12 }),
      order({ orderId: 'o1', tradedAt: 1709590322199, qty: 6, price: 0.64967, leverage: 10 }),
      order({ orderId: 'o3', tradedAt: 1709667583395, side: 'close', qty: 10, price: 0.58799, source: 'loss_market', profit: -0.63 }),
    ]);

    expect(trade.leverage).toBe(10);
    expect(trade.points?.map((point) => [point.kind, point.timeMs])).toEqual([
      ['open', 1709590322199],
      ['open', 1709590322299],
      ['close', 1709667583395],
    ]);
    // Opens realize nothing yet; closes carry the order's own pnl.
    expect(trade.points?.[0].profit).toBeNull();
    expect(trade.points?.[2].profit).toBe(-0.63);
    // Fees become positive costs, matching the Trade.fee convention.
    expect(trade.points?.[0].fee).toBe(0.004);
    expect(trade.points?.[2].source).toBe('loss_market');
    expect(trade.points?.[0].time).toMatch(/\d{2}:\d{2}:\d{2}\.\d{3}\+08:00$/);
  });

  it('leaves the trade untouched when no orders matched', () => {
    expect(attachRoundOrders(baseTrade, [])).toBe(baseTrade);
    expect(baseTrade.points).toBeUndefined();
    expect(baseTrade.leverage).toBeNull();
  });
});
