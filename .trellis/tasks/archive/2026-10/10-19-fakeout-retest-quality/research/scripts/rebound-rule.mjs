/**
 * Pre-registered measurement of the user-confirmed 「不是假突破」 outcome rule,
 * plus the window-free alternative that the same rule motivates.
 *
 * The user's own words on 10/19 (the reason this task exists):
 *   WAL  "10-9 虽然假突破，但是马上弹上来收敛 10-10 到 10-12 这些收敛都很好"
 *   CFX  "冲高 55% 后阴跌回吐" / "假突破回来但没踩住"
 * i.e. the judgement is about what happened AFTER the spike, over the following
 * week — not about where the price sits inside the last 60 bars.
 *
 * Rules measured (all strictly causal: only bars with index <= E):
 *   R1  ret-L:  retention of the last L daily bars ending at E
 *   R2  hold : share of the move held `h` bars after the move's high
 *   R3  live-shape proxy: R1 top X% AND the coin's 4H retention top Y%
 *
 * Outcomes: for each move near the 285 labels' anchor (2026-10-13), did the coin's
 * own high survive the next nb sessions? (rebound rule) — labelled by the user's
 * own Y/N. Precision = Y inside the selected set / set size, base = 12.6%.
 *
 * Run: POOL_DIR=<dir> [WITH_4H=<dir>] node <this>
 */
import fs from 'node:fs';
import path from 'node:path';

const POOL_DIR = process.env.POOL_DIR;
const iso = (t) => new Date(t).toISOString().slice(0, 10);

function loadDir(dir, minBars) {
  const out = new Map();
  if (!dir || !fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (Array.isArray(raw) && raw.length >= minBars) out.set(f.replace(/\.json$/, ''), raw.map(([t, o, h, l, c]) => ({ t, o, h, l, c })));
    } catch { /* skip */ }
  }
  return out;
}
const daily = loadDir(POOL_DIR, 100);
console.log(`daily pool ${daily.size}`);

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
const labels = parseCsv(fs.readFileSync('.trellis/tasks/archive/2026-10/10-15-structure-fullness/research/labels-285.csv', 'utf8'))
  .slice(1)
  .filter((r) => r.length >= 4)
  .map(([instrument, , , label]) => ({ instrument, y: label.trim() === 'Y' ? 1 : 0 }));
const Y = new Set(labels.filter((l) => l.y).map((l) => l.instrument));
const BASE = (labels.filter((l) => l.y).length / labels.length) * 100;

/** index of the bar at/just before `date` */
const idxAtOrBefore = (arr, date) => {
  const t = Date.parse(`${date}T00:00:00Z`);
  let best = -1;
  for (let i = 0; i < arr.length; i++) if (arr[i].t <= t + 86_399_999) best = i;
  return best;
};

function retention(arr, E, look) {
  const w = arr.slice(Math.max(0, E - look + 1), E + 1);
  if (w.length < 20) return null;
  let loIdx = 0;
  for (let i = 1; i < w.length; i++) if (w[i].c < w[loIdx].c) loIdx = i;
  const lo = w[loIdx].c;
  let hi = -Infinity;
  for (let i = loIdx; i < w.length; i++) if (w[i].h > hi) hi = w[i].h;
  if (!(hi > lo)) return null;
  return (arr[E].c - lo) / (hi - lo);
}

/** R2: the first big move in the 40 bars before the window's end, then what it kept. */
function holdRule(arr, E, { legMin = 15, maxAge = 30, h = 5 } = {}) {
  const end = E; // causal end
  const start = Math.max(0, end - 39);
  let lo = Infinity, loIdx = -1;
  for (let i = start; i <= end; i++) if (arr[i].l < lo) { lo = arr[i].l; loIdx = i; }
  let hi = -Infinity, hiIdx = loIdx;
  for (let i = loIdx; i <= end; i++) if (arr[i].h > hi) { hi = arr[i].h; hiIdx = i; }
  if (!(hi > lo)) return null;
  const leg = (hi / lo - 1) * 100;
  if (leg < legMin) return null;
  const age = end - hiIdx;
  if (age > maxAge || age < h) return null;
  const after = arr[hiIdx + h];
  if (!after) return null;
  return (after.c - lo) / (hi - lo); // 1 = held at the top h bars after the high
}

// ---------------------------------------------------------------- 285 labels, anchor 10-13
const ANCHOR = '2026-10-13';
const present = [];
for (const inst of [...Y, ...labels.map((l) => l.instrument)]) {
  if (present.includes(inst)) continue;
  const arr = daily.get(inst);
  if (!arr) continue;
  const E = idxAtOrBefore(arr, ANCHOR);
  if (E < 60) continue;
  present.push(inst);
  void E;
}
console.log(`label instruments with data at ${ANCHOR}: ${present.length}/${new Set(labels.map((l) => l.instrument)).size}`);

function precisionOf(selected) {
  let y = 0;
  for (const inst of selected) if (Y.has(inst)) y++;
  return { y, n: selected.size, prec: (y / Math.max(1, selected.size)) * 100 };
}

// R1 top X%
const rets = [];
for (const inst of present) {
  const arr = daily.get(inst);
  const E = idxAtOrBefore(arr, ANCHOR);
  const r = retention(arr, E, 60);
  if (r != null) rets.push({ inst, r });
}
rets.sort((a, b) => b.r - a.r);
console.log('\nR1 retention(W=60) top X% — precision among the 285-label instruments only');
for (const cut of [0.05, 0.1, 0.15, 0.2]) {
  const n = Math.max(1, Math.round(rets.length * cut));
  const { y, prec } = precisionOf(new Set(rets.slice(0, n).map((x) => x.inst)));
  console.log(`   top ${(cut * 100).toFixed(0).padStart(2)}% of ${rets.length} = ${n} → ${y}/${n} = ${prec.toFixed(1)}%`);
}

