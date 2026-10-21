/**
 * Parse the 43-label notes (10-18) into concrete "good stretches", then test:
 *   For every candidate day E in history (look-ahead free), does a rule fire on E
 *   and would it land inside a user-marked stretch?
 *
 * Two rules compared:
 *   shrink  : shipped-style "recent band is quieter than same-length before"
 *   tight20 : recent 20 bars are TIGHT relative to price (absolute, <= x%) AND
 *             the band is flat-ish (net move over the band is small)
 *
 * Ground truth = the 25 "good stretch" date ranges in the notes:
 *   a stretch [start..end] means the opportunity appears somewhere in it; the
 *   fire must be inside start..end (allowing end+1 as the breakout day).
 *
 * Run: node .scratch/stretch-detect.mjs
 */
import fs from 'node:fs';

const NOTE_CSV = '.trellis/tasks/10-18-box-brace-squeeze/research/labels-43-toppin.csv';

// ------------------------------------------------------------------ parse csv (quoted, notes contain '，')
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
  return rows;
}

const csv = parseCsv(fs.readFileSync(NOTE_CSV, 'utf8')).map((r) => r.map((c) => c.replace(/^\uFEFF/, '')));
const header = csv[0];
const iInst = header.indexOf('instrument');
const iNote = header.indexOf('note');
const dateRe = /(\d{1,2})-(\d{1,2})/g;

const STRETCHES = [];
for (const r of csv.slice(1)) {
  const note = r[iNote] ?? '';
  for (const clause of note.split(/[，,；;。]/)) {
    const ds = [...clause.matchAll(dateRe)].map((m) => `2026-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`);
    if (!ds.length) continue;
    const start = ds[0];
    const end = ds.length >= 2 ? ds[1] : null;
    if (start === end) continue;
    STRETCHES.push({ instrument: r[iInst], start, end, clause: clause.trim() });
  }
}
console.log(`parsed ${STRETCHES.length} stretches from notes\n`);

// ------------------------------------------------------------------ data
const DAILY = (inst) => {
  const file = `.scratch/daily-${inst}.json`;
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8')).map(([t, o, h, l, c]) => ({ t, o: +o, h: +h, l: +l, c: +c }));
};
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const height = (bars) => Math.max(...bars.map((b) => b.h)) - Math.min(...bars.map((b) => b.l));
const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);

function firesShrink(bars, E) {
  const minRun = 5, ratio = 0.9;
  const vol = bars.map((b) => (b.h - b.l) / b.l);
  const last = E, price = bars[last].c;
  for (let start = last - minRun + 1; start >= 0; start--) {
    const runLen = last - start + 1, pre = start - runLen;
    if (pre < 0) continue;
    const runMed = median(vol.slice(start, last + 1));
    const preMed = median(vol.slice(pre, start));
    if (!(preMed > 0)) continue;
    if (runMed >= ratio * preMed) continue;
    const conf = bars.slice(start, last);
    const lo = Math.min(...conf.map((b) => b.l)), hi = Math.max(...conf.map((b) => b.h));
    const tol = 0.1 * (hi - lo);
    if (price < lo - tol || price > hi + tol) continue;
    return true;
  }
  return false;
}

function firesTight(bars, E, opts) {
  const { len = 20, maxWidthPct = 25, maxNetPct = 8 } = opts;
  if (E + 1 < len + 10) return false;
  const seg = bars.slice(E - len + 1, E + 1);
  const price = seg[seg.length - 1].c;
  const width = (height(seg) / price) * 100;
  if (width > maxWidthPct) return false;
  const net = (Math.abs(seg[seg.length - 1].c - seg[0].o) / seg[0].o) * 100;
  return net <= maxNetPct;
}

// ------------------------------------------------------------------ evaluate
function inStretch(inst, date, stretches) {
  return stretches.some((s) => s.instrument === inst && date >= s.start && (!s.end || date <= s.end || date === nextDay(s.end)));
}
const nextDay = (d) => {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
};

const RULES = {
  shrink: (bars, E) => firesShrink(bars, E),
  'tight20/25%': (bars, E) => firesTight(bars, E, { len: 20, maxWidthPct: 25, maxNetPct: 8 }),
  'tight20/15%': (bars, E) => firesTight(bars, E, { len: 20, maxWidthPct: 15, maxNetPct: 8 }),
  'tight30/25%': (bars, E) => firesTight(bars, E, { len: 30, maxWidthPct: 25, maxNetPct: 10 }),
};

for (const [name, rule] of Object.entries(RULES)) {
  let covered = 0;
  const perStretch = [];
  for (const s of STRETCHES) {
    const bars = DAILY(s.instrument);
    if (!bars) { perStretch.push(`${s.instrument} ${s.start}: NO DATA`); continue; }
    const startIdx = bars.findIndex((b) => iso(b.t) >= s.start);
    const endIdx = s.end ? bars.findIndex((b) => iso(b.t) > s.end) : bars.findIndex((b) => iso(b.t) > '2026-10-10');
    let hit = false;
    for (let E = Math.max(40, startIdx); E < (endIdx < 0 ? bars.length - 1 : endIdx); E++) {
      if (rule(bars, E)) { hit = true; break; }
    }
    if (hit) covered++;
    perStretch.push(`${s.instrument} ${s.start}-${s.end ?? '…'}: ${hit ? 'HIT' : 'miss'}`);
  }
  console.log(`${name.padEnd(14)} covered ${covered}/${STRETCHES.length}`);
  for (const line of perStretch) console.log('   ' + line);
  console.log('');
}
