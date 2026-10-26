/**
 * Replay the user's "good stretch" labels on 1D, look-ahead free.
 *
 * For each labeled good stretch (start → breakout-bar), ask: on the LAST bar
 * before the breakout, could a daily scan have described it as "moved, now
 * holding a box under the high (or in the upper half), not broken yet"?
 *
 * Sources (fallbacks, never a silent miss):
 *   1. data/review.sqlite        1D candles
 *   2. data/labeling.sqlite      1D candles
 *   3. tools/labeling/out/candles.json  (the frozen 10/15 snapshot: history + 90-bar slice)
 *
 *   npx tsx .scratch\replay-segments.ts
 */
import fs from 'node:fs';
import Database from 'better-sqlite3';

type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };

const SEGMENTS: { instrument: string; start: string; end: string | null; label: string }[] = [
  { instrument: 'ZECUSDT', start: '2026-05-20', end: '2026-08-17', label: 'N' },
  { instrument: 'ZECUSDT', start: '2026-08-26', end: '2026-09-01', label: 'N' },
  { instrument: 'OPUSDT', start: '2026-08-21', end: '2026-09-16', label: 'Y' },
  { instrument: 'OPUSDT', start: '2026-10-10', end: '2026-10-12', label: 'Y' },
  { instrument: 'STRKUSDT', start: '2026-09-25', end: '2026-10-01', label: 'N' },
  { instrument: 'TIAUSDT', start: '2026-10-03', end: '2026-10-05', label: 'N' },
  { instrument: 'WALUSDT', start: '2026-10-10', end: '2026-10-12', label: 'Y' },
  { instrument: 'BEAMUSDT', start: '2026-09-28', end: '2026-10-02', label: 'N' },
  { instrument: 'BATUSDT', start: '2026-09-28', end: '2026-09-30', label: 'N' },
  { instrument: 'AXLUSDT', start: '2026-10-03', end: '2026-10-05', label: 'N' },
  { instrument: 'XMRUSDT', start: '2026-08-16', end: '2026-08-20', label: 'N' },
  { instrument: 'XMRUSDT', start: '2026-08-09', end: '2026-08-13', label: 'N' },
  { instrument: 'OPGUSDT', start: '2026-10-02', end: '2026-10-07', label: 'Y' },
  { instrument: 'STXUSDT', start: '2026-08-31', end: null, label: 'N' },
  { instrument: 'BTWUSDT', start: '2026-09-03', end: null, label: 'N' },
  { instrument: 'PYTHUSDT', start: '2026-09-04', end: null, label: 'N' },
  { instrument: 'BERAUSDT', start: '2026-08-31', end: null, label: 'Y' },
  { instrument: 'AEROUSDT', start: '2026-09-09', end: null, label: 'N' },
  { instrument: 'NEARUSDT', start: '2026-08-25', end: null, label: 'N' },
  { instrument: 'NIGHTUSDT', start: '2026-08-19', end: null, label: 'N' },
  { instrument: 'LINEAUSDT', start: '2026-08-23', end: null, label: 'N' },
  { instrument: 'AZTECUSDT', start: '2026-09-18', end: null, label: 'N' },
  { instrument: 'SIGNUSDT', start: '2026-09-10', end: null, label: 'N' },
  { instrument: 'FLUXUSDT', start: '2026-09-29', end: null, label: 'Y' },
  { instrument: 'INJUSDT', start: '2026-04-18', end: null, label: 'N' },
];

// ---------------------------------------------------------------- candle sources
const reviewDb = (() => {
  try {
    return new Database('data/review.sqlite', { readonly: true });
  } catch {
    return null;
  }
})();
const labelingDb = (() => {
  try {
    return new Database('data/labeling.sqlite', { readonly: true });
  } catch {
    return null;
  }
})();
const snapshot = JSON.parse(fs.readFileSync('tools/labeling/out/candles.json', 'utf8')) as {
  candles: Record<string, number[][]>;
  history?: Record<string, number[][]>;
};

function fromDb(db: Database.Database | null, instrument: string): Bar[] {
  if (!db) return [];
  try {
    const rows = db
      .prepare(
        "select timestamp t, open o, high h, low l, close c, volume v from candles where instrument = ? and timeframe = '1D' order by timestamp",
      )
      .all(instrument) as Bar[];
    return rows;
  } catch {
    return [];
  }
}

function fromSnapshot(instrument: string): Bar[] {
  const raw = snapshot.history?.[instrument] ?? snapshot.candles[instrument] ?? [];
  return raw.map(([t, o, h, l, c]) => ({ t, o, h, l, c, v: 0 }));
}

