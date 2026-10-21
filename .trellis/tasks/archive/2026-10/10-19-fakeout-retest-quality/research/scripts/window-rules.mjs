/**
 * Better window rules for "where does the price sit inside its own recent move".
 *
 * V0 baseline  : 90-bar range (the old hard-coded measure).
 * R1 long bar  : range after the most recent long bar (body >= k x median body).
 * R2 box brace : range of the most recent 5..30-bar window whose height is <= 0.65
 *                of the widest 10/20/40-bar travel before it (the shipped
 *                detectBoxBrace idea, used as a RANGE rather than a gate).
 * R3 pivot     : range from the last obvious turning point — the most recent bar
 *                that is the max high (or min low) of the 5 bars on each side
 *                (a fractal swing), extended to the latest close.
 * R4 hybrid    : R2 if exists, else R3, else V0.
 *
 * Metric = position of the latest close in that range (0=low, 1=high).
 * Evaluate: top-K precision on the 285 hand labels (Y=36, base 12.8%).
 *
 * Run: node .scratch/window-rules.mjs
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

const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);
const posOf = (bars, from) => {
  if (from == null || from < 0) return null;
  const w = bars.slice(from);
  if (w.length < 3) return null;
  const hi = Math.max(...w.map((b) => b.h));
  const lo = Math.min(...w.map((b) => b.l));
  if (!(hi > lo)) return null;
  return (bars[bars.length - 1].c - lo) / (hi - lo);
};

function from90(bars) {
  return posOf(bars, Math.max(0, bars.length - 90));
}

function fromLongBar(bars, bodyK) {
  for (let i = bars.length - 2; i >= 2; i--) {
    const prev = bars.slice(Math.max(0, i - 20), i);
    const medBody = median(prev.map((x) => Math.abs(x.c - x.o)));
    if (!(medBody > 0)) continue;
    if (Math.abs(bars[i].c - bars[i].o) >= bodyK * medBody) return posOf(bars, i);
  }
  return null;
}

function fromBoxBrace(bars) {
  const n = bars.length;
  let bestStart = null;
  let bestLen = -1;
  for (let len = 5; len <= 30 && len <= n - 4; len++) {
    const s = n - len;
    const box = bars.slice(s);
    const bh = Math.max(...box.map((b) => b.h)) - Math.min(...box.map((b) => b.l));
    if (!(bh > 0)) continue;
    let widest = 0;
    for (const look of [10, 20, 40]) {
      const from = Math.max(0, s - look);
      if (s - from < 3) continue;
      const pre = bars.slice(from, s);
      const t = Math.max(...pre.map((b) => b.h)) - Math.min(...pre.map((b) => b.l));
      if (t > widest) widest = t;
    }
    if (!(widest > 0)) continue;
    if (bh / widest > 0.65) continue;
    if (len > bestLen) { bestLen = len; bestStart = s; }
  }
  return posOf(bars, bestStart);
}

function fromPivot(bars, wing = 5) {
  const n = bars.length;
  for (let i = n - 2; i >= wing; i--) {
    const left = bars.slice(i - wing, i);
    const right = bars.slice(i + 1, Math.min(n, i + 2 + wing));
    if (!right.length) continue;
    const isHigh = bars[i].h >= Math.max(...left.map((b) => b.h)) && bars[i].h >= Math.max(...right.map((b) => b.h));
    const isLow = bars[i].l <= Math.min(...left.map((b) => b.l)) && bars[i].l <= Math.min(...right.map((b) => b.l));
    if (isHigh || isLow) return posOf(bars, i);
  }
  return null;
}

const RULES = {
  V0_90bar: from90,
  R1_long2x: (b) => fromLongBar(b, 2),
  R2_boxbrace: fromBoxBrace,
  R3_pivot: (b) => fromPivot(b, 5),
  R4_hybrid: (b) => fromBoxBrace(b) ?? fromPivot(b, 5) ?? from90(b),
  R5_pivot3: (b) => fromPivot(b, 3),
};

const rows = [];
for (const { instrument, label } of labels) {
  const raw = snap.candles[instrument];
  if (!raw) continue;
  const bars = raw.map(([t, o, h, l, c]) => ({ t, o, h, l, c }));
  if (bars.length < 60) continue;
  const rec = { instrument, y: label === 'Y' ? 1 : 0 };
  for (const [k, fn] of Object.entries(RULES)) rec[k] = fn(bars);
  rows.push(rec);
}

const base = rows.reduce((a, r) => a + r.y, 0) / rows.length;
console.log(`rows ${rows.length}, Y ${rows.reduce((a, r) => a + r.y, 0)}, base ${(base * 100).toFixed(1)}%\n`);
console.log('rule         | usable | base(usable) | top10% | top20% | top25% | Y-coverage');
for (const k of Object.keys(RULES)) {
  const vals = rows.filter((r) => r[k] != null);
  if (!vals.length) { console.log(`${k.padEnd(12)} | none`); continue; }
  const sorted = [...vals].sort((a, b) => b[k] - a[k]);
  const hit = (f) => {
    const cut = sorted.slice(0, Math.max(1, Math.round(vals.length * f)));
    return (cut.reduce((a, r) => a + r.y, 0) / cut.length) * 100;
  };
  const cov = (vals.reduce((a, r) => a + r.y, 0) / rows.reduce((a, r) => a + r.y, 0)) * 100;
  const ub = (vals.reduce((a, r) => a + r.y, 0) / vals.length) * 100;
  console.log(
    `${k.padEnd(12)} | ${String(vals.length).padStart(6)} | ${ub.toFixed(1).padStart(11)}% | ${hit(0.1).toFixed(1).padStart(5)}% | ${hit(0.2).toFixed(1).padStart(5)}% | ${hit(0.25).toFixed(1).padStart(5)}% | ${cov.toFixed(0)}%`,
  );
}

console.log('\nspot check:');
const iso = (t) => new Date(t).toISOString().slice(0, 10);
for (const t of ['CFXUSDT', 'WALUSDT', 'STRKUSDT', 'TIAUSDT', 'OPUSDT', 'ZECUSDT', 'XMRUSDT']) {
  const raw = snap.candles[t];
  if (!raw) continue;
  const bars = raw.map(([tt, o, h, l, c]) => ({ t: tt, o, h, l, c }));
  const cells = Object.entries(RULES).map(([k, fn]) => `${k.replace(/_/g, '')}=${fn(bars) == null ? '-' : fn(bars).toFixed(2)}`);
  console.log(`  ${t.padEnd(9)} ${cells.join('  ')}`);
}
