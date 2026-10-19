/**
 * "Top-of-range EVENT" rule, self-relative (no fixed threshold, no shape, no
 * absolute width):
 *
 *   rank_t   = today's position inside its own recent-move range, ranked across
 *              the WHOLE pool of that day (topPct of the day's instruments)
 *   fresh_t  = the coin was NOT in that top band during the previous `cooldown`
 *              days (first time back at the top, not a standing one)
 *
 * Fire = fresh AND in the day's top `topPct`.
 *
 * Evaluation A (labels): the 285 hand labels were all taken on ONE day, so a
 * cross-sectional rank can be computed exactly on that day (snapshot 10/15).
 * Evaluation B (stretches): 33 user-marked good stretches — for each day of each
 * stretch, rank that day's candidates across EVERY instrument we have daily data
 * for (43-label instruments + spot-check set), and ask whether the marked coin
 * stays in the top band.
 *
 * Run: node .scratch/top-event.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const snap = JSON.parse(fs.readFileSync('tools/labeling/out/candles.json', 'utf8'));
const dailyFiles = fs.readdirSync('.scratch').filter((f) => /^daily-.+\.json$/.test(f));
const DAILY = new Map();
for (const f of dailyFiles) {
  const inst = f.replace(/^daily-/, '').replace(/\.json$/, '');
  DAILY.set(inst, JSON.parse(fs.readFileSync(path.join('.scratch', f), 'utf8')).map(([t, o, h, l, c]) => ({ t, o: +o, h: +h, l: +l, c: +c })));
}
const iso = (t) => new Date(t).toISOString().slice(0, 10);

/** Position of the last close inside the recent-move range (the best variant found). */
function position(bars) {
  const n = bars.length;
  if (n < 60) return null;
  const w = bars.slice(-60);
  let loIdx = 0;
  for (let i = 0; i < w.length; i++) if (w[i].l < w[loIdx].l) loIdx = i;
  return null; // placeholder, replaced below
}

/** "Retention": how much of the last UP leg the price kept (best performing measure). */
function retention(bars) {
  const w = bars.slice(-60);
  if (w.length < 40) return null;
  let loIdx = 0;
  for (let i = 0; i < w.length; i++) if (w[i].l < w[loIdx].l) loIdx = i;
  let hi = -Infinity;
  for (let i = loIdx; i < w.length; i++) if (w[i].h > hi) hi = w[i].h;
  if (!(hi > w[loIdx].l)) return null;
  return (bars[bars.length - 1].c - w[loIdx].l) / (hi - w[loIdx].l);
}

// ---------------------------------------------------------------- A. labels on the anchor day
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

// full pool positions on the anchor day (snapshot candles = 90 bars ending at anchor)
const pool = [];
for (const inst of Object.keys(snap.candles)) {
  const bars = snap.candles[inst].map(([t, o, h, l, c]) => ({ t, o, h, l, c }));
  const r = retention(bars);
  if (r != null) pool.push({ instrument: inst, r });
}
pool.sort((a, b) => b.r - a.r);
const rankOf = new Map(pool.map((p, i) => [p.instrument, i + 1]));
const N = pool.length;

const labelled = labels
  .map((l) => ({ ...l, y: l.label === 'Y' ? 1 : 0, r: pool.find((p) => p.instrument === l.instrument)?.r ?? null, rank: rankOf.get(l.instrument) ?? null }))
  .filter((l) => l.r != null);
const yTotal = labelled.reduce((a, l) => a + l.y, 0);
const base = yTotal / labelled.length;
console.log(`A. anchor-day cross-section: pool ${N}, labelled usable ${labelled.length}, Y ${yTotal}, base ${(base * 100).toFixed(1)}%\n`);

for (const pct of [0.02, 0.05, 0.1, 0.15, 0.2, 0.3]) {
  const cut = Math.max(1, Math.round(N * pct));
  const picked = labelled.filter((l) => l.rank <= cut);
  const yp = picked.reduce((a, l) => a + l.y, 0);
  console.log(
    `   top ${(pct * 100).toFixed(0).padStart(2)}% of the day (${cut} instruments): labelled hits ${String(yp).padStart(2)} of ${picked.length} labelled (precision ${((yp / Math.max(1, picked.length)) * 100).toFixed(1)}%), keeps ${((yp / yTotal) * 100).toFixed(0)}% of Y`,
  );
}

// ---------------------------------------------------------------- B. stretches, day by day
function poolOn(date) {
  const out = [];
  for (const [inst, bars] of DAILY) {
    const E = bars.findIndex((b) => iso(b.t) >= date);
    if (E < 40) continue;
    if (iso(bars[E].t) !== date) continue;
    const r = retention(bars.slice(0, E + 1));
    if (r != null) out.push({ instrument: inst, r });
  }
  return out.sort((a, b) => b.r - a.r);
}

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

function nextDate(d) {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

console.log(`\nB. ${STRETCHES.length} marked stretches, day-by-day cross-section (pool = ${DAILY.size} instruments with daily data)\n`);
for (const topPct of [0.05, 0.1, 0.2]) {
  let covered = 0;
  const misses = [];
  for (const s of STRETCHES) {
    const bars = DAILY.get(s.instrument);
    if (!bars) { misses.push(`${s.instrument}(nodata)`); continue; }
    let hit = false;
    for (let d = s.start; d <= nextDate(s.end); d = nextDate(d)) {
      const poolDay = poolOn(d);
      if (!poolDay.length) continue;
      const cut = Math.max(1, Math.round(poolDay.length * topPct));
      const rank = poolDay.findIndex((p) => p.instrument === s.instrument);
      if (rank >= 0 && rank < cut) { hit = true; break; }
    }
    if (hit) covered++;
    else misses.push(`${s.instrument} ${s.start}-${s.end}`);
  }
  console.log(`   top ${(topPct * 100).toFixed(0)}% band: ${covered}/${STRETCHES.length} stretches have at least one day inside the band`);
  if (topPct === 0.1) console.log('     misses: ' + misses.join(', '));
}

// fresh variant: fire only on the first day back in the band after `cooldown` days out
console.log('\nC. fresh-only variant (top 10% band, must not have been in the band the previous 3 days):');
function freshOn(inst, date, cutPct, cooldown) {
  const bars = DAILY.get(inst);
  if (!bars) return null;
  const out = [];
  const days = [];
  for (let k = cooldown; k >= 0; k--) {
    let d = date;
    for (let j = 0; j < k; j++) d = prevDate(d);
    days.push(d);
  }
  for (const d of days) {
    const poolDay = poolOn(d);
    const cut = Math.max(1, Math.round(poolDay.length * cutPct));
    const rank = poolDay.findIndex((p) => p.instrument === inst);
    out.push(rank >= 0 && rank < cut);
  }
  return out[0] && !out.slice(1).some(Boolean);
}
function prevDate(d) {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}
let freshCovered = 0;
const freshMisses = [];
for (const s of STRETCHES) {
  if (!DAILY.has(s.instrument)) { freshMisses.push(`${s.instrument}(nodata)`); continue; }
  let hit = false;
  for (let d = s.start; d <= nextDate(s.end); d = nextDate(d)) {
    if (freshOn(s.instrument, d, 0.1, 3)) { hit = true; break; }
  }
  if (hit) freshCovered++;
  else freshMisses.push(`${s.instrument} ${s.start}-${s.end}`);
}
console.log(`   ${freshCovered}/${STRETCHES.length} stretches covered`);
console.log('     misses: ' + freshMisses.join(', '));
