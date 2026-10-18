/**
 * Route A prototype — stand-alone "top-pin" (贴顶蓄力) finder + overlap with the
 * shipped shrink scan, over the frozen 10/15 snapshot. Throwaway; nothing in
 * src/ is touched.
 *
 *   npx tsx .scratch\top-pin-v2.ts
 */
import fs from 'node:fs';

import { COARSE_TIMEFRAME, defaultStructureParams, detectConvergence } from '../src/domain/coin-scan';

type Bar = { t: number; o: number; h: number; l: number; c: number };

const SNAP = JSON.parse(fs.readFileSync('tools/labeling/out/candles.json', 'utf8')) as {
  candles: Record<string, number[][]>;
  history?: Record<string, number[][]>;
  volume: Record<string, { quoteVolume24h: number; volumeRank: number }>;
};
const LABELS = ['ACEUSDT', 'API3USDT', 'BGBUSDT', 'EULUSDT', 'GENIUSUSDT', 'KAVAUSDT', 'ONGUSDT', 'REUSDT', 'SIRENUSDT', 'TRBUSDT', 'UMAUSDT'];
const toBars = (raw: number[][]): Bar[] => raw.map(([t, o, h, l, c]) => ({ t, o, h, l, c })).sort((a, b) => a.t - b.t);
const iso = (b: Bar): string => new Date(b.t).toISOString().slice(0, 10);
const mean = (v: number[]): number => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
const barRange = (b: Bar): number => (b.h - b.l) / b.c;
const meanRange = (b: Bar[]): number => mean(b.map(barRange));

type Params = {
  lookback: number;
  minTravel: number;
  minPos: number;
  runMin: number;
  maxRun: number;
  /** The run's mean range may not exceed this fraction of the whole-range's. */
  maxRunEnergy: number;
  /** The second half of the run may not be livelier than the first by more than this. */
  maxHalfGrowth: number;
  maxBoxShare: number;
};

const REF: Params = {
  lookback: 90,
  minTravel: 0.3,
  minPos: 0.8,
  runMin: 5,
  maxRun: 15,
  maxRunEnergy: 1.05,
  maxHalfGrowth: 1.35,
  maxBoxShare: 0.6,
};

type Signal = {
  instrument: string;
  scannedOn: string;
  runStart: string;
  runBars: number;
  rangePct: number;
  rangeEnergy: number;
  runEnergy: number;
  halfGrowth: number;
  boxShare: number;
  pos: number;
  volumeRank: number;
};

function scanAt(instrument: string, bars: Bar[], e: number, p: Params, volumeRank: number): Signal | null {
  const last = bars[e];
  const seq = bars.slice(Math.max(0, e - p.lookback + 1), e + 1);
  if (seq.length < p.runMin + 5) return null;
  const rangeLow = Math.min(...seq.map((b) => b.l));
  const rangeHigh = Math.max(...seq.map((b) => b.h));
  const range = rangeHigh - rangeLow;
  if (range <= 0) return null;
  if (range / last.c < p.minTravel) return null;
  const pos = (last.c - rangeLow) / range;
  if (pos < p.minPos) return null;
  const rangeEnergy = meanRange(seq);
  let best: Signal | null = null;
  for (let n = p.runMin; n <= p.maxRun && n <= seq.length; n += 1) {
    const run = seq.slice(seq.length - n);
    const runLow = Math.min(...run.map((b) => b.l));
    const runHigh = Math.max(...run.map((b) => b.h));
    if (last.c < runLow || last.c > runHigh) continue;
    const boxShare = (runHigh - runLow) / range;
    if (boxShare > p.maxBoxShare) continue;
    const runEnergy = meanRange(run) / rangeEnergy;
    if (runEnergy > p.maxRunEnergy) continue;
    const half = Math.floor(n / 2);
    const first = meanRange(run.slice(0, half));
    const second = meanRange(run.slice(n - half));
    const halfGrowth = first > 0 ? second / first : Infinity;
    if (halfGrowth > p.maxHalfGrowth) continue;
    const candidate: Signal = {
      instrument,
      scannedOn: iso(last),
      runStart: iso(run[0]),
      runBars: n,
      rangePct: (range / last.c) * 100,
      rangeEnergy,
      runEnergy,
      halfGrowth,
      boxShare,
      pos,
      volumeRank,
    };
    if (best === null || candidate.runBars > best.runBars) best = candidate;
  }
  return best;
}

const instruments = Object.keys(SNAP.candles).sort();
const byIso = (inst: string, date: string) => {
  const raw = SNAP.history?.[inst] ?? SNAP.candles[inst];
  if (!raw) return null;
  const bars = toBars(raw);
  const upTo = bars.filter((b) => iso(b) <= date);
  return upTo.length >= 30 ? bars.slice(-120).filter((b) => iso(b) <= date) : null;
};

// ---------------------------------------------------------------- 1. the list
const perDay = new Map<string, Signal[]>();
const all: Signal[] = [];
for (const inst of instruments) {
  const raw = SNAP.history?.[inst] ?? SNAP.candles[inst];
  if (!raw) continue;
  const bars = toBars(raw).slice(-130);
  if (bars.length < 60) continue;
  const rank = SNAP.volume[inst]?.volumeRank ?? 9999;
  for (let e = Math.max(20, bars.length - 90); e < bars.length; e += 1) {
    const sig = scanAt(inst, bars, e, REF, rank);
    if (!sig) continue;
    all.push(sig);
    const day = perDay.get(sig.scannedOn) ?? [];
    day.push(sig);
    perDay.set(sig.scannedOn, day);
  }
}

