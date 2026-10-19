/**
 * Candidate replacements for the current rule
 *   "score = how much quieter the recent band is than the SAME-LENGTH stretch before it"
 * tested on the 285 hand labels (Y/N) at the 10/15 snapshot anchor.
 *
 * Each candidate measure is computed from the 90-bar decision window ONLY
 * (no look-ahead beyond the anchor day), and is ranked high-is-better.
 *
 *   silence    existing score: 1 - runMed/preMed (best band search) — the baseline
 *   trendHold  "trend value kept": last close's position inside the 90-bar range,
 *              adjusted for where the price CAME FROM (pos90)
 *   driftEff   net displacement / total travel over the last 20 bars (trend quality;
 *              a convergence has low efficiency, a trending leg has high efficiency)
 *   newLow     last 10 closes still making new lows (count)
 *   pullback   how far the last close sits below the 90-bar high (relative)
 *   quietAfter box-brace style: recent 20-bar height / widest 20-bar height in
 *              the 90-bar window (high = tightly packed inside its own range)
 *   structure  a composite candidate: pos90 x (1 - newLowShare)
 *
 * Run: node .scratch/silence-replacement.mjs
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
function edgeDrift(prices) {
  const n = prices.length;
  if (n < 2) return 0;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += prices[i]; sxy += i * prices[i]; sxx += i * i; }
  const d = n * sxx - sx * sx;
  if (!d) return 0;
  const slope = (n * sxy - sx * sy) / d;
  const mean = sy / n;
  if (!mean) return 0;
  return (Math.abs(slope) * (n - 1)) / mean;
}

/** The shipped detectConvergence score (best-band shrink depth). */
function silenceScore(bars) {
  const minRun = 5, convRatio = 0.9, tight = 0.6, flatRatio = 2.0;
  const vol = bars.map((b) => (b.h - b.l) / b.l);
  const last = bars.length - 1, lastClose = bars[last].c;
  let best = null;
  for (let start = last - minRun + 1; start >= 0; start--) {
    const runLen = last - start + 1, preStart = start - runLen;
    if (preStart < 0) continue;
    const band = bars.slice(start);
    const runMed = median(vol.slice(start));
    if (Math.max(edgeDrift(band.map((b) => b.l)), edgeDrift(band.map((b) => b.h))) > flatRatio * runMed) continue;
    const preMed = median(vol.slice(preStart, start));
    const floor = Math.max(tight, 0.85), span = 25;
    const prog = Math.min(Math.max((runLen - 5) / span, 0), 1);
    if (runMed >= Math.min(convRatio, floor + (convRatio - floor) * prog) * preMed) continue;
    const conf = band.slice(0, -1);
    const lo = Math.min(...conf.map((b) => b.l)), hi = Math.max(...conf.map((b) => b.h));
    const tol = 0.1 * (hi - lo);
    if (lastClose < lo - tol || lastClose > hi + tol) continue;
    const score = Math.min(1, Math.max(0, 1 - runMed / preMed));
    if (!best || score > best.score) best = { score };
  }
  return best ? best.score : 0;
}

function measures(bars) {
  const n = bars.length;
  const win = bars.slice(Math.max(0, n - 90));
  const hi90 = Math.max(...win.map((b) => b.h));
  const lo90 = Math.min(...win.map((b) => b.l));
  const last = bars[n - 1].c;
  const pos90 = hi90 > lo90 ? (last - lo90) / (hi90 - lo90) : 0.5;

  // trend quality over the last 20 bars
  const t20 = bars.slice(-20);
  const net = Math.abs(t20[t20.length - 1].c - t20[0].o);
  const travel = t20.reduce((a, b) => a + Math.abs(b.c - b.o), 0);
  const driftEff = travel > 0 ? net / travel : 0;

  // new-low share in the last 10 bars (a band that is still falling keeps making lows)
  const l10 = bars.slice(-10);
  let newLows = 0;
  for (let i = 1; i < l10.length; i++) {
    if (l10[i].c < Math.min(...l10.slice(0, i).map((b) => b.c))) newLows += 1;
  }
  const newLowShare = newLows / Math.max(1, l10.length - 1);

  // how far below the 90-bar high the last close sits
  const pullback = hi90 > 0 ? 1 - last / hi90 : 0;

  // recent 20-bar height vs the widest 20-bar height anywhere in the 90-bar window
  const h20 = Math.max(...bars.slice(-20).map((b) => b.h)) - Math.min(...bars.slice(-20).map((b) => b.l));
  let widest = 0;
  for (let i = 0; i + 20 <= win.length; i++) {
    const s = win.slice(i, i + 20);
    const h = Math.max(...s.map((b) => b.h)) - Math.min(...s.map((b) => b.l));
    if (h > widest) widest = h;
  }
  const quietAfter = widest > 0 ? 1 - h20 / widest : 0;

  return {
    silence: silenceScore(bars),
    pos90,
    driftEff,
    newLow: newLowShare,
    pullback: -pullback, // low is good → negate so "high is better" everywhere
    quietAfter,
    structure: pos90 * (1 - newLowShare),
  };
}

// ---------------------------------------------------------------- evaluate
const rows = [];
for (const { instrument, label } of labels) {
  const raw = snap.candles[instrument];
  if (!raw) continue;
  const bars = raw.map(([t, o, h, l, c]) => ({ t, o, h, l, c }));
  if (bars.length < 60) continue;
  rows.push({ instrument, y: label === 'Y' ? 1 : 0, ...measures(bars) });
}
const base = rows.reduce((a, r) => a + r.y, 0) / rows.length;
console.log(`rows ${rows.length}, Y ${rows.reduce((a, r) => a + r.y, 0)}, base ${(base * 100).toFixed(1)}%`);

const keys = Object.keys(rows[0]).filter((k) => k !== 'instrument' && k !== 'y');
const quantile = (arr, q) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
console.log('\nmetric        q25..q75 of Y/N   | top10% Y | top20% Y | top25% Y | bottom-quartile Y  (hit@K uses the metric; bigger=better)');
for (const k of keys) {
  const vals = rows.map((r) => r[k]);
  const good = rows.filter((r) => r.y).map((r) => r[k]);
  const bad = rows.filter((r) => !r.y).map((r) => r[k]);
  const sorted = [...rows].sort((a, b) => b[k] - a[k]);
  const hitAt = (f) => {
    const cut = sorted.slice(0, Math.max(1, Math.round(rows.length * f)));
    return (cut.reduce((a, r) => a + r.y, 0) / cut.length) * 100;
  };
  const bottom = sorted.slice(-Math.round(rows.length * 0.25));
  const bottomHit = (bottom.reduce((a, r) => a + r.y, 0) / bottom.length) * 100;
  console.log(
    `${k.padEnd(12)} Y[${quantile(good, 0.25).toFixed(2)},${quantile(good, 0.75).toFixed(2)}] N[${quantile(bad, 0.25).toFixed(2)},${quantile(bad, 0.75).toFixed(2)}] | ${hitAt(0.1).toFixed(1).padStart(6)}% | ${hitAt(0.2).toFixed(1).padStart(6)}% | ${hitAt(0.25).toFixed(1).padStart(6)}% | ${bottomHit.toFixed(1).padStart(5)}%`,
  );
}

// correlation of each metric with the label (point-biserial)
function corr(xs, ys) {
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
}
console.log('\ncorrelation with label (Y=1):');
for (const k of keys) console.log(`  ${k.padEnd(12)} ${corr(rows.map((r) => r[k]), rows.map((r) => r.y)).toFixed(3)}`);
