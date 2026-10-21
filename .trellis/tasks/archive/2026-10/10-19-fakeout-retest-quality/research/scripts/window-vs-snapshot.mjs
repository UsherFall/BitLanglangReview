/**
 * retention on the 427-instrument labeling snapshot (tools/labeling/out/candles.json,
 * 90 daily bars by design — that fetch is capped at 90 bars).
 *
 * Question 1: how much lookback does the RETENTION rule actually need?
 *   If a 60-bar window and a 30/20-bar window agree on the ranking, the live scan
 *   can reuse the 1D series it ALREADY fetched for the coarse screen instead of
 *   paying a second request per instrument for a longer history.
 *
 * Question 2: is the 60-bar window the right LENGTH? Re-scores the 285 labels at
 *   W = 20/30/40/60/90 on the SAME snapshot, so the comparison is not confounded
 *   by a different data window.
 *
 * Run: node <this>   (cwd = repo root)
 */
import fs from 'node:fs';

const snap = JSON.parse(fs.readFileSync('tools/labeling/out/candles.json', 'utf8'));
const labelRows = fs
  .readFileSync('.trellis/tasks/archive/2026-10/10-15-structure-fullness/research/labels-285.csv', 'utf8')
  .replace(/^\uFEFF/, '')
  .split(/\r?\n/)
  .filter(Boolean)
  .slice(1)
  .map((line) => {
    const [instrument, , , label] = line.split(',');
    return { instrument, y: label.trim() === 'Y' ? 1 : 0 };
  });

const bars = new Map();
for (const [inst, raw] of Object.entries(snap.candles)) {
  if (!Array.isArray(raw) || raw.length < 20) continue;
  bars.set(inst, raw.map(([t, o, h, l, c]) => ({ t, o, h, l, c })));
}

function retention(arr, look) {
  const w = arr.slice(-look);
  if (w.length < Math.min(20, look)) return null;
  let loIdx = 0;
  for (let i = 1; i < w.length; i++) if (w[i].l < w[loIdx].l) loIdx = i;
  const lo = w[loIdx].l;
  let hi = -Infinity;
  for (let i = loIdx; i < w.length; i++) if (w[i].h > hi) hi = w[i].h;
  if (!(hi > lo)) return null;
  return (arr[arr.length - 1].c - lo) / (hi - lo);
}

// ---- Q1: pairwise agreement between window lengths, whole 427 pool
const LENGTHS = [20, 30, 40, 60, 90];
const values = new Map(LENGTHS.map((w) => [w, new Map()]));
for (const [inst, arr] of bars) {
  for (const w of LENGTHS) {
    const r = retention(arr, w);
    if (r != null) values.get(w).set(inst, r);
  }
}

/** Fraction of the union that lands in the same top-10% set under both windows. */
function topSet(w, frac = 0.1) {
  const entries = [...values.get(w).entries()].sort((a, b) => b[1] - a[1]);
  return new Set(entries.slice(0, Math.max(1, Math.round(entries.length * frac))).map(([k]) => k));
}
function spearman(w1, w2) {
  const common = [...values.get(w1).keys()].filter((k) => values.get(w2).has(k));
  const rank = (w) => {
    const sorted = [...common].sort((a, b) => values.get(w)[b] - values.get(w)[a]);
    const r = new Map();
    sorted.forEach((k, i) => r.set(k, i));
    return r;
  };
  const r1 = rank(w1), r2 = rank(w2);
  const n = common.length;
  let d2 = 0;
  for (const k of common) d2 += (r1.get(k) - r2.get(k)) ** 2;
  return 1 - (6 * d2) / (n * (n * n - 1));
}

console.log(`snapshot: ${bars.size} instruments with >=20 bars\n`);
console.log('Q1a. overlap of the top-10% set (Jaccard, higher = same names)');
process.stdout.write('        ' + LENGTHS.map((w) => `W=${String(w).padStart(2)}`).join('  ') + '\n');
for (const a of LENGTHS) {
  const sa = topSet(a);
  const cells = LENGTHS.map((b) => {
    const sb = topSet(b);
    const inter = [...sa].filter((k) => sb.has(k)).length;
    const union = new Set([...sa, ...sb]).size;
    return (inter / union).toFixed(2).padStart(4);
  });
  console.log(`  W=${String(a).padStart(2)}  ` + cells.join('  '));
}
console.log('\nQ1b. Spearman rank correlation over the whole pool');
process.stdout.write('        ' + LENGTHS.map((w) => `W=${String(w).padStart(2)}`).join('  ') + '\n');
for (const a of LENGTHS) {
  console.log(`  W=${String(a).padStart(2)}  ` + LENGTHS.map((b) => spearman(a, b).toFixed(2).padStart(4)).join('  '));
}

// ---- Q2: the 285 labels, per window length (cross-section inside the snapshot)
console.log('\nQ2. 285 labels on the snapshot, precision of the top X% within the in-snapshot pool');
const labelled = labelRows.filter((l) => values.get(60)?.has(l.instrument));
const yTotal = labelled.reduce((a, l) => a + l.y, 0);
console.log(`  labelled in snapshot: ${labelled.length}, Y ${yTotal}, base ${((yTotal / labelled.length) * 100).toFixed(1)}%`);
console.log('  W   | ' + [0.05, 0.1, 0.15, 0.2].map((f) => `top${(f * 100).toFixed(0).padStart(2)}%`).join('  '));
for (const w of LENGTHS) {
  const inPool = labelled.filter((l) => values.get(w).has(l.instrument));
  const sorted = [...inPool].sort((a, b) => values.get(w).get(b.instrument) - values.get(w).get(a.instrument));
  const cells = [0.05, 0.1, 0.15, 0.2].map((f) => {
    const cut = sorted.slice(0, Math.max(1, Math.round(inPool.length * f)));
    const y = cut.reduce((a, l) => a + l.y, 0);
    return `${((y / Math.max(1, cut.length)) * 100).toFixed(1)}%`.padStart(6);
  });
  console.log(`  ${String(w).padStart(2)}  | ` + cells.join('   '));
}

// ---- Q3: does a SHORTER window dilute the "strength filter" character?
// Per-window: how the top-10% set splits by the size of the leg it retained.
console.log('\nQ3. the top-10% set by leg size (the up-leg it measures; 60-bar window = today\'s rule)');
for (const w of LENGTHS) {
  // NOTE: sort BEFORE slicing; `a[1] - b[1]` on Maps coerces to NaN and leaves
  // the insertion order untouched (that produced a wrong Q3 on the first run).
  const entries = [...values.get(w).entries()].sort((a, b) => b[1] - a[1]).slice(0, Math.round(values.get(w).size * 0.1));
  let big = 0, mid = 0, small = 0;
  for (const [inst] of entries) {
    const arr = bars.get(inst);
    const ww = arr.slice(-w);
    let loIdx = 0;
    for (let i = 1; i < ww.length; i++) if (ww[i].l < ww[loIdx].l) loIdx = i;
    const lo = ww[loIdx].l;
    let hi = -Infinity;
    for (let i = loIdx; i < ww.length; i++) if (ww[i].h > hi) hi = ww[i].h;
    const leg = (hi / lo - 1) * 100;
    if (leg >= 100) big++;
    else if (leg >= 50) mid++;
    else small++;
  }
  console.log(`  W=${String(w).padStart(2)}: n=${entries.length}; leg>=100% ${big}, 50-100% ${mid}, <50% ${small}`);
}