function dailyBars(instrument: string): { bars: Bar[]; source: string } {
  for (const [name, db] of [
    ['review.sqlite', reviewDb],
    ['labeling.sqlite', labelingDb],
  ] as const) {
    const bars = fromDb(db, instrument);
    if (bars.length >= 90) return { bars, source: name };
  }
  const bars = fromSnapshot(instrument);
  if (bars.length >= 60) return { bars, source: 'snapshot' };
  return { bars, source: 'insufficient' };
}

// ---------------------------------------------------------------- measures
const iso = (b: Bar) => new Date(b.t).toISOString().slice(0, 10);
const barRange = (b: Bar) => (b.h - b.l) / b.c;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** The move the box consolidates: max travel over a few lookbacks before the box. */
function precedingMove(bars: Bar[], boxStart: number): { travel: number; high: number; low: number } {
  let best = { travel: 0, high: -Infinity, low: Infinity };
  for (const look of [10, 20, 40]) {
    const from = Math.max(0, boxStart - look);
    const lead = bars.slice(from, boxStart);
    if (lead.length < 3) continue;
    const hi = Math.max(...lead.map((b) => b.h));
    const lo = Math.min(...lead.map((b) => b.l));
    if (hi - lo > best.travel) best = { travel: hi - lo, high: hi, low: lo };
  }
  return best;
}

/** A scan at bar `E` (only bars <= E are visible). */
function scanAt(bars: Bar[], E: number) {
  const last = bars[E];
  let best: {
    len: number;
    start: number;
    squeeze: number;
    pos: number;
    boxShare: number;
    heldAboveMoveLow: boolean;
  } | null = null;
  for (let len = 5; len <= 30 && len <= E + 1; len += 1) {
    const start = E - len + 1;
    const box = bars.slice(start, E + 1);
    const low = Math.min(...box.map((b) => b.l));
    const high = Math.max(...box.map((b) => b.h));
    const height = high - low;
    if (height <= 0) continue;
    // Not broken yet: the last close is inside the box.
    if (last.c < low || last.c > high) continue;
    const move = precedingMove(bars, start);
    if (move.travel <= 0) continue;
    const squeeze = height / move.travel;
    const against = ((low - move.low) / move.travel) * 100;
    const pos = (last.c - low) / height;
    const score = { len, start, squeeze, pos, boxShare: height / (Math.max(...bars.slice(-90).map((b) => b.h))), heldAboveMoveLow: against >= -25 };
    // Keep the longest box that is already squeezed enough to be worth reporting.
    if (squeeze <= 0.65 && (best === null || len > best.len)) best = score;
  }
  return best;
}

// ---------------------------------------------------------------- run
console.log('segment replay (daily, look-ahead free):\n');
const results: { seg: string; source: string; scannedOn: string | null; len: number | null; squeeze: number | null; pos: number | null; ok: boolean }[] = [];

for (const seg of SEGMENTS) {
  const { bars, source } = dailyBars(seg.instrument);
  const startIdx = bars.findIndex((b) => iso(b) >= seg.start);
  const endIdx = seg.end ? bars.findIndex((b) => iso(b) >= seg.end) : bars.length - 1;
  const segName = `${seg.instrument} ${seg.start}-${seg.end ?? 'open'}`;
  if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) {
    results.push({ seg: segName, source, scannedOn: null, len: null, squeeze: null, pos: null, ok: false });
    console.log(`  ${segName.padEnd(34)} ${source.padEnd(10)} no data for the stretch`);
    continue;
  }
  // The scan's decision day is the bar BEFORE the breakout (end - 1 when the end
  // is a known breakout day, else the last bar available).
  const decisionBar = seg.end ? Math.max(startIdx + 4, endIdx - 1) : bars.length - 1;
  const found = scanAt(bars, decisionBar);
  results.push({
    seg: segName,
    source,
    scannedOn: iso(bars[decisionBar]),
    len: found?.len ?? null,
    squeeze: found ? +found.squeeze.toFixed(2) : null,
    pos: found ? +found.pos.toFixed(2) : null,
    ok: found !== null,
  });
  console.log(
    `  ${segName.padEnd(34)} ${source.padEnd(10)} scan@${iso(bars[decisionBar])} ` +
      (found ? `HIT  box=${found.len}d squeeze=${found.squeeze.toFixed(2)} pos=${found.pos.toFixed(2)}` : 'MISS'),
  );
}

const hits = results.filter((r) => r.ok).length;
console.log(`\nhit rate: ${hits}/${results.length} (${((hits / results.length) * 100).toFixed(0)}%)`);
console.log('by source:', JSON.stringify(results.reduce((acc: Record<string, number>, r) => ({ ...acc, [r.source]: (acc[r.source] ?? 0) + 1 }), {})));
fs.writeFileSync('.scratch/replay-results.json', JSON.stringify(results, null, 2));
