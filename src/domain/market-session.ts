/**
 * Market session gating (休市跳过): decides whether an instrument class is in
 * its underlying market's trading session, so the coin scan can (a) exclude
 * instruments whose market is closed and (b) judge an open instrument only on
 * the candles that were actually traded.
 *
 * Pure domain: no IO, no fetch. Timezone conversion uses `Intl.DateTimeFormat`
 * with IANA zone names so DST is handled by the platform, never hand-rolled.
 *
 * WHY A CALENDAR AT ALL (09/16): the scan reads Binance USDT-M candles, which
 * print 24/7 for every TradFi contract — a closed market keeps emitting flat
 * bars. "Is it closed?" therefore cannot be derived from the data (no gaps, no
 * zero volume: measured — Binance equity perps trade ~24/5 with real volume
 * overnight, and only weekends collapse to 1-2% of peak volume). The only
 * usable signal is a session table, which this module owns. The alternative
 * ("use a source that omits closed bars") was explored and rejected: Yahoo's
 * free chart API rate-limits after ~40 requests, and Binance Stocks' real
 * session K-lines exist only as a live WebSocket feed with no history.
 * See `.trellis/tasks/09-16-coin-scan-equity-source/research/session-pollution-measurements.md`.
 *
 * NOTE ON MAINTENANCE: the NYSE holiday/early-close tables below must be
 * extended each year. `tests/market-session.test.ts` asserts that the current
 * year is covered, so forgetting to add the next year fails loudly instead of
 * silently scanning closed markets.
 */

import type { MarketClass } from './market-class';

/** One market's trading-session definition (local time, minute granularity). */
export type MarketSessionSpec = {
  /** IANA timezone of the exchange (e.g. 'America/New_York'). */
  timezone: string;
  /** Weekly trading days: 0 = Sunday … 6 = Saturday. */
  tradingDays: readonly number[];
  /** One or more open windows of the day, left-closed right-open [start, end). */
  windows: readonly { startMinute: number; endMinute: number }[];
  /** All-day closed dates (local 'YYYY-MM-DD'). */
  holidays?: readonly string[];
  /** Early-close dates (local 'YYYY-MM-DD') -> closing minute of the day. */
  earlyCloses?: Readonly<Record<string, number>>;
};

/** Minute-of-day helpers (window boundaries). */
const MINUTE_0400 = 4 * 60;
const MINUTE_0900 = 9 * 60;
const MINUTE_0930 = 9 * 60 + 30;
const MINUTE_1130 = 11 * 60 + 30;
const MINUTE_1200 = 12 * 60;
const MINUTE_1300 = 13 * 60;
const MINUTE_1500 = 15 * 60;
const MINUTE_1530 = 15 * 60 + 30;
const MINUTE_1600 = 16 * 60;
const MINUTE_2000 = 20 * 60;

/** NYSE full-day holidays (2026 + 2027). Extend yearly — see file-top note. */
export const US_NYSE_HOLIDAYS: readonly string[] = [
  // 2026
  '2026-01-01', // New Year's Day
  '2026-01-19', // MLK Day
  '2026-02-16', // Presidents' Day
  '2026-04-03', // Good Friday
  '2026-05-25', // Memorial Day
  '2026-06-19', // Juneteenth
  '2026-07-03', // Independence Day (observed)
  '2026-09-07', // Labor Day
  '2026-11-26', // Thanksgiving
  '2026-12-25', // Christmas
  // 2027
  '2027-01-01', // New Year's Day
  '2027-01-18', // MLK Day
  '2027-02-15', // Presidents' Day
  '2027-03-26', // Good Friday
  '2027-05-31', // Memorial Day
  '2027-06-18', // Juneteenth (observed)
  '2027-07-05', // Independence Day (observed)
  '2027-09-06', // Labor Day
  '2027-11-25', // Thanksgiving
  '2027-12-24', // Christmas (observed)
];

/** NYSE early closes at 13:00 (2026 + 2027). Extend yearly — see file-top note. */
export const US_NYSE_EARLY_CLOSES: Readonly<Record<string, number>> = {
  '2026-11-27': MINUTE_1300, // Day after Thanksgiving
  '2026-12-24': MINUTE_1300, // Christmas Eve
  '2027-11-26': MINUTE_1300, // Day after Thanksgiving
};

/**
 * Market sessions for the gated classes. CRYPTO / COMMODITY / PRE_IPO have none.
 *
 * US equities: 04:00–20:00 ET — pre-market + regular + after-hours as one
 * continuous window (09/16 widening, user decision). Binance documents the
 * equity cycle as pre-market / regular / after-hours / OVERNIGHT
 * (`Perpetual Futures on Traditional Assets` FAQ); the scan deliberately covers
 * the first three and treats the thin overnight session (20:00–04:00 ET) as
 * closed, because that is the regime the volatility-shrink scan misreads as
 * 蓄力 (measured: overnight median 5m range is 1/3 of the regular session's).
 */
