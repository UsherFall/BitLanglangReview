/**
 * "接近"的尺度（用户 10/20）：
 *   "不算接近啊，因为他这个币波动相对山寨小的，写死的话是不行的，
 *    你可以试试打到高点后，就是我那个射线起点之后波动的中位数"
 *
 * 用户的意思：每个币用"自己的波动尺度"当尺子，而不是固定的 1.5%。
 * 具体取法：射线起点之后、到"打到高点"为止，这段时间内价格的波动幅度的中位数。
 *
 * 本脚本把几种"波动中位数"都算出来，看哪个量纲说得通：
 *   a) |当日涨跌%| 的中位数
 *   b) 日内振幅 (high-low)/close 的中位数
 *   c) 距射线距离的 |绝对值| 中位数（就是"贴着线晃动的典型幅度"）
 *
 * 然后用 c) 当尺子，重新判断"接不接近"。
 *
 * Run: node .trellis/tasks/10-20-anomaly-level-tracker/research/near-scale.mjs
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

function rayAt(r, ms) {
  const t1 = Number(r.p1.t), t2 = Number(r.p2.t);
  if (t2 === t1) return r.p2.price;
  return r.p2.price + ((r.p2.price - r.p1.price) / (t2 - t1)) * (ms - t2);
}

const med = (xs) => { const v = [...xs].sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : NaN; };

console.log('量准每个币自己的波动尺度（单位：%）\n');
console.log(`${'币'.padEnd(8)}${'a 日涨跌中位'.padStart(12)}${'b 日内振幅中位'.padStart(14)}${'c 距线偏离中位'.padStart(14)}   说明`);

// 对每个用户画过线的币，量它的波动尺度
const labels = JSON.parse(fs.readFileSync(path.join(DIR, 'draw', 'labels.json'), 'utf8'));
const out = [];
for (const c of labels) {
  const arr = bars.get(c.inst);
  if (!arr) continue;
  const short = c.inst.replace(/USDT$/, '');
  for (const s of c.segments ?? []) {
    for (const l of (s.lines ?? []).filter((x) => x.kind === 'r')) {
      // 射线起点之后，到"打到高点"（这波最高价）为止
      const start = arr.findIndex((x) => x.t >= Number(l.p1.t));
      if (start < 0) continue;
      // 高点 = 从起点往后到区间末的最高价
      const endIdx = arr.findIndex((x) => x.d === s.region[1]);
      const seg = arr.slice(start, Math.max(start + 2, endIdx + 1));

      const changes = [];
      for (let i = Math.max(1, start); i < Math.max(start + 2, endIdx + 1); i++) changes.push(Math.abs((arr[i].c - arr[i - 1].c) / arr[i - 1].c) * 100);
      const ranges = seg.map((b) => ((b.h - b.l) / b.c) * 100);
      const dists = seg.map((b) => { const line = rayAt(l, b.t); return Math.abs(((b.c - line) / line) * 100); });

      const rec = { inst: short, a: med(changes), b: med(ranges), c: med(dists), days: seg.length };
      out.push(rec);
      console.log(`${short.padEnd(8)}${rec.a.toFixed(2).padStart(12)}${rec.b.toFixed(2).padStart(14)}${rec.c.toFixed(2).padStart(14)}   ${rec.days} 天`);
    }
  }
}

// 用 c（距线偏离中位）当尺子：当前距离 vs 该币自己的典型偏离
console.log('\n=== 用"该币自己的距线偏离中位"当尺子，判断当下接不接近 ===\n');
console.log(`${'币'.padEnd(8)}${'当前距线'.padStart(10)}${'尺子(中位)'.padStart(12)}${'倍数'.padStart(8)}  结论`);
const allDays = [...new Set([...bars.values()].flatMap((a) => a.map((b) => b.d)))].sort();
const judgeDay = allDays.filter((d) => d < allDays.at(-1)).at(-1);

for (const c of labels) {
  const arr = bars.get(c.inst);
  if (!arr) continue;
  const short = c.inst.replace(/USDT$/, '');
  const E = arr.findIndex((x) => x.d === judgeDay);
  if (E < 0) continue;
  for (const s of c.segments ?? []) {
    for (const l of s.lines ?? []) {
      let line;
      if (l.kind === 'r') line = rayAt(l, arr[E].t);
      else if (l.kind === 'h') line = l.price;
      else continue;
      const dist = Math.abs(((arr[E].c - line) / line) * 100);
      const scale = out.find((o) => o.inst === short);
      if (!scale) { console.log(`${short.padEnd(8)}${dist.toFixed(2).padStart(10)}${'—'.padStart(12)}${'—'.padStart(8)}  （没有波动尺度，因为没画射线）`); continue; }
      const mult = dist / scale.c;
      console.log(`${short.padEnd(8)}${dist.toFixed(2).padStart(10)}${scale.c.toFixed(2).padStart(12)}${mult.toFixed(2).padStart(8)}  ${mult <= 0.5 ? '← 明显比平时近（接近）' : mult <= 1 ? '比平时近' : '比平时远（不算接近）'}`);
    }
  }
}
