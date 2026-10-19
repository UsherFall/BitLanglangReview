/**
 * Cross-check the label analysis TWICE with the loader diagnostics of
 * `research/scripts/pool-deep.mjs` (tickers symbols ∩ real daily data) and with
 * the snapshot that produced the labels (tools/labeling/out/candles.json).
 *
 * Purpose: 12/18 stretch coverage and 35.7% precision both looked too good in the
 * 10/19 research record while the same computation on the fresh pool gives ~9%.
 * This script finds out WHY before anything is built on the numbers.
 *
 * Run: node <this>
 */
import fs from 'node:fs';
import path from 'node:path';

const parseCsv = (text) => {
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
};

// ---- 1. which 43-label instruments / stretches resolve at all?
const csv43 = parseCsv(fs.readFileSync('.trellis/tasks/10-18-box-brace-squeeze/research/labels-43-toppin.csv', 'utf8'));
const h43 = csv43[0];
const iInst = h43.indexOf('instrument');
const iLabel = h43.indexOf('label');
const iNote = h43.indexOf('note');
console.log('43-label header:', h43.join(' | '));
const rows43 = csv43.slice(1).filter((r) => r[iInst]);
console.log('43-labelled rows:', rows43.length, 'Y:', rows43.filter((r) => r[iLabel] === 'Y').length);
const withNote = rows43.filter((r) => (r[iNote] ?? '').trim() !== '');
console.log('rows with a note:', withNote.length);
const stretches = [];
for (const r of withNote) {
  for (const clause of String(r[iNote]).split(String.fromCharCode(0xff0c, 0x2c, 0xff1b, 0x3b, 0x3002))) {
    const ds = [...clause.matchAll(/(\d{1,2})-(\d{1,2})/g)].map((m) => `2026-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`);
    if (ds.length < 2 || ds[0] === ds[1]) continue;
    stretches.push({ instrument: r[iInst], start: ds[0], end: ds[1], label: r[iLabel], clause: clause.trim() });
  }
}
console.log('parsed stretches:', stretches.length);
const byInst = new Map();
for (const s of stretches) byInst.set(s.instrument, (byInst.get(s.instrument) ?? 0) + 1);
console.log('stretches per instrument:', [...byInst.entries()].map(([i, n]) => `${i}×${n}`).join(' '));

// ---- 2. snapshot (the data the labels were made from) vs what is in it
const snap = JSON.parse(fs.readFileSync('tools/labeling/out/candles.json', 'utf8'));
const snapInsts = new Set(Object.keys(snap.candles));
const noSnap = [...new Set(stretches.map((s) => s.instrument))].filter((i) => !snapInsts.has(i));
console.log('\nstretch instruments missing from the snapshot:', noSnap.length, noSnap.join(', '));
const snapRange = (inst) => {
  const b = snap.candles[inst];
  if (!b) return null;
  return [new Date(b[0][0]).toISOString().slice(0, 10), new Date(b[b.length - 1][0]).toISOString().slice(0, 10), b.length];
};
console.log('snapshot range for a few stretch names:');
for (const s of stretches.slice(0, 8)) console.log('  ', s.instrument, s.start, '~', s.end, '→', JSON.stringify(snapRange(s.instrument)));

// ---- 3. do the stretch DATE RANGES fall inside the snapshot at all?
let inside = 0, outside = 0;
for (const s of stretches) {
  const r = snapRange(s.instrument);
  if (!r) continue;
  if (s.start >= r[0] && s.end <= r[1]) inside++;
  else outside++;
}
console.log(`stretches inside the snapshot range: ${inside}, outside: ${outside}`);

// ---- 4. the stretch instrument's label in the CSV
console.log('\nstretch rows with label:');
for (const s of stretches.slice(0, 25)) {
  const row = rows43.find((r) => r[iInst] === s.instrument);
  console.log(`  ${s.instrument} label=${s.label} (${row?.[iLabel]}) ${s.start}~${s.end}  "${s.clause}"`);
}
void path;
