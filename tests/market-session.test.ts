import { describe, expect, it } from 'vitest';
import {
  isMarketOpen,
  localMarketParts,
  marketSession,
  US_NYSE_EARLY_CLOSES,
  US_NYSE_HOLIDAYS,
} from '../src/domain/market-session';

const HOUR = 60 * 60 * 1000;
// IANA offsets in March/November 2026 for America/New_York:
// EDT (UTC-4) from 2026-03-08, EST (UTC-5) from 2026-11-01.
// 2026-03-09 is a Monday, 2026-03-14 a Saturday, 2026-11-02 a Monday.

describe('market sessions', () => {
  it('opens and closes US equity on the 09:30-16:00 window (EDT Monday)', () => {
    expect(isMarketOpen('US_EQUITY', Date.UTC(2026, 2, 9, 13, 30))).toBe(true); // 09:30 EDT
    expect(isMarketOpen('US_EQUITY', Date.UTC(2026, 2, 9, 19, 59))).toBe(true); // 15:59 EDT
    expect(isMarketOpen('US_EQUITY', Date.UTC(2026, 2, 9, 20, 0))).toBe(false); // 16:00 EDT (right-open)
    expect(isMarketOpen('US_EQUITY', Date.UTC(2026, 2, 9, 13, 29))).toBe(false); // 09:29 EDT
  });

  it('follows the DST offset switch (09:30 local resolves at different UTC hours)', () => {
    // Before spring-forward: EST = UTC-5, so 09:30 = 14:30Z on a Friday.
    expect(isMarketOpen('US_EQUITY', Date.UTC(2026, 2, 6, 14, 30))).toBe(true);
    // After spring-forward: EDT = UTC-4, so 09:30 = 13:30Z on the following Monday.
    expect(isMarketOpen('US_EQUITY', Date.UTC(2026, 2, 9, 13, 30))).toBe(true);
    // The same 13:30Z instant is only 08:30 EST in November -> still pre-open.
    expect(isMarketOpen('US_EQUITY', Date.UTC(2026, 9, 30, 13, 30))).toBe(true); // 09:30 EDT Fri
    expect(isMarketOpen('US_EQUITY', Date.UTC(2026, 10, 2, 13, 30))).toBe(false); // 08:30 EST Mon
    // After fall-back: EST again, 09:30 = 14:30Z.
    expect(isMarketOpen('US_EQUITY', Date.UTC(2026, 10, 2, 14, 30))).toBe(true);
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
