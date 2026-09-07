import { describe, expect, it } from 'vitest';
import { bitgetSymbolToOkxInstrument, historyPositionRowKey, okxInstrumentToBitgetSymbol, type BitgetHistoryPosition } from '../src/domain/bitget-position';
import { historyPositionToTrade, makeBitgetTradeId } from '../src/server/bitget-import';

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

describe('okxInstrumentToBitgetSymbol', () => {
  it('maps an OKX-style chart instrument back to the Bitget symbol', () => {
    expect(okxInstrumentToBitgetSymbol('BTC-USDT-SWAP')).toBe('BTCUSDT');
    expect(okxInstrumentToBitgetSymbol('XRP-USDT-SWAP')).toBe('XRPUSDT');
    expect(okxInstrumentToBitgetSymbol('1000PEPE-USDT-SWAP')).toBe('1000PEPEUSDT');
  });

  it('is the inverse of bitgetSymbolToOkxInstrument', () => {
    for (const symbol of ['BTCUSDT', 'XRPUSDT', '1000PEPEUSDT']) {
      const instrument = bitgetSymbolToOkxInstrument(symbol);
      expect(instrument).not.toBeNull();
      expect(okxInstrumentToBitgetSymbol(instrument as string)).toBe(symbol);
    }
  });

  it('returns null for anything that is not a USDT-M SWAP instrument', () => {
    expect(okxInstrumentToBitgetSymbol('BTC-USDC-SWAP')).toBeNull();
    expect(okxInstrumentToBitgetSymbol('BTC-USDT-SPOT')).toBeNull();
    expect(okxInstrumentToBitgetSymbol('BTCUSDT')).toBeNull();
    expect(okxInstrumentToBitgetSymbol('')).toBeNull();
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
      // Bitget cannot supply these.
      leverage: null,
      margin: null,
      returnRate: null,
      turnover: null,
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
