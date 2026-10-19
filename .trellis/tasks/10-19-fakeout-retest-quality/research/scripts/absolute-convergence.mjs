/**
 * What "absolute convergence" actually means on the 285 labels.
 *
 * The user says some Y were "收在一个小区间里" (small range), others (ZEC) were a
 * big triangle. So the test is: does the *absolute* tightness of the recent band
 * separate Y from N — and does it still separate once the price is held high?
 *
 * Measures (90-bar decision window, no look-ahead):
 *   band10/20/30 = (max high - min low) / last close over the last 10/20/30 bars
 *   bandVs90     = band20 / (90-bar range)
 *   volRatio20   = median bar range (high-low)/close over last 20 bars
 *   tightAbs     = band10 (absolute tightness, smaller = tighter)
 *
 * Report: quartile Y-rate by each measure, and the cross with `pos` (adaptive
 * range position) at 0.6.
 *
 * Run: node .scratch/absolute-convergence.mjs
 */
import fs from 'node:fs';

const snap = JSON.parse(fs.readFileSync('tools/labeling/out/candles.json', 'utf8'));
const labelsPath = '.trellis/tasks/archive/2026-10/10-15-structure-fullness/research/labels-285.csv';
const labelsCsv = fs.readFileSync(labelsPath, 'utf8').replace(/^\uFEFF/, '');
const notePath43 = '.trellis/tasks/10-18-box-brace-squeeze/research/labels-43-toppin.csv';

const labels = labelsCsv
  .split(/\r?\n/)
  .filter(Boolean)
  .slice(1)
  .map((line) => {
    const [instrument, , , label] = line.split(',');
    return { instrument, label };
  });

// user-visible "收敛带" remarks from the 43 csv (pull the date ranges out of the notes)
const notes43 = fs
  .readFileSync(notePath43, 'utf8')
  .split(/\r?\n/)
  .filter(Boolean)
  .slice(1)
  .map((line) => {
    const cols = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? [];
    const clean = cols.map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'));
    return { instrument: clean[0], label: clean[3], note: clean[5] };
  })
  .filter((r) => r.instrument);

const height = (bars) => Math.max(...bars.map((b) => b.h)) - Math.min(...bars.map((b) => b.l));
const bandPct = (bars, len) => {
  const w = bars.slice(-len);
  return (height(w) / bars[bars.length - 1].c) * 100;
};

function adaptivePosition(bars) {
  const n = bars.length;
  const posOf = (from) => {
    if (from == null || from < 0) return null;
    const w = bars.slice(from);
    if (w.length < 3) return null;
    const lo = Math.min(...w.map((b) => b.l));
    const hi = Math.max(...w.map((b) => b.h));
    return hi > lo ? (bars[n - 1].c - lo) / (hi - lo) : null;
  };
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
  rows.push({
    instrument,
    y: label === 'Y' ? 1 : 0,
    pos: adaptivePosition(bars),
    band10: bandPct(bars, 10),
    band20: bandPct(bars, 20),
    band30: bandPct(bars, 30),
    bandVs90: bandPct(bars, 20) / (bandPct(bars, 90) || 1),
  });
}

const base = rows.reduce((a, r) => a + r.y, 0) / rows.length;
console.log(`rows ${rows.length}, Y ${rows.reduce((a, r) => a + r.y, 0)}, base ${(base * 100).toFixed(1)}%\n`);

for (const k of ['band10', 'band20', 'band30', 'bandVs90']) {
  const s = [...rows].sort((a, b) => a[k] - b[k]); // tighter (smaller) first
  const q = Math.floor(s.length / 4);
  const rates = [];
  for (let i = 0; i < 4; i++) {
    const part = s.slice(i * q, i === 3 ? s.length : (i + 1) * q);
    rates.push(((part.reduce((a, r) => a + r.y, 0) / part.length) * 100).toFixed(1));
  }
  console.log(`${k.padEnd(9)} quartiles (tightest→widest) Y-rate: ${rates.join(' / ')}  <- monotone if decreasing`);
}

// Cross with position: among "held high" (pos >= 0.6), does tightness help?
const held = rows.filter((r) => r.pos != null && r.pos >= 0.6);
const notHeld = rows.filter((r) => r.pos != null && r.pos < 0.6);
console.log(`\npos>=0.6: ${held.length} rows, Y ${held.reduce((a, r) => a + r.y, 0)} (${((held.reduce((a, r) => a + r.y, 0) / held.length) * 100).toFixed(1)}%)`);
console.log(`pos< 0.6: ${notHeld.length} rows, Y ${notHeld.reduce((a, r) => a + r.y, 0)} (${((notHeld.reduce((a, r) => a + r.y, 0) / notHeld.length) * 100).toFixed(1)}%)`);
for (const k of ['band10', 'band20', 'bandVs90']) {
  const s = [...held].sort((a, b) => a[k] - b[k]);
  const half = Math.floor(s.length / 2);
  const tight = s.slice(0, half), wide = s.slice(half);
  console.log(
    `  among held, ${k}: tighter half Y-rate ${((tight.reduce((a, r) => a + r.y, 0) / tight.length) * 100).toFixed(1)}% (n=${tight.length}) vs wider half ${((wide.reduce((a, r) => a + r.y, 0) / wide.length) * 100).toFixed(1)}% (n=${wide.length})`,
  );
}

// The 43 set: notes often say "收敛"/"横盘" — show the band widths of those at the note's latest date is not
// available (snapshot is at anchor). Instead show what the 12 replay "good stretches" look like.
console.log('\n12 replay good stretches — band width at their scan day (from snapshot 90 bars):');
const REPLAY = [
  ['STRKUSDT', '2026-09-30'], ['TIAUSDT', '2026-10-07'], ['BEAMUSDT', '2026-10-02'], ['BATUSDT', '2026-10-02'],
  ['AXLUSDT', '2026-10-07'], ['XMRUSDT', '2026-08-20'], ['XMRUSDT', '2026-08-13'], ['OPGUSDT', '2026-10-06'],
  ['OPUSDT', '2026-09-15'], ['ZECUSDT', '2026-08-16'], ['ZECUSDT', '2026-08-31'], ['WALUSDT', '2026-10-13'],
];
const iso = (t) => new Date(t).toISOString().slice(0, 10);
for (const [inst, date] of REPLAY) {
  const raw = snap.candles[inst];
  if (!raw) continue;
  const all = raw.map(([t, o, h, l, c]) => ({ t, o, h, l, c }));
  const E = all.findIndex((b) => iso(b.t) >= date);
  if (E < 0) continue;
  const bars = all.slice(0, E + 1);
  if (bars.length < 40) continue;
  console.log(`  ${inst.padEnd(9)} @${date}  band10=${bandPct(bars, 10).toFixed(1)}% band20=${bandPct(bars, 20).toFixed(1)}% vs90=${(bandPct(bars, 20) / bandPct(bars, 90)).toFixed(2)}`);
}
