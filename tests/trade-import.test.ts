import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { loadTradesFromWorkbook } from '../src/server/trade-import';

const workbookPath = path.resolve('1_2022.5~2024.6浪浪交易交割单数据3 (1).xlsx');

describe('Source Workbook trade import', () => {
  it('loads trades from sheet2 in entry-time order with stable trade IDs', () => {
    const trades = loadTradesFromWorkbook(workbookPath);

    expect(trades.length).toBeGreaterThan(4000);
    expect(trades[0]).toMatchObject({
      sequence: 1,
      instrument: 'BTC-USDT-SWAP',
      direction: '空',
      entryPrice: 29328.12,
      exitPrice: 29337.97,
      returnRate: -0.0068,
      profit: -6.3,
      holdingMinutes: 93,
    });
    expect(trades[0].entryTime).toBe('2022-05-24T16:31:00.000+08:00');
    expect(trades[0].exitTime).toBe('2022-05-24T18:04:00.000+08:00');
    expect(trades[0].id).toHaveLength(64);
    expect(trades[0].id).toBe(loadTradesFromWorkbook(workbookPath)[0].id);
    expect(trades[1].entryTime >= trades[0].entryTime).toBe(true);
  }, 120_000);
});
