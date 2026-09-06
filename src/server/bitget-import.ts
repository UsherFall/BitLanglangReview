import { createHash } from 'node:crypto';
import { bitgetSymbolToOkxInstrument, historyPositionRowKey, type BitgetHistoryPosition } from '../domain/bitget-position';
import { epochMsToShanghaiIso } from '../domain/shanghai-time';
import type { Direction, Trade } from '../domain/trade';

/**
 * Converts one Bitget history-position row (a fully closed position cycle) into
 * the review `Trade` shape, mirroring how workbook rows become trades.
 *
 * Bitget reports prices/sizes/pnl as strings and settles fees as negative
 * numbers. Bitget cannot supply leverage, margin, peak position value, or a
 * leverage-inclusive return rate, so those stay null and the UI renders "—".
 */
export function historyPositionToTrade(row: BitgetHistoryPosition, sequence: number): Trade | null {
  const instrument = bitgetSymbolToOkxInstrument(row.symbol);
  const direction = toDirection(row.holdSide);
  const entryPrice = toNumber(row.openAvgPrice);
  const exitPrice = toNumber(row.closeAvgPrice);
  const size = toNumber(row.closeTotalPos);
  const netProfit = toNumber(row.netProfit);
  const ctime = toNumber(row.ctime);
  const utime = toNumber(row.utime);

  if (!instrument || !direction || entryPrice === null || exitPrice === null || size === null || netProfit === null || ctime === null || utime === null) {
    return null;
  }

  const entryTime = epochMsToShanghaiIso(ctime);
  const exitTime = epochMsToShanghaiIso(utime);

  return {
    id: makeBitgetTradeId(row),
    sequence,
    instrument,
    direction,
    leverage: null,
    margin: null,
    entryPrice,
    exitPrice,
    returnRate: null,
    profit: netProfit,
    turnover: null,
    size,
    maxPositionValue: null,
    fee: toPositiveFee(row.openFee, row.closeFee),
    entryTime,
    exitTime,
    holdingMinutes: Math.max(0, Math.round((utime - ctime) / 60000)),
    amplitude: null,
    sourceNote: 'bitget:history-position',
  };
}

/** `bg-` + sha256 of the stable content key, so reviews survive re-syncs. */
export function makeBitgetTradeId(row: BitgetHistoryPosition): string {
  return `bg-${createHash('sha256').update(historyPositionRowKey(row)).digest('hex')}`;
}

function toDirection(value: unknown): Direction | null {
  return value === 'long' ? '多' : value === 'short' ? '空' : null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toPositiveFee(openFee: unknown, closeFee: unknown): number {
  const open = toNumber(openFee) ?? 0;
  const close = toNumber(closeFee) ?? 0;
  // Bitget reports fees as negative numbers; the workbook-style display keeps
  // the fee positive.
  return Math.abs(open) + Math.abs(close);
}
