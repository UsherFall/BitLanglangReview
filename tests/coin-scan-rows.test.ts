import { describe, expect, it } from 'vitest';
import type { ScanRow } from '../src/domain/coin-scan';
import { orderScanRows } from '../src/ui/coin-scan-rows';

function row(instrument: string): ScanRow {
  return {
    instrument,
    lastPrice: 1,
    change24h: 0,
    quoteVolume24h: 0,
    structures: {} as ScanRow['structures'],
    convergedTimeframes: [],
    qualifiedCount: 1,
    bestScore: 0.5,
    qualified: true,
  };
}

function names(rows: readonly ScanRow[]): string[] {
  return rows.map((item) => item.instrument);
}

describe('orderScanRows', () => {
  it('returns the server order untouched when nothing is demoted', () => {
    expect(names(orderScanRows([row('A'), row('B'), row('C')], []))).toEqual(['A', 'B', 'C']);
  });

  it('sinks demoted instruments while preserving the order inside each group', () => {
    expect(names(orderScanRows([row('A'), row('B'), row('C'), row('D')], ['B', 'D']))).toEqual(['A', 'C', 'B', 'D']);
  });

  it('ignores demoted names that are not in this scan', () => {
    expect(names(orderScanRows([row('A'), row('B')], ['ZZZ']))).toEqual(['A', 'B']);
  });

  it('keeps every row in order when all are demoted', () => {
    expect(names(orderScanRows([row('A'), row('B')], ['A', 'B']))).toEqual(['A', 'B']);
  });
});
