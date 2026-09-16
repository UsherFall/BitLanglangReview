import { describe, expect, it } from 'vitest';
import {
  isCandleInSession,
  isMarketOpen,
  localMarketParts,
  marketSession,
  US_NYSE_EARLY_CLOSES,
  US_NYSE_HOLIDAYS,
} from '../src/domain/market-session';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// IANA offsets in March/November 2026 for America/New_York:
// EDT (UTC-4) from 2026-03-08, EST (UTC-5) from 2026-11-01.
// 2026-03-09 is a Monday, 2026-03-14 a Saturday, 2026-11-02 a Monday.

describe('market sessions', () => {
  it('opens and closes US equity on the 04:00-20:00 window (pre-market + regular + after-hours)', () => {
    expect(isMarketOpen('US_EQUITY', Date.UTC(2026, 2, 9, 8, 0))).toBe(true); // 04:00 EDT pre-market open
    expect(isMarketOpen('US_EQUITY', Date.UTC(2026, 2, 9, 7, 59))).toBe(false); // 03:59 EDT (overnight, still closed)
    expect(isMarketOpen('US_EQUITY', Date.UTC(2026, 2, 9, 13, 30))).toBe(true); // 09:30 EDT regular open
    expect(isMarketOpen('US_EQUITY', Date.UTC(2026, 2, 9, 20, 0))).toBe(true); // 16:00 EDT regular close, after-hours open
    expect(isMarketOpen('US_EQUITY', Date.UTC(2026, 2, 9, 23, 59))).toBe(true); // 19:59 EDT after-hours
    expect(isMarketOpen('US_EQUITY', Date.UTC(2026, 2, 10, 0, 0))).toBe(false); // 20:00 EDT (right-open)
  });

  it('follows the DST offset switch (04:00 local resolves at different UTC hours)', () => {
    // Before spring-forward: EST = UTC-5, so 04:00 = 09:00Z on a Friday.
    expect(isMarketOpen('US_EQUITY', Date.UTC(2026, 2, 6, 9, 0))).toBe(true);
    expect(isMarketOpen('US_EQUITY', Date.UTC(2026, 2, 6, 8, 59))).toBe(false);
    // After spring-forward: EDT = UTC-4, so 04:00 = 08:00Z on the following Monday.
    expect(isMarketOpen('US_EQUITY', Date.UTC(2026, 2, 9, 8, 0))).toBe(true);
    // The same 08:00Z instant is only 03:00 EST in November -> still overnight.
    expect(isMarketOpen('US_EQUITY', Date.UTC(2026, 9, 30, 8, 0))).toBe(true); // 04:00 EDT Fri
    expect(isMarketOpen('US_EQUITY', Date.UTC(2026, 10, 2, 8, 0))).toBe(false); // 03:00 EST Mon
    // After fall-back: EST again, 04:00 = 09:00Z.
    expect(isMarketOpen('US_EQUITY', Date.UTC(2026, 10, 2, 9, 0))).toBe(true);
  });

  it('treats the DST transition Sundays as closed weekends', () => {
    // 2026-03-08 (spring forward) and 2026-11-01 (fall back) are Sundays.
    expect(isMarketOpen('US_EQUITY', Date.UTC(2026, 2, 8, 13, 30))).toBe(false);
    expect(isMarketOpen('US_EQUITY', Date.UTC(2026, 10, 1, 14, 30))).toBe(false);
  });

  it('closes US equity on weekends and NYSE holidays', () => {
    expect(isMarketOpen('US_EQUITY', Date.UTC(2026, 2, 14, 13, 30))).toBe(false); // Saturday
    expect(isMarketOpen('US_EQUITY', Date.UTC(2026, 2, 15, 13, 30))).toBe(false); // Sunday
    expect(isMarketOpen('US_EQUITY', Date.UTC(2026, 11, 25, 14, 30))).toBe(false); // 2026-12-25 09:30 EST
    expect(isMarketOpen('US_EQUITY', Date.UTC(2026, 11, 25, 17, 0))).toBe(false); // noon on Christmas
  });

  it('uses the 13:00 early close on 2026-11-27', () => {
    expect(isMarketOpen('US_EQUITY', Date.UTC(2026, 10, 27, 14, 30))).toBe(true); // 09:30 EST
    expect(isMarketOpen('US_EQUITY', Date.UTC(2026, 10, 27, 17, 59))).toBe(true); // 12:59 EST
    expect(isMarketOpen('US_EQUITY', Date.UTC(2026, 10, 27, 18, 0))).toBe(false); // 13:00 EST
  });

  it('gates Hong Kong equities with a lunch break', () => {
    // 2026-03-10 is a Tuesday, HKT = UTC+8.
    expect(isMarketOpen('HK_EQUITY', Date.UTC(2026, 2, 10, 1, 30))).toBe(true); // 09:30
    expect(isMarketOpen('HK_EQUITY', Date.UTC(2026, 2, 10, 4, 0))).toBe(false); // 12:00 lunch starts
    expect(isMarketOpen('HK_EQUITY', Date.UTC(2026, 2, 10, 4, 59))).toBe(false); // 12:59 still lunch
    expect(isMarketOpen('HK_EQUITY', Date.UTC(2026, 2, 10, 5, 0))).toBe(true); // 13:00 resumes
    expect(isMarketOpen('HK_EQUITY', Date.UTC(2026, 2, 10, 7, 59))).toBe(true); // 15:59
    expect(isMarketOpen('HK_EQUITY', Date.UTC(2026, 2, 10, 8, 0))).toBe(false); // 16:00 close
    expect(isMarketOpen('HK_EQUITY', Date.UTC(2026, 2, 14, 1, 30))).toBe(false); // Saturday
  });

  it('gates Korean equities 09:00-15:30 without a lunch break', () => {
    // 2026-03-10 is a Tuesday, KST = UTC+9.
    expect(isMarketOpen('KR_EQUITY', Date.UTC(2026, 2, 10, 0, 0))).toBe(true); // 09:00
    expect(isMarketOpen('KR_EQUITY', Date.UTC(2026, 2, 9, 23, 59))).toBe(false); // 08:59 (previous UTC day)
    expect(isMarketOpen('KR_EQUITY', Date.UTC(2026, 2, 10, 6, 29))).toBe(true); // 15:29
    expect(isMarketOpen('KR_EQUITY', Date.UTC(2026, 2, 10, 6, 30))).toBe(false); // 15:30 close
  });

  it('gates A-share equities with a lunch break', () => {
    // 2026-03-10 is a Tuesday, CST = UTC+8.
    expect(isMarketOpen('CN_EQUITY', Date.UTC(2026, 2, 10, 1, 30))).toBe(true); // 09:30
    expect(isMarketOpen('CN_EQUITY', Date.UTC(2026, 2, 10, 3, 29))).toBe(true); // 11:29
    expect(isMarketOpen('CN_EQUITY', Date.UTC(2026, 2, 10, 3, 30))).toBe(false); // 11:30 lunch
    expect(isMarketOpen('CN_EQUITY', Date.UTC(2026, 2, 10, 5, 0))).toBe(true); // 13:00
    expect(isMarketOpen('CN_EQUITY', Date.UTC(2026, 2, 10, 6, 59))).toBe(true); // 14:59
    expect(isMarketOpen('CN_EQUITY', Date.UTC(2026, 2, 10, 7, 0))).toBe(false); // 15:00 close
  });

  it('never closes crypto, commodity, and pre-IPO classes', () => {
    const saturdayMs = Date.UTC(2026, 2, 14, 0, 0);
    expect(isMarketOpen('CRYPTO', saturdayMs)).toBe(true);
    expect(isMarketOpen('COMMODITY', saturdayMs)).toBe(true);
    expect(isMarketOpen('PRE_IPO', saturdayMs)).toBe(true);
  });

  it('exposes no session spec for ungated classes', () => {
    expect(marketSession('CRYPTO')).toBeNull();
    expect(marketSession('COMMODITY')).toBeNull();
    expect(marketSession('PRE_IPO')).toBeNull();
    expect(marketSession('US_EQUITY')?.timezone).toBe('America/New_York');
  });

  it('derives the local weekday across the UTC day boundary', () => {
    // Beijing Monday 2026-03-09 07:00 = UTC Sunday 2026-03-08 23:00: local
    // weekday must be Monday(1), not getUTCDay()'s Sunday(0).
    const parts = localMarketParts(Date.UTC(2026, 2, 8, 23, 0), 'Asia/Shanghai');
    expect(parts.date).toBe('2026-03-09');
    expect(parts.weekday).toBe(1);
    expect(parts.minuteOfDay).toBe(7 * 60);
  });

  it('asserts the NYSE holiday tables cover the current year', () => {
    const coveredYears = new Set<string>();
    for (const date of US_NYSE_HOLIDAYS) coveredYears.add(date.slice(0, 4));
    for (const date of Object.keys(US_NYSE_EARLY_CLOSES)) coveredYears.add(date.slice(0, 4));
    const currentYear = String(new Date().getUTCFullYear());
    // Fail loudly when the tables are not maintained into the current year.
    expect(coveredYears.has(currentYear)).toBe(true);
  });
});

