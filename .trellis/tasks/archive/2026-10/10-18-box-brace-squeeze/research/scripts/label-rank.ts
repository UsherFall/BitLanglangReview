/**
 * Throwaway validation: can three fixed-window measures rank the 285 labels?
 *
 *   s20      = mean bar range of the last 20 bars / mean bar range of the 20 before
 *   pos90    = (lastClose - min low of 90) / (max high - min low of 90)
 *   priorMove= (close[-24] - close[-90]) / close[-90]   (the "前戏" before the window)
 *
 * No band search, no fitted weights — each measure alone, then a simple product.
 * Data: tools/labeling/out/candles.json (the SAME snapshot the labels were made on).
 *
 *   npx tsx .scratch\label-rank.ts
 */
import fs from 'node:fs';

type Bar = { t: number; o: number; h: number; l: number; c: number };

const SNAP = JSON.parse(fs.readFileSync('tools/labeling/out/candles.json', 'utf8')) as {
  candles: Record<string, number[][]>;
  history?: Record<string, number[][]>;
};
const CSV = fs.readFileSync('.trellis/tasks/10-15-structure-fullness/research/labels-285.csv', 'utf8').trim().split('\n').slice(1);

/** Both series contain the same bars; `candles` is the 90-bar detection view. */
const seriesOf = (instrument: string): Bar[] => {
  const raw = SNAP.candles[instrument] ?? SNAP.history?.[instrument];
  return raw ? raw.map(([t, o, h, l, c]) => ({ t, o, h, l, c })).sort((a, b) => a.t - b.t) : [];
};
const barRange = (b: Bar): number => (b.h - b.l) / b.c;
const mean = (v: number[]): number => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);

type Measures = { s20: number; s40: number; pos90: number; priorMove: number };

function measures(bars: Bar[]): Measures | null {
  if (bars.length < 60) return null;
  const n = bars.length;
  const last20 = bars.slice(n - 20);
  const prev20 = bars.slice(n - 40, n - 20);
  const prev40 = bars.slice(n - 80, n - 40);
  const s20 = mean(last20.map(barRange)) / Math.max(mean(prev20.map(barRange)), 1e-9);
  const s40 = mean(bars.slice(n - 40).map(barRange)) / Math.max(mean(prev40.map(barRange)), 1e-9);
  const look = bars.slice(-90);
  const lo = Math.min(...look.map((b) => b.l));
  const hi = Math.max(...look.map((b) => b.h));
  const pos90 = hi > lo ? (bars[n - 1].c - lo) / (hi - lo) : 0.5;
  const from = bars[n - 90]?.c ?? bars[0].c;
  const to = bars[n - 24]?.c ?? bars[n - 1].c;
  const priorMove = (to - from) / from;
  return { s20, s40, pos90, priorMove };
}

type Row = { instrument: string; label: 'Y' | 'N'; m: Measures | null };

const rows: Row[] = CSV.map((line) => {
  const [instrument, , , label] = line.split(',');
  return { instrument, label: label === 'Y' ? 'Y' : 'N', m: measures(seriesOf(instrument)) };
}).filter((r) => r.instrument);

const usable = rows.filter((r) => r.m !== null) as (Row & { m: Measures })[];
const skipped = rows.length - usable.length;
const base = usable.filter((r) => r.label === 'Y').length / usable.length;
console.log(`labels: ${rows.length} (usable ${usable.length}, skipped ${skipped})  Y=${usable.filter((r) => r.label === 'Y').length}  base rate=${(base * 100).toFixed(1)}%`);

function quartiles(name: string, pick: (m: Measures) => number, ascending: boolean) {
  const sorted = [...usable].sort((a, b) => (pick(a.m) - pick(b.m)) * (ascending ? 1 : -1));
  const q = Math.floor(sorted.length / 4);
  const bands = [sorted.slice(0, q), sorted.slice(q, 2 * q), sorted.slice(2 * q, 3 * q), sorted.slice(3 * q)];
  const stats = bands.map((band) => {
    const ys = band.filter((r) => r.label === 'Y').length;
    return `${ys}/${band.length} (${((ys / band.length) * 100).toFixed(0)}%)`;
  });
  console.log(`  ${name.padEnd(28)} lowest→highest: ${stats.join('  ')}`);
}

console.log('\nquartiles of Y rate (each measure alone):');
quartiles('s20 (lower = contracted)', (m) => m.s20, true);
quartiles('s40 (contraction, 40 bars)', (m) => m.s40, true);
quartiles('pos90 (higher = near high)', (m) => m.pos90, false);
quartiles('|priorMove| (bigger prior)', (m) => Math.abs(m.priorMove), false);
quartiles('priorMove (higher = up move)', (m) => m.priorMove, false);

/** Precision / recall of taking the top K by one ranking. */
function topK(name: string, score: (m: Measures) => number, ks: number[]) {
  const sorted = [...usable].sort((a, b) => score(b.m) - score(a.m));
  const totalY = usable.filter((r) => r.label === 'Y').length;
  const parts = ks.map((k) => {
    const top = sorted.slice(0, k);
    const y = top.filter((r) => r.label === 'Y').length;
    return `K=${k}: ${y}/${k} (${((y / k) * 100).toFixed(0)}%, covers ${((y / totalY) * 100).toFixed(0)}% Y)`;
  });
  console.log(`  ${name.padEnd(34)} ${parts.join('  |  ')}`);
}

console.log('\ntop-K precision / recall:');
topK('s20 asc', (m) => 1 - m.s20, [10, 20, 30, 50]);
topK('pos90 desc', (m) => m.pos90, [10, 20, 30, 50]);
const z = (v: number, all: number[]): number => {
  const mu = mean(all);
  const sd = Math.sqrt(mean(all.map((x) => (x - mu) ** 2))) || 1;
  return (v - mu) / sd;
};
const s20s = usable.map((r) => r.m.s20);
const p90s = usable.map((r) => r.m.pos90);
topK('z(pos90) - z(s20) (equal weights)', (m) => z(m.pos90, p90s) - z(m.s20, s20s), [10, 20, 30, 50]);
topK('pos90 * (1 - s20)', (m) => m.pos90 * (1 - m.s20), [10, 20, 30, 50]);
topK('pos90 only, fallback s20', (m) => m.pos90 - 0.1 * m.s20, [10, 20, 30, 50]);

console.log('\nY rows, sorted by pos90 desc:');
const ys = usable.filter((r) => r.label === 'Y').sort((a, b) => b.m.pos90 - a.m.pos90).slice(0, 15);
for (const r of ys) {
  console.log(`  ${r.instrument.padEnd(13)} pos90=${(r.m.pos90 * 100).toFixed(0)}%  s20=${r.m.s20.toFixed(2)}  s40=${r.m.s40.toFixed(2)}  prior=${(r.m.priorMove * 100).toFixed(0)}%`);
}
