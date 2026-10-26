/**
 * Read the exported toppin labels and parse the notes into SEGMENTS.
 *
 * The user's notes carry two verdicts in one cell:
 *   - the overall Y / N for "can I trade this NOW"
 *   - one or more dated stretches described as "good" ("9-25到10-1的收敛很好"),
 *     which is the signal that actually matters here.
 * This script extracts both and prints a table; it changes nothing.
 *
 *   npx tsx .scratch\parse-labels.ts
 */
import fs from 'node:fs';

const CSV = 'C:\\Users\\Fuzz\\Downloads\\labels-1792037040000 (1).csv';

type Row = { instrument: string; label: string; note: string; labeledAt: string };

/** Minimal RFC4180 reader (the note column contains commas). */
function parseCsv(text: string): Row[] {
  const src = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((c) => c !== '')) rows.push(row); }
  const head = rows[0];
  return rows.slice(1).map((cells) => {
    const rec: any = {};
    head.forEach((key, k) => { rec[key] = cells[k] ?? ''; });
    return { instrument: rec.instrument, label: rec.label, note: rec.note, labeledAt: rec.labeledAt };
  });
}

/** "9-25到10-1", "8-28到9-1", "5-20到8-17" … */
const RANGE = /(\d{1,2})[-/.](\d{1,2})\s*(?:到|~|－|-|—|至)\s*(\d{1,2})[-/.](\d{1,2})/g;
/** "9-29往后", "8-31后", "9-4后面", "8-19后面" … (open-ended stretch) */
const OPEN_ENDED = /(\d{1,2})[-/.](\d{1,2})\s*(?:往后|以后|之后|后面|后)/g;
/** A good/bad cue next to a mention. */
const GOOD_CUE = /(好|可以看|可以|机会|关注|能扫|扫出来|还行|不错)/;
const BAD_CUE = /(不好|做不了|看不懂|不够好|没给出|一直假突破)/;

type Seg = { kind: 'range' | 'open'; start: string; end: string | null; good: boolean; context: string };

function segmentsOf(note: string): Seg[] {
  const segs: Seg[] = [];
  // Split the note into clauses so the cue is read next to its own range.
  const clauses = note.split(/[，。；、,;]/).map((c) => c.trim()).filter(Boolean);
  for (const clause of clauses) {
    const cueGood = GOOD_CUE.test(clause);
    const cueBad = BAD_CUE.test(clause);
    const good = cueGood && !cueBad;
    for (const m of clause.matchAll(RANGE)) {
      segs.push({ kind: 'range', start: `${m[1]}/${m[2]}`, end: `${m[3]}/${m[4]}`, good, context: clause });
    }
    for (const m of clause.matchAll(OPEN_ENDED)) {
      segs.push({ kind: 'open', start: `${m[1]}/${m[2]}`, end: null, good, context: clause });
    }
  }
  return segs;
}

const rows = parseCsv(fs.readFileSync(CSV, 'utf8'));
const y = rows.filter((r) => r.label === 'Y');
const n = rows.filter((r) => r.label === 'N');
console.log(`rows ${rows.length}: Y=${y.length} N=${n.length} other=${rows.length - y.length - n.length}`);

const goodSegRows = rows.filter((r) => segmentsOf(r.note).some((s) => s.good));
console.log(`rows whose note names a GOOD stretch: ${goodSegRows.length}`);
console.log(`  of which overall N: ${goodSegRows.filter((r) => r.label === 'N').length}  <- the "N with a good stretch" class`);

const emitted: { instrument: string; label: string; start: string; end: string | null; good: boolean }[] = [];
for (const r of rows) {
  for (const s of segmentsOf(r.note)) {
    if (s.good) emitted.push({ instrument: r.instrument, label: r.label, start: s.start, end: s.end, good: true });
  }
}
console.log(`good segments extracted: ${emitted.length} across ${new Set(emitted.map((e) => e.instrument)).size} instruments`);

fs.writeFileSync('.scratch/labels-parsed.json', JSON.stringify({ rows, segments: emitted }, null, 2), 'utf8');
console.log('\nper-instrument verdict + good segments:');
for (const r of rows) {
  const goods = segmentsOf(r.note).filter((s) => s.good);
  const desc = goods.map((s) => (s.end ? `${s.start}-${s.end}` : `${s.start}+`)).join(', ') || '—';
  console.log(`  ${r.instrument.padEnd(14)} ${r.label}  good: ${desc}`);
}
