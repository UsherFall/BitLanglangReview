/**
 * Full-pool replay of the candidate rule on ~842 Bitget USDT-perp dailies.
 *
 * Rule: rank every instrument's `retention` (how much of its last up-leg the
 * price kept) across the WHOLE pool of that day, keep the top X%.
 *
 * Evaluated with three ground-truth sets:
 *   A. the 285-label anchor day (snapshots at 10/15) — cross-section only
 *   B. the 33 stretches parsed from the 43-label notes — day by day, real pool
 *   C. false-positive load: how many instruments each day the top-X% band holds
 *
 * Also: the user's concern — do big-move coins dominate? Split the band by the
 * size of the captured up-leg (legPct) to show the mix.
 *
 * Run: node .scratch/pool-replay.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const POOL_DIR = process.env.POOL_DIR ?? '.scratch/pool';
const iso = (t) => new Date(t).toISOString().slice(0, 10);

const bars = new Map();
for (const f of fs.readdirSync(POOL_DIR)) {
  if (!f.endsWith('.json')) continue;
  const inst = f.replace(/\.json$/, '');
  const raw = JSON.parse(fs.readFileSync(path.join(POOL_DIR, f), 'utf8'));
  if (raw.length < 80) continue;
  bars.set(inst, raw.map(([t, o, h, l, c]) => ({ t, o, h, l, c })));
}
console.log(`pool ${bars.size} instruments with >=80 daily bars`);

/** Retention of the last up-leg + the size of that leg. */
function retention(barsArr, E, look = 60) {
  const w = barsArr.slice(Math.max(0, E - look + 1), E + 1);
  if (w.length < 40) return null;
  let loIdx = 0;
  for (let i = 0; i < w.length; i++) if (w[i].l < w[loIdx].l) loIdx = i;
  let hi = -Infinity, hiIdx = loIdx;
  for (let i = loIdx; i < w.length; i++) if (w[i].h > hi) { hi = w[i].h; hiIdx = i; }
  if (!(hi > w[loIdx].l)) return null;
  const close = barsArr[E].c;
  return {
    r: (close - w[loIdx].l) / (hi - w[loIdx].l),
    legPct: (hi / w[loIdx].l - 1) * 100,
    offHigh: (1 - close / hi) * 100,
    legBars: w.length - loIdx,
  };
}

// one pass over every instrument → per-date records
const byDate = new Map();
for (const [inst, arr] of bars) {
  for (let E = 40; E < arr.length; E++) {
    const m = retention(arr, E);
    if (!m) continue;
    const d = iso(arr[E].t);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push({ inst, ...m });
  }
}
for (const list of byDate.values()) list.sort((a, b) => b.r - a.r);
const dates = [...byDate.keys()].sort();
console.log(`dates ${dates[0]} .. ${dates[dates.length - 1]} (${dates.length})`);

function bandOf(date, pct) {
  const list = byDate.get(date) ?? [];
  const cut = Math.max(1, Math.round(list.length * pct));
  return list.slice(0, cut);
}
function rankOf(inst, date) {
  const list = byDate.get(date) ?? [];
  return list.findIndex((x) => x.inst === inst);
}

// ---------------------------------------------------------------- C. load + mix
console.log('\nC. daily band size and the mix of leg sizes (the band, per day):');
for (const pct of [0.02, 0.05, 0.1, 0.2]) {
  let n = 0, bigMove = 0, smallMove = 0, days = 0;
  for (const d of dates.slice(-120)) {
    const band = bandOf(d, pct);
    if (!band.length) continue;
    days++;
    n += band.length;
    for (const b of band) (b.legPct >= 50 ? bigMove++ : smallMove++);
  }
  console.log(
    `   top ${(pct * 100).toFixed(0).padStart(2)}%: avg ${(n / days).toFixed(1)} names/day; of them leg>=50% ${((bigMove / Math.max(1, n)) * 100).toFixed(0)}%, leg<50% ${((smallMove / Math.max(1, n)) * 100).toFixed(0)}%`,
  );
}

// ---------------------------------------------------------------- A. anchor day labels
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
// The snapshot's last bar is 10-13; use that date.
const ANCHOR = '2026-10-13';
const poolDay = byDate.get(ANCHOR) ?? [];
const labelled = labels
  .map((l) => ({ ...l, y: l.label === 'Y' ? 1 : 0, rank: rankOf(l.instrument, ANCHOR) }))
  .filter((l) => l.rank >= 0);
const yTotal = labelled.reduce((a, l) => a + l.y, 0);
console.log(`\nA. anchor ${ANCHOR}: pool ${poolDay.length}, labelled in pool ${labelled.length}, Y ${yTotal}, base ${((yTotal / labelled.length) * 100).toFixed(1)}%`);
for (const pct of [0.02, 0.05, 0.1, 0.15, 0.2, 0.3]) {
  const cut = Math.max(1, Math.round(poolDay.length * pct));
  const picked = labelled.filter((l) => l.rank < cut);
  const yp = picked.reduce((a, l) => a + l.y, 0);
  console.log(
    `   top ${(pct * 100).toFixed(0).padStart(2)}% (${cut} names): ${String(yp).padStart(2)} Y of ${String(picked.length).padStart(2)} labelled → precision ${((yp / Math.max(1, picked.length)) * 100).toFixed(1)}%, keeps ${((yp / yTotal) * 100).toFixed(0)}% of Y`,
  );
}

// ---------------------------------------------------------------- B. stretches, real pool
function parseCsv(text) {
  const rows = [];
  let cell = '', row = [], quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.replace(/^\uFEFF/, '')));
}
const csv = parseCsv(fs.readFileSync('.trellis/tasks/10-18-box-brace-squeeze/research/labels-43-toppin.csv', 'utf8'));
const header = csv[0];
const iInst = header.indexOf('instrument');
const iNote = header.indexOf('note');
const dateRe = /(\d{1,2})-(\d{1,2})/g;
const STRETCHES = [];
for (const r of csv.slice(1)) {
  const note = r[iNote] ?? '';
  for (const clause of note.split(/[，,；;。]/)) {
    const ds = [...clause.matchAll(dateRe)].map((m) => `2026-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`);
    if (ds.length < 2 || ds[0] === ds[1]) continue;
    STRETCHES.push({ instrument: r[iInst], start: ds[0], end: ds[1] });
  }
}
const next = (d) => {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
};
console.log(`\nB. ${STRETCHES.length} marked stretches, real pool, day by day:`);
for (const pct of [0.02, 0.05, 0.1, 0.2]) {
  let covered = 0;
  const misses = [];
  for (const s of STRETCHES) {
    if (!bars.has(s.instrument)) { misses.push(`${s.instrument}(nodata)`); continue; }
    let hit = false;
    for (let d = s.start; d <= next(s.end); d = next(d)) {
      const cut = Math.max(1, Math.round((byDate.get(d)?.length ?? 0) * pct));
      const rk = rankOf(s.instrument, d);
      if (rk >= 0 && rk < cut) { hit = true; break; }
    }
    if (hit) covered++;
    else misses.push(`${s.instrument} ${s.start}~${s.end}`);
  }
  console.log(`   top ${(pct * 100).toFixed(0).padStart(2)}%: ${covered}/${STRETCHES.length}`);
  if (pct === 0.1) console.log(`      misses: ${misses.join(', ')}`);
}
