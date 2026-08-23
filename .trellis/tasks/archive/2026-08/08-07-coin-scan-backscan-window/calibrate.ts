import { describe, it } from 'vitest';
import Database from 'better-sqlite3';
import { writeFileSync, appendFileSync, existsSync } from 'node:fs';
import type { Candlestick } from '../../../src/domain/candlestick';
import {
  backscanWindow,
  classifyStructure,
  defaultStructureParams,
  detectSwings,
  probeStructure,
  type StructureParams,
} from '../../../src/domain/coin-scan';

const DB_PATH = 'data/review.sqlite';
const LOG = '.trellis/tasks/08-07-coin-scan-backscan-window/calibrate.log';
function log(...parts: unknown[]): void {
  appendFileSync(LOG, parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ') + '\n');
}
writeFileSync(LOG, '');

function loadCandles(instrument: string, timeframe: string, limit: number, offset = 0): Candlestick[] {
  // The sqlite cache is gitignored/local; without it the calibration runs degrade
  // to empty windows instead of failing the suite.
  if (!existsSync(DB_PATH)) return [];
  const db = new Database(DB_PATH, { readonly: true });
  const rows = db
    .prepare(
      `select timestamp, open, high, low, close, volume from candles
       where instrument = ? and timeframe = ? order by timestamp asc limit ? offset ?`,
    )
    .all(instrument, timeframe, limit, offset) as Candlestick[];
  db.close();
  return rows;
}

function meanAmplitude(candles: Candlestick[]): number {
  let sum = 0;
  for (const c of candles) sum += (c.high - c.low) / c.low;
  return sum / candles.length;
}

// The MRVL 15m genuine-triangle fixture (previous task, verified score 0.93):
// swing indices 23..92, currentIndex 98, lastPrice 215.62. In the current cache
// this window is cache index = fixture index + 32 (cache 55..124, currentIndex
// 130 = the 06:15 bar with close 215.62).
describe('MRVL 15m fixture window (cache 32..130)', () => {
  it('reproduces the real swings and the close-gate verdict', () => {
    const candles = loadCandles('MRVLUSDT', '15m', 99, 32);
    const last = candles[candles.length - 1];
    log('MRVL window last bar:', last.timestamp, 'close', last.close);
    log('meanAmplitude (prior):', meanAmplitude(candles));
    for (const n of [2]) {
      const swings = detectSwings(candles, n);
      log(`N=${n} swings (index:kind:price close):`);
      for (const s of swings) log(`  ${s.index}:${s.kind} ${s.price.toFixed(2)} close=${s.close.toFixed(2)}`);
      const params: StructureParams = defaultStructureParams({ currentIndex: candles.length - 1 });
      const segment = backscanWindow(swings, candles, params);
      if (segment) {
        const result = classifyStructure(segment, params);
        log(`segment ${segment[0].index}..${segment[segment.length - 1].index} (${segment.length}) → ${JSON.stringify(result)}`);
      } else {
        log('no backscan segment');
      }
      const probe = probeStructure(candles, defaultStructureParams());
      log(`probeStructure → ${JSON.stringify(probe)}`);
    }
  });
});

// The INTC 15m case: an earlier 103 spike must terminate the backscan so the
// current box excludes it.
describe('INTC 15m 103-spike exclusion (cache window)', () => {
  it('spike close breaks the high edge; backscan starts after it', () => {
    const candles = loadCandles('INTCUSDT', '15m', 100);
    log('meanAmplitude (prior):', meanAmplitude(candles));
    const swings = detectSwings(candles, 2);
    const params: StructureParams = defaultStructureParams({ currentIndex: candles.length - 1 });
    const segment = backscanWindow(swings, candles, params);
    log('INTC full N=2 swings with closes:');
    for (const s of swings) log(`  ${s.index}:${s.kind} ${s.price.toFixed(2)} close=${s.close.toFixed(2)}`);
    if (segment) {
      log(`segment ${segment[0].index}..${segment[segment.length - 1].index} (${segment.length})`);
      const result = classifyStructure(segment, params);
      log(`classify → ${JSON.stringify(result)}`);
      log(`103 spike (index 69) in segment? ${segment.some((s) => s.index === 69)}`);
    } else {
      log('no backscan segment');
    }
  });
});

// Sweep B / tolerance on the frozen fixture windows encoded in the tests, to
// confirm the constants (13 / 5 / 0.2) sit on the right side of the boundary.
describe('calibration: constants vs real-derived fixtures', () => {
  const { boxSwings, mrvlRising, heiSpike, xrpSlow } = fixtureData();
  it('sweep structureTolerance over genuine vs misjudged fixtures', () => {
    const params = defaultStructureParams({ currentIndex: 98, lastPrice: 215.62, priorAmplitude: 0.03 });
    for (const tol of [0.05, 0.1, 0.2, 0.3, 0.5]) {
      const p = { ...params, structureTolerance: tol };
      const mrvl = classifyStructure(mrvlRising, p);
      const hei = classifyStructure(heiSpike, p);
      const xrp = classifyStructure(xrpSlow, p);
      log(`tol=${tol}  MRVL=${mrvl ? mrvl.structure : 'null'}  HEI=${hei ? hei.structure : 'null'}  XRP=${xrp ? xrp.structure : 'null'}`);
    }
  });
  it('sweep minSpanTriangle on the genuine MRVL triangle', () => {
    const params = defaultStructureParams({ currentIndex: 98, lastPrice: 215.62, priorAmplitude: 0.03 });
    for (const span of [5, 8, 13, 15, 20, 25]) {
      const p = { ...params, minSpanTriangle: span };
      const mrvl = classifyStructure(mrvlRising, p);
      log(`minSpanTriangle=${span}  MRVL=${mrvl ? mrvl.structure : 'null'}`);
    }
  });
});

// Reconstruct the fixtures used by tests/coin-scan.test.ts (real-data-derived).
function fixtureData(): {
  boxSwings: ReturnType<typeof swing>[];
  mrvlRising: ReturnType<typeof swing>[];
  heiSpike: ReturnType<typeof swing>[];
  xrpSlow: ReturnType<typeof swing>[];
} {
  const boxSwings = [6, 11, 16, 21, 26, 31, 36, 41].map((i, k) =>
    swing(i, k % 2 === 0 ? 97 : 113, k % 2 === 0 ? 'low' : 'high'),
  );
  const mrvlRising = [
    swing(23, 210.02, 'high'), swing(31, 202.13, 'low'), swing(35, 219.73, 'high'),
    swing(58, 208.55, 'low'), swing(73, 215.0, 'high'), swing(79, 211.15, 'low'),
    swing(85, 214.38, 'high'), swing(92, 211.88, 'low'),
  ];
  const heiSpike = [
    swing(0, 0.2136, 'high'), swing(2, 0.1950, 'low'), swing(4, 0.2108, 'high'),
    swing(6, 0.1969, 'low'), swing(8, 0.2125, 'high'), swing(10, 0.1816, 'low'),
    swing(12, 0.2038, 'high'), swing(14, 0.1957, 'low'),
  ];
  const xrpSlow = [
    swing(30, 1.0388, 'low'), swing(32, 1.0582, 'high'), swing(33, 1.0410, 'low'),
    swing(35, 1.0540, 'high'), swing(37, 1.0317, 'low'), swing(38, 1.0371, 'high'),
    swing(39, 1.0292, 'low'), swing(40, 1.0389, 'high'),
  ];
  return { boxSwings, mrvlRising, heiSpike, xrpSlow };
}

function swing(index: number, price: number, kind: 'high' | 'low'): { index: number; timestamp: number; price: number; kind: 'high' | 'low'; close: number } {
  return { index, timestamp: index * 3600_000, price, kind, close: price };
}
