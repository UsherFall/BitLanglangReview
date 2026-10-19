/**
 * Candidate window rule (user-chosen 2026-10-19):
 *   The range = highs/lows AFTER the most recent "放量长阳/长阴" bar.
 *   Position = where the latest close sits inside that range (0 = low, 1 = high).
 *   "长" = body >= k x the median body of the previous 20 bars.
 *   "放量" = volume >= v x the median volume of the previous 20 bars (when volume exists).
 *
 * Evaluated on the 285 hand labels (snapshot anchor 10/15, 90-bar window).
 * Volume comes from snap.volume[inst] when present (parallel array to candles).
 *
 * Run: node .scratch/long-bar-window.mjs
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

/** Index of the most recent long (and optionally heavy) bar, or -1. */
function lastLongBar(bars, vol, { bodyK, volK, lookback = 20, minIdx = 0 }) {
  for (let i = bars.length - 2; i >= Math.max(minIdx, 2); i--) {
    const b = bars[i];
    const body = Math.abs(b.c - b.o);
    const prev = bars.slice(Math.max(0, i - lookback), i);
    const medBody = median(prev.map((x) => Math.abs(x.c - x.o)));
    if (!(medBody > 0)) continue;
    if (body < bodyK * medBody) continue;
    if (volK > 0 && vol) {
      const medVol = median(prev.map((x) => vol[bars.indexOf(x)] ?? 0).filter((v) => v > 0));
      const v = vol[i] ?? 0;
      if (!(medVol > 0) || v < volK * medVol) continue;
    }
    return i;
  }
  return -1;
}

function positionAfter(bars, idx) {
  if (idx < 0) return null;
  const w = bars.slice(idx);
  if (w.length < 3) return null;
  const hi = Math.max(...w.map((b) => b.h));
  const lo = Math.min(...w.map((b) => b.l));
  if (!(hi > lo)) return null;
  return { pos: (bars[bars.length - 1].c - lo) / (hi - lo), bars: w.length, hi, lo };
}

const CONFIGS = [
  { bodyK: 1.5, volK: 0 },
  { bodyK: 2.0, volK: 0 },
  { bodyK: 2.5, volK: 0 },
  { bodyK: 2.0, volK: 2.0 },
  { bodyK: 3.0, volK: 2.0 },
];

function evaluate(rows) {
  const base = rows.reduce((a, r) => a + r.y, 0) / rows.length;
  const vals = rows.filter((r) => r.pos !== null);
  const missing = rows.length - vals.length;
  const sorted = [...vals].sort((a, b) => b.pos - a.pos);
  const hit = (f) => {
    const cut = sorted.slice(0, Math.max(1, Math.round(vals.length * f)));
    return ((cut.reduce((a, r) => a + r.y, 0) / cut.length) * 100).toFixed(1);
  };
  const cov = (vals.reduce((a, r) => a + r.y, 0) / Math.max(1, rows.reduce((a, r) => a + r.y, 0))) * 100;
  return { base: (base * 100).toFixed(1), n: vals.length, missing, top10: hit(0.1), top20: hit(0.2), top25: hit(0.25), cov: cov.toFixed(0) };
}

const volMap = snap.volume ?? {};
const byConfig = new Map();
for (const cfg of CONFIGS) {
  const rows = [];
  for (const { instrument, label } of labels) {
    const raw = snap.candles[instrument];
    if (!raw) continue;
    const bars = raw.map(([t, o, h, l, c]) => ({ t, o, h, l, c }));
    if (bars.length < 60) continue;
    const idx = lastLongBar(bars, volMap[instrument] ?? null, cfg);
    const p = positionAfter(bars, idx);
    rows.push({ instrument, y: label === 'Y' ? 1 : 0, pos: p ? p.pos : null, longAgo: p ? p.bars : null });
  }
  byConfig.set(`body≥${cfg.bodyK}x${cfg.volK ? ` 量≥${cfg.volK}x` : ''}`, evaluate(rows));
}

console.log('window rule: range AFTER the most recent long(-and-heavy) bar\n');
console.log('config                    | usable | no-long-bar | base  | top10% | top20% | top25% | Y coverage in usable');
for (const [k, v] of byConfig) {
  console.log(
    `${k.padEnd(25)} | ${String(v.n).padStart(6)} | ${String(v.missing).padStart(11)} | ${v.base.padStart(5)}% | ${v.top10.padStart(5)}% | ${v.top20.padStart(5)}% | ${v.top25.padStart(5)}% | ${v.cov}%`,
  );
}

// CFX / WAL spot check under the default config
console.log('\nspot check (body>=2x, no volume):');
for (const t of ['CFXUSDT', 'WALUSDT', 'STRKUSDT', 'TIAUSDT', 'OPUSDT', 'ZECUSDT']) {
  const raw = snap.candles[t];
  if (!raw) continue;
  const bars = raw.map(([tt, o, h, l, c]) => ({ t: tt, o, h, l, c }));
  const idx = lastLongBar(bars, volMap[t] ?? null, { bodyK: 2, volK: 0 });
  const p = positionAfter(bars, idx);
  const iso = (x) => new Date(x).toISOString().slice(0, 10);
  console.log(
    `  ${t.padEnd(9)} last long bar ${idx >= 0 ? iso(bars[idx].t) : '-'}  range ${p ? `${p.lo} - ${p.hi}` : '-'}  pos ${p ? p.pos.toFixed(2) : '-'}  (${p ? p.bars : 0} bars after)`,
  );
}