/** Where does the signal sit inside the travelled range — the "is it a top pin?" axis. */
const profile = (s: Signal): string => {
  if (s.pos >= 0.9) return 'pinned (>=90%)';
  if (s.pos >= 0.8) return 'high (80-90%)';
  return 'other';
};
const days = [...perDay.keys()].sort();
const counts = days.map((d) => perDay.get(d)!.length).sort((a, b) => a - b);
console.log(`route A — top-pin v2 (REF): ${all.length} signals over ${days.length} days`);
console.log(`per day: min ${counts[0]} / median ${counts[Math.floor(counts.length / 2)]} / p90 ${counts[Math.floor(counts.length * 0.9)]} / max ${counts[counts.length - 1]}`);
const buckets: Record<string, number> = {};
for (const s of all) buckets[profile(s)] = (buckets[profile(s)] ?? 0) + 1;
console.log('position buckets:', JSON.stringify(buckets));

// ---------------------------------------------------------------- 2. 10/13 list
const show = (date: string) => {
  const day = (perDay.get(date) ?? []).sort((a, b) => b.pos - a.pos);
  console.log(`\n${date}: ${day.length} signals`);
  for (const s of day.slice(0, 15)) {
    console.log(
      `  ${s.instrument.padEnd(13)} run ${s.runStart} n=${String(s.runBars).padStart(2)} pos=${(s.pos * 100).toFixed(0)}% ` +
        `range=${s.rangePct.toFixed(0)}% energy=${s.runEnergy.toFixed(2)} half=${s.halfGrowth.toFixed(2)} box/range=${(s.boxShare * 100).toFixed(0)}% #${s.volumeRank}`,
    );
  }
};
show('2026-10-13');

// ---------------------------------------------------------------- 3. overlap with shrink
const shrinkAt = (inst: string, date: string) => {
  const bars = byIso(inst, date);
  if (!bars) return false;
  const candles = bars.map((b) => ({ instrument: inst, timeframe: COARSE_TIMEFRAME, timestamp: b.t, open: b.o, high: b.h, low: b.l, close: b.c, volume: 0 }));
  const r = detectConvergence(candles, defaultStructureParams());
  return r !== null && r.score >= 0.5;
};
for (const date of ['2026-10-06', '2026-10-09', '2026-10-13']) {
  const day = perDay.get(date) ?? [];
  const shrink = day.filter((s) => shrinkAt(s.instrument, date));
  console.log(`overlap ${date}: top-pin ${day.length}, of which shrink also fires ${shrink.length} (${day.length ? ((shrink.length / day.length) * 100).toFixed(0) : 0}%)`);
}

// ---------------------------------------------------------------- 4. labels
const labelHits = (date: string) => LABELS.map((inst) => ({ inst, hit: (perDay.get(date) ?? []).some((s) => s.instrument === inst) }));
console.log('\nlabels flagged by top-pin on 10/13:', labelHits('2026-10-13').filter((x) => x.hit).map((x) => x.inst).join(', ') || 'none');

// ---------------------------------------------------------------- 5. STRK trajectory
console.log('\nSTRK trajectory (REF):');
for (const date of ['2026-09-25', '2026-09-28', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']) {
  const day = perDay.get(date) ?? [];
  const s = day.find((x) => x.instrument === 'STRKUSDT');
  console.log(`  ${date}: ${s ? `run ${s.runStart} n=${s.runBars} pos=${(s.pos * 100).toFixed(0)}% energy=${s.runEnergy.toFixed(2)} half=${s.halfGrowth.toFixed(2)}` : 'no signal'}`);
}

// ---------------------------------------------------------------- 6. sensitivity
console.log('\nsensitivity:');
for (const [name, p] of [
  ['reference', REF],
  ['pos>=0.85', { ...REF, minPos: 0.85 }],
  ['pos>=0.75', { ...REF, minPos: 0.75 }],
  ['energy<=0.9', { ...REF, maxRunEnergy: 0.9 }],
  ['run<=25', { ...REF, maxRun: 25 }],
] as const) {
  const total = all.filter(() => true).length; // placeholder, recompute below
  let n10 = 0;
  let n13 = 0;
  const day = new Map<string, number>();
  for (const inst of instruments) {
    const raw = SNAP.history?.[inst] ?? SNAP.candles[inst];
    if (!raw) continue;
    const bars = toBars(raw).slice(-130);
    if (bars.length < 60) continue;
    const rank = SNAP.volume[inst]?.volumeRank ?? 9999;
    for (let e = Math.max(20, bars.length - 90); e < bars.length; e += 1) {
      const sig = scanAt(inst, bars, e, p as Params, rank);
      if (!sig) continue;
      day.set(sig.scannedOn, (day.get(sig.scannedOn) ?? 0) + 1);
      if (sig.scannedOn === '2026-10-13') n13 += 1;
      if (sig.scannedOn === '2026-10-02' && inst === 'STRKUSDT') n10 += 1;
    }
  }
  const vals = [...day.values()].sort((a, b) => a - b);
  void total;
  console.log(`  ${name.padEnd(12)} median/day ${vals[Math.floor(vals.length / 2)]}  10/13 list ${n13}  STRK 10/02 ${n10 ? 'hit' : 'miss'}`);
}