// R2 hold
console.log('\nR2 rebound rule (leg ≥ L% in the last 40 bars, high ≤ A bars old, held h bars later)');
for (const legMin of [10, 15, 20, 30]) {
  for (const h of [3, 5, 8]) {
    const rows = [];
    for (const inst of present) {
      const arr = daily.get(inst);
      const E = idxAtOrBefore(arr, ANCHOR);
      const v = holdRule(arr, E, { legMin, h });
      if (v != null) rows.push({ inst, hold: v });
    }
    rows.sort((a, b) => b.hold - a.hold);
    const cells = [0.1, 0.2, 0.3].map((cut) => {
      const n = Math.max(1, Math.round(rows.length * cut));
      const { y, prec } = precisionOf(new Set(rows.slice(0, n).map((x) => x.inst)));
      return `top${(cut * 100).toFixed(0)}% ${y}/${n}=${prec.toFixed(0)}%`;
    });
    const all = precisionOf(new Set(rows.map((x) => x.inst)));
    console.log(`   leg>=${legMin}% h=${h}: eligible ${rows.length} (base inside ${all.prec.toFixed(0)}%) | ` + cells.join('  '));
  }
}

// ---------------------------------------------------------------- causal pre-registration
const MARK = '2026-09-30';
const outcomeAt = (arr, markIdx, nb = 5, k = 0.9) => {
  const hi = Math.max(...arr.slice(Math.max(0, markIdx - 10), markIdx + 1).map((b) => b.h));
  const win = arr.slice(markIdx + 1, markIdx + 1 + nb);
  if (win.length < nb) return null;
  const low = Math.min(...win.map((b) => b.l));
  return low >= k * hi;
};

// every instrument with data at MARK
const markRows = [];
for (const [inst, arr] of daily) {
  const m = idxAtOrBefore(arr, MARK);
  if (m < 60 || m + 6 >= arr.length) continue;
  markRows.push({
    inst,
    ret: retention(arr, m, 60),
    hold: holdRule(arr, m, {}),
    outcome: outcomeAt(arr, m),
  });
}
const withOutcome = markRows.filter((r) => r.outcome !== null);
const holdRate = (withOutcome.filter((r) => r.outcome).length / withOutcome.length) * 100;
console.log(`\nCAUSAL PRE-REGISTRATION at ${MARK}: ${withOutcome.length} instruments, "held" (low ≥ 0.9×high over next 5 days) = ${holdRate.toFixed(1)}%`);

const pctRank = (rows, key) => {
  const vals = rows.filter((r) => r[key] != null).sort((a, b) => b[key] - a[key]);
  return new Map(vals.map((r, i) => [r.inst, i / vals.length]));
};
const retRank = pctRank(withOutcome, 'ret');
const holdRank = pctRank(withOutcome, 'hold');
for (const [name, rank] of [['retention(60)', retRank], ['rebound-hold', holdRank]]) {
  const line = [0.05, 0.1, 0.2, 0.3].map((cut) => {
    const picked = withOutcome.filter((r) => rank.get(r.inst) < cut);
    const held = picked.filter((r) => r.outcome).length;
    return `top${(cut * 100).toFixed(0)}% ${held}/${picked.length}=${((held / Math.max(1, picked.length)) * 100).toFixed(1)}%`;
  });
  console.log(`   ${name.padEnd(14)} | ` + line.join('  '));
}

// combined: retention top 20% AND rebound-hold top 20%
{
  const picked = withOutcome.filter((r) => (retRank.get(r.inst) ?? 1) < 0.2 && (holdRank.get(r.inst) ?? 1) < 0.2);
  const held = picked.filter((r) => r.outcome).length;
  console.log(`   ret∧hold top20% | ${held}/${picked.length}=${((held / Math.max(1, picked.length)) * 100).toFixed(1)}%`);
}

// 4H binding (optional)
if (process.env.WITH_4H) {
  const h4 = loadDir(process.env.WITH_4H, 60);
  const h4Rows = [];
  for (const [inst, arr] of h4) {
    const m = idxAtOrBefore(arr, MARK);
    if (m < 42) continue;
    const r = retention(arr, m, 42);
    if (r != null) h4Rows.push({ inst, r });
  }
  h4Rows.sort((a, b) => b.r - a.r);
  const h4Rank = new Map(h4Rows.map((x, i) => [x.inst, i / h4Rows.length]));
  console.log(`\n   live-shape proxy (daily ret top X% ∧ 4H ret top Y%), 4H pool ${h4Rows.length}`);
  for (const yPct of [0.2, 0.3, 0.5, 1.0]) {
    const line = [0.1, 0.2, 0.3].map((xPct) => {
      const picked = withOutcome.filter((r) => (retRank.get(r.inst) ?? 1) < xPct && (h4Rank.get(r.inst) ?? 1) < yPct);
      const held = picked.filter((r) => r.outcome).length;
      return `ret${(xPct * 100).toFixed(0)}%/4H${(yPct * 100).toFixed(0)}% ${held}/${picked.length}=${((held / Math.max(1, picked.length)) * 100).toFixed(1)}%`;
    });
    console.log('     ' + line.join('  '));
  }
}
console.log(`\n(baseline "held" rate above is what every rule must beat; 285-label base Y rate = ${BASE.toFixed(1)}%)`);
