/**
 * 关键问题：为什么 BAND(排名84) 和 RENDER(排名132) 进不了前 20？
 *
 * 假设：用户看的不只是"离高点近"，而是"离高点近 **且** 从低上来的空间大 / 位置合适"。
 * BAND、RENDER 在你那两段时的价格位置，与能进前 20 的那些有什么不同？
 *
 * Run: node .trellis/tasks/10-20-anomaly-level-tracker/research/diag-badrank.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = '.trellis/tasks/10-20-anomaly-level-tracker/research';
const dayOf = (t) => new Date(Number(t) + 8 * 3600 * 1000).toISOString().slice(0, 10);

const bars = new Map();
for (const f of fs.readdirSync(path.join(DIR, 'pool'))) {
  if (!f.endsWith('.json')) continue;
  const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'pool', f), 'utf8'));
  if (raw.length >= 120) bars.set(f.replace(/\.json$/, ''), raw.map(([t, o, h, l, c]) => ({ t: Number(t), o, h, l, c, d: dayOf(t) })));
}

const labels = JSON.parse(fs.readFileSync(path.join(DIR, 'draw', 'labels.json'), 'utf8'));
const want = [];
for (const c of labels) {
  for (const s of c.segments ?? []) {
    if (!s.region || s.verdict !== 'good') continue;
    want.push({ inst: c.inst.replace(/USDT$/, ''), full: c.inst, region: s.region, note: (c.note || '').trim() });
  }
}

// 各种"位置"量
function profile(arr, E) {
  const w60 = arr.slice(Math.max(0, E - 60), E + 1);
  const w90 = arr.slice(Math.max(0, E - 90), E + 1);
  const w30 = arr.slice(Math.max(0, E - 30), E + 1);
  const pos = (w) => {
    const hi = Math.max(...w.map((b) => b.h)), lo = Math.min(...w.map((b) => b.l));
    return (arr[E].c - lo) / (hi - lo || 1);
  };
  const ret = (n) => {
    const a = arr[Math.max(0, E - n)].c;
    return (arr[E].c - a) / a;
  };
  // 从 90 根最低点涨上来多少
  const lo90 = Math.min(...w90.map((b) => b.l));
  const hi90 = Math.max(...w90.map((b) => b.h));
  return {
    pos60: pos(w60),
    pos90: pos(w90),
    pos30: pos(w30),
    ret5: ret(5),
    ret10: ret(10),
    ret30: ret(30),
    ret60: ret(60),
    fromLow90: (arr[E].c - lo90) / lo90,
    toHigh90: (hi90 - arr[E].c) / arr[E].c,
    // 波动
    rngMed: (() => { const xs = arr.slice(Math.max(0, E - 120), E).map((b) => (b.h - b.l) / b.c).sort((x, y) => x - y); return xs[Math.floor(xs.length / 2)]; })(),
  };
}

console.log(`${'币'.padEnd(8)}${'区间末'.padStart(12)}${'pos30'.padStart(8)}${'pos60'.padStart(8)}${'pos90'.padStart(8)}${'ret10'.padStart(8)}${'ret30'.padStart(8)}${'ret60'.padStart(8)}${'离90高'.padStart(8)}${'振幅中位'.padStart(9)}`);
const rows = [];
for (const w of want) {
  const arr = bars.get(w.full);
  if (!arr) continue;
  const E = arr.findIndex((x) => x.d === w.region[1]);
  if (E < 0) continue;
  const p = profile(arr, E);
  rows.push({ inst: w.inst, end: w.region[1], ...p, note: w.note });
}
rows.sort((a, b) => a.pos90 - b.pos90);
for (const r of rows) {
  console.log(
    `${r.inst.padEnd(8)}${r.end.padStart(12)}${r.pos30.toFixed(2).padStart(8)}${r.pos60.toFixed(2).padStart(8)}${r.pos90.toFixed(2).padStart(8)}${(r.ret10 * 100).toFixed(0).padStart(7)}%${(r.ret30 * 100).toFixed(0).padStart(7)}%${(r.ret60 * 100).toFixed(0).padStart(7)}%${(r.toHigh90 * 100).toFixed(0).padStart(7)}%${(r.rngMed * 100).toFixed(1).padStart(8)}%`,
  );
}
console.log('\n（BAND / RENDER 是排名 84/132 的那两个；ETH 7、BNB 1、OPG 11 是能进前 20 的）');
