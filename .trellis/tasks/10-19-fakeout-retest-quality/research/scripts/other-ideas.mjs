/**
 * If no shape and no absolute width: what else separates Y from N?
 *
 * Only ONE thing matters per the user: where the price sits inside its own
 * recent move. Everything else here is a candidate for HOW to measure "its own
 * recent move" and how to keep the list short, using only self-relative numbers.
 *
 * Measures on the 285 labels (snapshot anchor 10/15):
 *   pos90        position in the 90-bar range (old hard-coded)
 *   posAdaptive  hybrid range rule (box-brace -> pivot -> 90-bar)
 *   posFromPeak  distance from the last close to the highest high since the
 *                "biggest leg up" — i.e. how much of the last rally is retained
 *   retain50     last close / the close 50 bars ago minus 1? no — retention:
 *                last close relative to the high of the recent up-leg
 *
 * Filter ideas (self-relative, no absolute width):
 *   A. none (rank only)
 *   B. rank by pos, keep top-N of the day
 *   C. two-level: daily pass only when pos above the day's own 60th percentile
 *   D. state-change: today's pos crosses above the day's median for the first
 *      time in k days (a fresh "back at the top" event instead of a standing one)
 *
 * Run: node .scratch/other-ideas.mjs
 */
import fs from 'node:fs';

const snap = JSON.parse(fs.readFileSync('tools/labeling/out/candles.json', 'utf8'));
const labels = fs
  .readFileSync('.trellis/tasks/archive/2026-10/10-15-structure-fullness/research/labels-285.csv', 'utf8')
  .replace(/^\uFEFF/, '')
  .split(/\r?\n/)
  .filter(Boolean)
  .slice(1)
  .map((line) => {
    const [instrument, , , label] = line.split(',');
    return { instrument, label };
  });

const height = (bars) => Math.max(...bars.map((b) => b.h)) - Math.min(...bars.map((b) => b.l));
const position = (bars, from) => {
  const w = bars.slice(from);
  if (w.length < 3) return null;
  const lo = Math.min(...w.map((b) => b.l));
  const hi = Math.max(...w.map((b) => b.h));
  return hi > lo ? (bars[bars.length - 1].c - lo) / (hi - lo) : null;
};
const pos90 = (bars) => position(bars, Math.max(0, bars.length - 90));

function posAdaptive(bars) {
  const n = bars.length;
  let bb = null;
  for (let len = 5; len <= 30 && len <= n - 4; len++) {
    const s = n - len;
    let widest = 0;
    for (const look of [10, 20, 40]) {
      const from = Math.max(0, s - look);
      if (s - from < 3) continue;
      widest = Math.max(widest, height(bars.slice(from, s)));
    }
    if (widest > 0 && height(bars.slice(s)) / widest <= 0.65) bb = position(bars, s);
  }
  if (bb != null) return bb;
  for (let i = n - 2; i >= 5; i--) {
    const left = bars.slice(i - 5, i);
    const right = bars.slice(i + 1);
    if (!right.length) continue;
    if (bars[i].h >= Math.max(...left.map((b) => b.h)) && bars[i].h >= Math.max(...right.map((b) => b.h))) return position(bars, i);
    if (bars[i].l <= Math.min(...left.map((b) => b.l)) && bars[i].l <= Math.min(...right.map((b) => b.l))) return position(bars, i);
  }
  return position(bars, 0);
}

/** Retention: how much of the last UP leg the price kept. Up leg = from the lowest
 *  low in the last 60 bars to the highest high after it. */
function retention(bars) {
  const w = bars.slice(-60);
  let loIdx = 0;
  for (let i = 0; i < w.length; i++) if (w[i].l < w[loIdx].l) loIdx = i;
  let hi = -Infinity;
  for (let i = loIdx; i < w.length; i++) if (w[i].h > hi) hi = w[i].h;
  if (!(hi > w[loIdx].l)) return null;
  return (bars[bars.length - 1].c - w[loIdx].l) / (hi - w[loIdx].l);
}

const rows = [];
for (const { instrument, label } of labels) {
  const raw = snap.candles[instrument];
  if (!raw) continue;
  const bars = raw.map(([t, o, h, l, c]) => ({ t, o, h, l, c }));
  if (bars.length < 60) continue;
  rows.push({
    instrument,
    y: label === 'Y' ? 1 : 0,
    pos90: pos90(bars),
    posAdaptive: posAdaptive(bars),
    retention: retention(bars),
  });
}

const base = rows.reduce((a, r) => a + r.y, 0) / rows.length;
console.log(`rows ${rows.length}, Y ${rows.reduce((a, r) => a + r.y, 0)}, base ${(base * 100).toFixed(1)}%\n`);

console.log('metric       | top10% | top20% | top25% | bottom25% | base(usable)');
for (const k of ['pos90', 'posAdaptive', 'retention']) {
  const vals = rows.filter((r) => r[k] != null);
  const sorted = [...vals].sort((a, b) => b[k] - a[k]);
  const hit = (f) => {
    const cut = sorted.slice(0, Math.max(1, Math.round(vals.length * f)));
    return ((cut.reduce((a, r) => a + r.y, 0) / cut.length) * 100).toFixed(1);
  };
  const bot = sorted.slice(-Math.round(vals.length * 0.25));
  const botHit = ((bot.reduce((a, r) => a + r.y, 0) / bot.length) * 100).toFixed(1);
  const ub = ((vals.reduce((a, r) => a + r.y, 0) / vals.length) * 100).toFixed(1);
  console.log(`${k.padEnd(12)} | ${hit(0.1).padStart(6)} | ${hit(0.2).padStart(6)} | ${hit(0.25).padStart(6)} | ${botHit.padStart(9)} | ${ub}`);
}

// ---- how much of the list survives a "rank by pos and keep top N per day" rule?
// On the snapshot the whole pool is one day, so we can only show: with pos >= x,
// how many instruments pass (of 427) and how many of the 36 Y survive.
console.log('\ngate size (whole 427 pool at the snapshot) vs Y kept (36):');
const poolRows = [];
for (const inst of Object.keys(snap.candles)) {
  const raw = snap.candles[inst];
  const bars = raw.map(([t, o, h, l, c]) => ({ t, o, h, l, c }));
  if (bars.length < 60) continue;
  poolRows.push({ instrument: inst, pos: posAdaptive(bars) });
}
const ySet = new Set(rows.filter((r) => r.y).map((r) => r.instrument));
for (const cut of [0.5, 0.6, 0.7, 0.8]) {
  const pass = poolRows.filter((r) => r.pos != null && r.pos >= cut);
  const yKept = pass.filter((r) => ySet.has(r.instrument)).length;
  console.log(`  pos >= ${cut}: ${pass.length}/427 instruments, keeps ${yKept}/36 Y (precision in the list ${((yKept / Math.max(1, pass.length)) * 100).toFixed(1)}%)`);
}
const top30 = [...poolRows].sort((a, b) => b.pos - a.pos).slice(0, 30);
console.log(`  top30 by pos: keeps ${top30.filter((r) => ySet.has(r.instrument)).length}/36 Y (precision ${((top30.filter((r) => ySet.has(r.instrument)).length / 30) * 100).toFixed(1)}%)`);
