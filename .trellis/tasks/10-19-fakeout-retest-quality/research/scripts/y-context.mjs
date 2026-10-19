// Split the 36 Y labels by their retention value (from the 10/15 snapshot, last 60 bars)
// and by their 90-bar "pre-rally" context, to check the user's hypothesis:
// "big-move coins dominate; I prefer a coin that rallied FROM THE BOTTOM into a box top".
import fs from 'node:fs';

const snap = JSON.parse(fs.readFileSync('tools/labeling/out/candles.json', 'utf8'));
const labels = fs
  .readFileSync('.trellis/tasks/archive/2026-10/10-15-structure-fullness/research/labels-285.csv', 'utf8')
  .replace(/^\uFEFF/, '')
  .split(/\r?\n/)
  .filter(Boolean)
  .slice(1)
  .map((line) => {
    const c = line.split(',');
    return { inst: c[0], y: c[3] === 'Y' ? 1 : 0, reason: c[4] };
  });

function measures(raw) {
  const bars = raw.map(([t, o, h, l, c]) => ({ t, o, h, l, c }));
  const w = bars.slice(-60);
  if (w.length < 40) return null;
  let lo = 0;
  for (let i = 0; i < w.length; i++) if (w[i].l < w[lo].l) lo = i;
  let hi = -Infinity;
  for (let i = lo; i < w.length; i++) if (w[i].h > hi) hi = w[i].h;
  const close = bars[bars.length - 1].c;
  const r = (close - w[lo].l) / (hi - w[lo].l);
  const leg = (hi / w[lo].l - 1) * 100;
  // 90-bar context: was the current level HIGH in the 90-day range? (big move already happened)
  const w90 = bars.slice(-90);
  const hi90 = Math.max(...w90.map((b) => b.h));
  const lo90 = Math.min(...w90.map((b) => b.l));
  const pos90 = (close - lo90) / (hi90 - lo90);
  return { r, leg, pos90, offHigh: (1 - close / hi) * 100 };
}

const rows = [];
for (const l of labels) {
  const raw = snap.candles[l.inst];
  if (!raw) continue;
  const m = measures(raw);
  if (m) rows.push({ ...l, ...m });
}
const Y = rows.filter((r) => r.y);
console.log(`Y ${Y.length}\n`);

console.log('Y sorted by retention (how much of the last up-leg the price kept):');
for (const r of [...Y].sort((a, b) => b.r - a.r)) {
  console.log(
    `  ${r.inst.padEnd(13)} retention=${r.r.toFixed(2)}  leg=${r.leg.toFixed(0).padStart(4)}%  offHigh=${r.offHigh.toFixed(1).padStart(4)}%  pos90=${r.pos90.toFixed(2)}  reason=${r.reason || '-'}`,
  );
}

// The user's stated preference: " rallied from the bottom to a box top".
// Proxy: small leg (<=35%), high retention (>=0.6), and close near the leg high.
const preferred = Y.filter((r) => r.r >= 0.6 && r.leg <= 40);
console.log(`\nY matching "small leg (<=40%) yet still near its top (retention>=0.6)": ${preferred.length}/${Y.length}`);
console.log('  ' + preferred.map((r) => `${r.inst}(ret=${r.r.toFixed(2)},leg=${r.leg.toFixed(0)}%)`).join(', '));
const bigMove = Y.filter((r) => r.leg > 60);
console.log(`\nY on coins whose last 60d leg > 60% (the "already flew" case): ${bigMove.length}/${Y.length}`);
console.log('  ' + bigMove.map((r) => `${r.inst}(ret=${r.r.toFixed(2)},leg=${r.leg.toFixed(0)}%)`).join(', '));