export const MARKET_SESSIONS: Readonly<Record<MarketClass, MarketSessionSpec>> = {
  US_EQUITY: {
    timezone: 'America/New_York',
    tradingDays: [1, 2, 3, 4, 5],
    windows: [{ startMinute: MINUTE_0400, endMinute: MINUTE_2000 }],
    holidays: US_NYSE_HOLIDAYS,
    earlyCloses: US_NYSE_EARLY_CLOSES,
  },
  HK_EQUITY: {
    timezone: 'Asia/Hong_Kong',
    tradingDays: [1, 2, 3, 4, 5],
    windows: [
      { startMinute: MINUTE_0930, endMinute: MINUTE_1200 },
      { startMinute: MINUTE_1300, endMinute: MINUTE_1600 },
    ],
  },
  KR_EQUITY: {
    timezone: 'Asia/Seoul',
    tradingDays: [1, 2, 3, 4, 5],
    windows: [{ startMinute: MINUTE_0900, endMinute: MINUTE_1530 }],
  },
  CN_EQUITY: {
    timezone: 'Asia/Shanghai',
    tradingDays: [1, 2, 3, 4, 5],
    windows: [
      { startMinute: MINUTE_0930, endMinute: MINUTE_1130 },
      { startMinute: MINUTE_1300, endMinute: MINUTE_1500 },
    ],
  },
  // Placeholders to keep the record exhaustive; `marketSession` returns null for
  // them, so they are never session-gated (they trade 24/7 on Binance).
  CRYPTO: { timezone: 'UTC', tradingDays: [0, 1, 2, 3, 4, 5, 6], windows: [{ startMinute: 0, endMinute: 1440 }] },
  COMMODITY: { timezone: 'UTC', tradingDays: [0, 1, 2, 3, 4, 5, 6], windows: [{ startMinute: 0, endMinute: 1440 }] },
  PRE_IPO: { timezone: 'UTC', tradingDays: [0, 1, 2, 3, 4, 5, 6], windows: [{ startMinute: 0, endMinute: 1440 }] },
};

/** Trading-session definition for a class, or null when it never closes. */
export function marketSession(marketClass: MarketClass): MarketSessionSpec | null {
  if (marketClass === 'US_EQUITY' || marketClass === 'HK_EQUITY' || marketClass === 'KR_EQUITY' || marketClass === 'CN_EQUITY') {
    return MARKET_SESSIONS[marketClass];
  }
  return null;
}

/** Local wall-clock parts for an instant in an IANA timezone. */
export type LocalMarketParts = {
  /** Local calendar date 'YYYY-MM-DD'. */
  date: string;
  /** Local weekday: 0 = Sunday … 6 = Saturday. */
  weekday: number;
  /** Minute of the local day, 0..1439. */
  minuteOfDay: number;
};

const localDateFormatterCache = new Map<string, Intl.DateTimeFormat>();

function localFormatter(timezone: string): Intl.DateTimeFormat {
  let formatter = localDateFormatterCache.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    localDateFormatterCache.set(timezone, formatter);
  }
  return formatter;
}

/**
 * Resolves an instant to local wall-clock parts in the given IANA timezone.
 * The weekday is derived from the LOCAL date (not from `getUTCDay()` on the raw
 * timestamp, which is wrong across the UTC day boundary): the local Y/M/D are
 * re-anchored to a UTC midnight and then read as a UTC weekday.
 */
export function localMarketParts(atMs: number, timezone: string): LocalMarketParts {
  let year = 0;
  let month = '';
  let day = '';
  let hour = '';
  let minute = '';
  for (const part of localFormatter(timezone).formatToParts(new Date(atMs))) {
    if (part.type === 'year') year = Number(part.value);
    else if (part.type === 'month') month = part.value;
    else if (part.type === 'day') day = part.value;
    else if (part.type === 'hour') hour = part.value;
    else if (part.type === 'minute') minute = part.value;
  }
  const date = `${year}-${month}-${day}`;
  const weekday = new Date(Date.UTC(year, Number(month) - 1, Number(day))).getUTCDay();
  return { date, weekday, minuteOfDay: Number(hour) * 60 + Number(minute) };
}

/** True when the instrument's market is in session at `atMs` (always true for ungated classes). */
export function isMarketOpen(marketClass: MarketClass, atMs: number): boolean {
  const spec = marketSession(marketClass);
  if (!spec) return true;
  const { date, weekday, minuteOfDay } = localMarketParts(atMs, spec.timezone);
  if (!spec.tradingDays.includes(weekday)) return false;
  if (spec.holidays?.includes(date)) return false;
  const endCap = spec.earlyCloses?.[date];
  for (const window of spec.windows) {
    if (minuteOfDay < window.startMinute) return false; // windows are sorted; no later window opens earlier
    const end = endCap !== undefined ? Math.min(window.endMinute, endCap) : window.endMinute;
    if (minuteOfDay >= window.startMinute && minuteOfDay < end) return true;
  }
  return false;
}

/**
 * Granularity of the session probe inside one candle. 15 minutes is far finer
 * than any session edge this project cares about (sessions start/end on whole
 * minutes, and the shortest scanned timeframe is 5m), so the probe stays exact
 * where it matters and cheap where it would not: a 5m candle costs 1 lookup, a
 * 1H candle 4, a 1D candle 96.
 */
const SESSION_PROBE_STEP_MS = 15 * 60 * 1000;

/**
 * True when ANY part of the candle's span `[openMs, openMs + barMs)` falls inside
 * the instrument's trading session — i.e. whether the candle contains real
 * trading time.
 *
 * This is what keeps the scan's candle window honest for a 24/7 synthetic
 * contract: closed-market stretches (weekends, holidays, overnight) are dropped
 * from the series, so a "quiet band" can only mean a genuinely quiet market.
 * The same rule works for every timeframe — a UTC-aligned 1D candle opens at
 * 20:00 ET, so a naive "open time inside the window" test would drop every daily
 * candle; a span test instead keeps exactly the days that contain a session.
 *
 * Ungated classes (crypto, commodity, pre-IPO) always return true: they trade
 * around the clock, so no candle is ever dropped.
 */
export function isCandleInSession(marketClass: MarketClass, openMs: number, barMs: number): boolean {
  const spec = marketSession(marketClass);
  if (!spec) return true;
  const end = openMs + barMs;
  const step = Math.min(barMs, SESSION_PROBE_STEP_MS);
  for (let at = openMs; at < end; at += step) {
    if (isMarketOpen(marketClass, at)) return true;
  }
  return false;
}
