/**
 * Add the "convergence while holding" half of the user's rule:
 *   价格停在自己近期走势的高位  AND  在那里横向收敛（振幅逐级收窄）
 *
 * Candidates (all computed from the 90-bar decision window, no look-ahead):
 *   pos        : position of the last close inside the adaptive range (R4_hybrid rule)
 *   contraction: the 20-bar height is smaller than the 90-bar window height
 *                (i.e. it is coiling, not ranging as wide as its whole history)
 *   recentContraction: last 10-bar height / the 10-bar height right before it
 *
 * Combined scores:
 *   gate20  = pos >= 0.6 (soft) applied only where contraction holds -> rank by pos
 *   holdConv= pos * contraction (contraction = 1 - h20/h90, clipped to 0..1)
 *   holdTight = pos * (1 - h10/h20 clipped)
 *
 * Run: node .scratch/hold-convergence.mjs
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
const clamp01 = (x) => Math.min(1, Math.max(0, x));

function adaptivePosition(bars) {
  // R4_hybrid from window-rules.mjs, condensed: box-brace range, else last pivot, else 90-bar
  const n = bars.length;
  const posOf = (from) => {
    if (from == null || from < 0) return null;
    const w = bars.slice(from);
    if (w.length < 3) return null;
    const lo = Math.min(...w.map((b) => b.l));
    const hi = Math.max(...w.map((b) => b.h));
    return hi > lo ? (bars[n - 1].c - lo) / (hi - lo) : null;
  };
  // box-brace window
  let bb = null;
  for (let len = 5; len <= 30 && len <= n - 4; len++) {
    const s = n - len;
    const bh = height(bars.slice(s));
    let widest = 0;
    for (const look of [10, 20, 40]) {
      const from = Math.max(0, s - look);
      if (s - from < 3) continue;
      widest = Math.max(widest, height(bars.slice(from, s)));
    }
    if (widest > 0 && bh / widest <= 0.65) bb = posOf(s);
  }
  if (bb != null) return bb;
  for (let i = n - 2; i >= 5; i--) {
    const left = bars.slice(i - 5, i);
    const right = bars.slice(i + 1);
    if (!right.length) continue;
    const isHigh = bars[i].h >= Math.max(...left.map((b) => b.h)) && bars[i].h >= Math.max(...right.map((b) => b.h));
    const isLow = bars[i].l <= Math.min(...left.map((b) => b.l)) && bars[i].l <= Math.min(...right.map((b) => b.l));
    if (isHigh || isLow) return posOf(i);
  }
  return posOf(0);
}

const rows = [];
for (const { instrument, label } of labels) {
  const raw = snap.candles[instrument];
  if (!raw) continue;
  const bars = raw.map(([t, o, h, l, c]) => ({ t, o, h, l, c }));
  if (bars.length < 60) continue;
  const pos = adaptivePosition(bars);
  const h90 = height(bars.slice(-90));
  const h20 = height(bars.slice(-20));
  const h10 = height(bars.slice(-10));
  const h10pre = height(bars.slice(-20, -10));
  const contraction = h90 > 0 ? clamp01(1 - h20 / h90) : 0;
  const recentContraction = h20 > 0 ? clamp01(1 - h10 / h20) : 0;
  rows.push({
    instrument,
    y: label === 'Y' ? 1 : 0,
    pos,
    contraction,
    recentContraction,
    holdConv: pos * contraction,
    holdTight: pos * Math.min(recentContraction * 2, 1),
    tightOnly: Math.min(recentContraction * 2, 1),
    convOnly: contraction,
  });
}

const base = rows.reduce((a, r) => a + r.y, 0) / rows.length;
console.log(`rows ${rows.length}, Y ${rows.reduce((a, r) => a + r.y, 0)}, base ${(base * 100).toFixed(1)}%\n`);
console.log('metric         | top10% | top20% | top25% | bottom-quartile | corr');
for (const k of ['pos', 'contraction', 'recentContraction', 'tightOnly', 'convOnly', 'holdConv', 'holdTight']) {
  const vals = rows.filter((r) => r[k] != null);
  const sorted = [...vals].sort((a, b) => b[k] - a[k]);
  const hit = (f) => {
    const cut = sorted.slice(0, Math.max(1, Math.round(vals.length * f)));
    return (cut.reduce((a, r) => a + r.y, 0) / cut.length) * 100;
  };
  const bot = sorted.slice(-Math.round(vals.length * 0.25));
  const botHit = (bot.reduce((a, r) => a + r.y, 0) / bot.length) * 100;
  const xs = vals.map((r) => r[k]);
  const ys = vals.map((r) => r.y);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  const c = sxy / Math.sqrt(sxx * syy);
  console.log(`${k.padEnd(14)} | ${hit(0.1).toFixed(1).padStart(5)}% | ${hit(0.2).toFixed(1).padStart(5)}% | ${hit(0.25).toFixed(1).padStart(5)}% | ${botHit.toFixed(1).padStart(14)}% | ${c.toFixed(3)}`);
}

console.log('\nspot check (pos / holdConv):');
for (const t of ['CFXUSDT', 'WALUSDT', 'STRKUSDT', 'TIAUSDT', 'OPUSDT', 'ZECUSDT', 'XMRUSDT']) {
  const raw = snap.candles[t];
  if (!raw) continue;
  const bars = raw.map(([tt, o, h, l, c]) => ({ t: tt, o, h, l, c }));
  const pos = adaptivePosition(bars);
  const h90 = height(bars.slice(-90));
  const h20 = height(bars.slice(-20));
  const contraction = clamp01(1 - h20 / h90);
  console.log(`  ${t.padEnd(9)} pos=${pos.toFixed(2)} contraction=${contraction.toFixed(2)} holdConv=${(pos * contraction).toFixed(2)}`);
}