describe('isCandleInSession (session-only candle series)', () => {
  const FIVE_MIN = 5 * MINUTE;

  it('keeps intraday US candles that overlap the 04:00-20:00 window', () => {
    const marketOpen = Date.UTC(2026, 8, 15, 8, 0); // Tue 2026-09-15 04:00 EDT
    expect(isCandleInSession('US_EQUITY', marketOpen, FIVE_MIN)).toBe(true);
    expect(isCandleInSession('US_EQUITY', marketOpen - FIVE_MIN, FIVE_MIN)).toBe(false); // 03:55
    expect(isCandleInSession('US_EQUITY', marketOpen + 16 * HOUR - FIVE_MIN, FIVE_MIN)).toBe(true); // 19:55
    expect(isCandleInSession('US_EQUITY', marketOpen + 16 * HOUR, FIVE_MIN)).toBe(false); // 20:00
  });

  it('keeps a candle that only partly overlaps the session (edge candles)', () => {
    // A 1H candle opening 03:30 ET spans into the 04:00 pre-market open.
    const open = Date.UTC(2026, 8, 15, 7, 30);
    expect(isCandleInSession('US_EQUITY', open, HOUR)).toBe(true);
    expect(isCandleInSession('US_EQUITY', open - HOUR, HOUR)).toBe(false); // 02:30-03:30, fully overnight
  });

  it('keeps the UTC-aligned 1D candles that contain a US session', () => {
    // Binance daily candles open at 20:00 ET, so an "open time inside the
    // window" test would drop EVERY daily candle — the span test does not.
    const bar = DAY;
    // 2026-09-15T00:00Z = Mon 20:00 ET -> Tue 20:00 ET: contains the Tuesday session.
    expect(isCandleInSession('US_EQUITY', Date.UTC(2026, 8, 15), bar)).toBe(true);
    // 2026-09-11T00:00Z = Thu 20:00 ET -> Fri 20:00 ET: contains the Friday session.
    expect(isCandleInSession('US_EQUITY', Date.UTC(2026, 8, 11), bar)).toBe(true);
    // 2026-09-12T00:00Z = Fri 20:00 ET -> Sat 20:00 ET: no session at all.
    expect(isCandleInSession('US_EQUITY', Date.UTC(2026, 8, 12), bar)).toBe(false);
    // 2026-09-07T00:00Z = Sun 20:00 ET -> Mon 20:00 ET, and that Monday is Labor
    // Day, so the candle holds no session and is dropped with the rest of the holiday.
    expect(isCandleInSession('US_EQUITY', Date.UTC(2026, 8, 7), bar)).toBe(false);
  });

  it('keeps Korean candles inside 09:00-15:30 KST and drops the rest', () => {
    const kstOpen = Date.UTC(2026, 8, 15, 0, 0); // Tue 09:00 KST
    expect(isCandleInSession('KR_EQUITY', kstOpen, HOUR)).toBe(true);
    expect(isCandleInSession('KR_EQUITY', kstOpen - HOUR, HOUR)).toBe(false); // 08:00-09:00 KST
    expect(isCandleInSession('KR_EQUITY', Date.UTC(2026, 8, 15, 6, 30), HOUR)).toBe(false); // 15:30 close
  });

  it('never drops candles for ungated classes', () => {
    const saturday = Date.UTC(2026, 8, 12, 12, 0);
    for (const marketClass of ['CRYPTO', 'COMMODITY', 'PRE_IPO'] as const) {
      expect(isCandleInSession(marketClass, saturday, FIVE_MIN)).toBe(true);
    }
  });
});
