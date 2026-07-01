import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import type { Direction, Trade } from '../domain/trade';

const sourceSheetName = '时间排列+去除金额错误单子';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx') as typeof import('xlsx');

type Row = Record<string, unknown>;

export function loadTradesFromWorkbook(workbookPath: string): Trade[] {
  const workbook = XLSX.readFile(workbookPath, { cellDates: false, WTF: true });
  const sheet = workbook.Sheets[sourceSheetName] ?? workbook.Sheets[workbook.SheetNames[1]];
  if (!sheet) {
    throw new Error('Source workbook does not contain sheet2 trades.');
  }

  const rows = XLSX.utils.sheet_to_json<Row>(sheet, { defval: null, range: 1 });
  return rows
    .map(toTrade)
    .filter((trade): trade is Trade => trade !== null)
    .sort((a, b) => a.entryTime.localeCompare(b.entryTime));
}

function toTrade(row: Row): Trade | null {
  const sequence = toNumber(row['序号']);
  const instrument = toString(row['交易对']);
  const direction = toDirection(row['方向']);
  const entryTime = toShanghaiIso(row['买入时间']);
  const exitTime = toShanghaiIso(row['卖出时间']);
  const entryPrice = toNumber(row['开仓均价']);
  const exitPrice = toNumber(row['平仓均价']);
  const profit = toNumber(row['收益 (USDT)']);

  if (!sequence || !instrument || !direction || !entryTime || !exitTime || entryPrice === null || exitPrice === null || profit === null) {
    return null;
  }

  const tradeBase = {
    sequence,
    instrument,
    direction,
    entryTime,
    exitTime,
    entryPrice,
    exitPrice,
    profit,
  };

  return {
    ...tradeBase,
    id: makeTradeId(tradeBase),
    leverage: toNumber(row['杠杆倍数']) ?? 0,
    margin: toNumber(row['保证金（最大时）']) ?? 0,
    returnRate: toNumber(row['收益率']) ?? 0,
    turnover: toNumber(row['交易额 (USD)']) ?? 0,
    size: toNumber(row['持仓量（最大时）']) ?? 0,
    maxPositionValue: toNumber(row['持仓价值（最大时）']) ?? 0,
    fee: toNumber(row['手续费 (USD)']) ?? 0,
    holdingMinutes: Math.round(toNumber(row['交易时间差（分钟）']) ?? minutesBetween(entryTime, exitTime)),
    amplitude: toNumber(row['收益率/倍数=实际振幅']),
    sourceNote: toString(row['备注']),
  };
}

function makeTradeId(input: Omit<Pick<Trade, 'sequence' | 'instrument' | 'direction' | 'entryTime' | 'exitTime' | 'entryPrice' | 'exitPrice' | 'profit'>, 'id'>): string {
  const value = [input.sequence, input.instrument, input.entryTime, input.exitTime, input.direction, input.entryPrice, input.exitPrice, input.profit].join('|');
  return createHash('sha256').update(value).digest('hex');
}

function toDirection(value: unknown): Direction | null {
  const text = toString(value);
  return text === '多' || text === '空' ? text : null;
}

function toString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toShanghaiIso(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatShanghai(value);
  }
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    const rounded = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, Math.round(parsed.S)));
    rounded.setUTCSeconds(0, 0);
    if (Math.round(parsed.S) >= 30) {
      rounded.setUTCMinutes(rounded.getUTCMinutes() + 1);
    }
    return `${rounded.getUTCFullYear()}-${pad(rounded.getUTCMonth() + 1)}-${pad(rounded.getUTCDate())}T${pad(rounded.getUTCHours())}:${pad(rounded.getUTCMinutes())}:00.000+08:00`;
  }
  if (typeof value === 'string' && value.trim()) {
    const match = value.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
    if (match) {
      const [, y, m, d, h, min, s = '0'] = match;
      return `${y}-${pad(Number(m))}-${pad(Number(d))}T${pad(Number(h))}:${pad(Number(min))}:${pad(Number(s))}.000+08:00`;
    }
  }
  return null;
}

function formatShanghai(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}.000+08:00`;
}

function minutesBetween(start: string, end: string): number {
  return Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 60000));
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
