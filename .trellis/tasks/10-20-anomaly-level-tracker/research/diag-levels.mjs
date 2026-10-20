/**
 * 诊断：回放出来的「距上方最近一条线」为什么整体偏大？
 *
 * 三种口径对比，全部只用 38 段标注里 33 条水平线与 1D 数据：
 *   A. 现价 vs 用户那条线（标注的原始意图）
 *   B. 现价 vs 区间内已可见的最高价（不含未来）—— "现价还差多少回到这波的高点"
 *   C. 现价 vs 上方最近一条用户线（用户 10/20 选的口径）
 *
 * 目的：确认"还差多少"这个数字本身合理（不是因为线画在水下或数据错位）。
 *
 * Run: node .trellis/tasks/10-20-anomaly-level-tracker/research/diag-levels.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = '.trellis/tasks/10-20-anomaly-level-tracker/research';
const dayOf = (t) => new Date(Number(t)).toISOString().slice(0, 10);

const bars = new Map();
for (const f of fs.readdirSync(path.join(DIR, 'pool'))) {
  if (!f.endsWith('.json')) continue;
  const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'pool', f), 'utf8'));
  if (raw.length >= 150) bars.set(f.replace(/\.json$/, ''), raw.map(([t, o, h, l, c]) => ({ t: Number(t), o, h, l, c, d: dayOf(t) })));
}
const ann = JSON.parse(fs.readFileSync(path.join(DIR, 'labels.json'), 'utf8'));

const rows = [];
for (const g of ann) {
  const arr = bars.get(g.inst);
  if (!arr) continue;
  const lines = (g.lines ?? []).filter((l) => l.kind === 'h').map((l) => l.price);
  if (!lines.length) continue;
  const a = arr.findIndex((x) => x.d === g.region[0]);
  const z = arr.findIndex((x) => x.d === g.region[1]);
  if (a < 0 || z < 0) continue;
  for (let i = a; i <= z; i++) {
    const price = arr[i].c;
    const myLine = lines[0];
    const aboveLines = lines.filter((l) => l > price).sort((x, y) => x - y);
    const seenHigh = arr.slice(Math.max(0, a - 30), i + 1).reduce((m, b) => Math.max(m, b.h), -Infinity);
    rows.push({
      inst: g.inst.replace(/USDT$/, ''),
      d: arr[i].d,
      A: +(((myLine - price) / price) * 100).toFixed(2),
      B: +(((seenHigh - price) / price) * 100).toFixed(2),
      C: aboveLines[0] == null ? null : +(((aboveLines[0] - price) / price) * 100).toFixed(2),
    });
  }
}

const med = (xs) => { const v = xs.filter((x) => x != null).sort((p, q) => p - q); return v[Math.floor(v.length / 2)]; };
console.log(`回放 ${rows.length} 个币日（来自 38 段里有水平线的段）`);
console.log(`A 现价 vs 你那条线     中位 ${med(rows.map((r) => Math.abs(r.A)))}%   （绝对值）`);
console.log(`B 现价 vs 区间内已见高点 中位 ${med(rows.map((r) => Math.abs(r.B)))}%`);
console.log(`C 现价 vs 上方最近一条线 中位 ${med(rows.map((r) => Math.abs(r.C ?? 0)))}%`);

// 逐段看：最后一天的三个数字
console.log(`\n每段最后一天：`);
console.log(`${'币'.padEnd(9)}${'区间末'.padStart(12)}${'你那条线'.padStart(10)}${'已见高点'.padStart(10)}${'上方最近'.padStart(10)}`);
const lastByRegion = new Map();
for (const r of rows) lastByRegion.set(`${r.inst}@${r.d}`, r);
const seen = new Set();
for (const g of ann) {
  const key = `${g.inst.replace(/USDT$/, '')}@${g.region[1]}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const r = lastByRegion.get(key);
  if (!r) continue;
  console.log(`${r.inst.padEnd(9)}${r.d.padStart(12)}${(r.A + '%').padStart(10)}${(r.B + '%').padStart(10)}${(r.C == null ? '-' : r.C + '%').padStart(10)}`);
}
