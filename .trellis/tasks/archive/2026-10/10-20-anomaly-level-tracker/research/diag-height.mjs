/**
 * 用户 10/20："我想要的还是在底部拉升然后盘整的币，看了下这些都拉的好高"
 *
 * 本脚本只测量，不判断。对每个候选 / 每个用户标注段，量三个"拉多高"的量：
 *   priorFall   拉升起点之前 60 根，从高点到起点跌了多少（回撤到低位了吗）
 *   rallyGain   这波涨了多少（= gain%）
 *   fromBase    现在离这波起点还高多少（0 = 回到起点，1 = 还在顶）
 *
 * 关键对照：用户亲手标过的 38 段，在这三个量上是什么样？
 * 如果用户自己的段也是"拉得高"，那"底部拉升"说的就不是"涨幅小"，
 * 而是"从长期高位跌下来之后，在低位拉起"。
 *
 * Run: node .trellis/tasks/10-20-anomaly-level-tracker/research/diag-height.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = '.trellis/tasks/10-20-anomaly-level-tracker/research';
const dayOf = (t) => new Date(Number(t)).toISOString().slice(0, 10);
const PRIOR = 60;

const bars = new Map();
for (const f of fs.readdirSync(path.join(DIR, 'pool'))) {
  if (!f.endsWith('.json')) continue;
  const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'pool', f), 'utf8'));
  if (raw.length >= 150) {
    bars.set(f.replace(/\.json$/, ''), raw.map(([t, o, h, l, c]) => ({ t: Number(t), o, h, l, c, d: dayOf(t) })));
  }
}

/** 给定拉升起点下标 s 和现在下标 E，量"拉多高 / 在多低的地方拉的" */
function height(arr, s, E) {
  const base = arr[Math.max(0, s - 1)].c;
  const peak = arr.slice(s, E + 1).reduce((m, b) => Math.max(m, b.h), -Infinity);
  const now = arr[E].c;
  const pre = arr.slice(Math.max(0, s - PRIOR), s);
  const preHi = pre.length ? Math.max(...pre.map((b) => b.h)) : base;
  const preLo = pre.length ? Math.min(...pre.map((b) => b.l)) : base;
  return {
    priorFall: +(((preHi - base) / preHi) * 100).toFixed(1), // 起点比前 60 根最高点低多少
    prePos: +(((base - preLo) / (preHi - preLo || 1)) * 100).toFixed(0), // 起点在"近 60 根区间"的位置（0=最底）
    rallyGain: +(((peak - base) / base) * 100).toFixed(0),
    fromBase: +(((now - base) / (peak - base)) * 100).toFixed(0), // 现在在这波涨幅的几成位置
  };
}

// ---------------------------------------------------------------- 用户的 38 段
const ann = JSON.parse(fs.readFileSync(path.join(DIR, 'labels.json'), 'utf8'));
const mine = [];
for (const g of ann) {
  const arr = bars.get(g.inst);
  if (!arr) continue;
  // 用户的"拉升起点" = 区间开始前 30 根内的最低收盘（上一轮已确认这是压力位的参照）
  const a = arr.findIndex((x) => x.d === g.region[0]);
  const b = arr.findIndex((x) => x.d === g.region[1]);
  if (a < 30 || b < 0) continue;
  let s = a - 30;
  for (let i = a - 30; i < a; i++) if (arr[i].c < arr[s].c) s = i;
  mine.push({ key: `${g.inst.replace(/USDT$/, '')}@${g.region[1]}`, verdict: g.verdict, ...height(arr, s, b) });
}

// ---------------------------------------------------------------- 今天的候选
const list = JSON.parse(fs.readFileSync(path.join(DIR, 'out', 'rally-list.json'), 'utf8'));
const cand = [];
for (const r of list) {
  const arr = bars.get(`${r.inst}USDT`);
  if (!arr) continue;
  const s = arr.findIndex((x) => x.d === r.s0);
  const E = arr.findIndex((x) => x.d === r.e);
  if (s < 0 || E < 0) continue;
  cand.push({ key: r.inst, ...height(arr, s, E) });
}

const med = (xs) => { const v = xs.filter(Number.isFinite).sort((p, q) => p - q); return v[Math.floor(v.length / 2)]; };
const q = (xs, p) => { const v = xs.filter(Number.isFinite).sort((a, b) => a - b); return v[Math.min(v.length - 1, Math.floor(v.length * p))]; };

const rows = [
  ['priorFall 起点比前60根高点低 %', mine, cand],
  ['prePos    起点在近60根区间的位置 %', mine, cand],
  ['rallyGain 这波涨幅 %', mine, cand],
  ['fromBase  现在在涨幅的几成位置 %', mine, cand],
];

console.log(`你的 38 段：${mine.length} 段；今日候选：${cand.length} 个\n`);
console.log(`${'量'.padEnd(34)}${'你的段 中位'.padStart(12)}${'p25~p75'.padStart(14)}${'今日候选 中位'.padStart(14)}`);
for (const [label, m, c] of rows) {
  const mv = m.map((x) => x[label.split(' ')[0]]);
  const cv = c.map((x) => x[label.split(' ')[0]]);
  console.log(`${label.padEnd(34)}${String(med(mv)).padStart(12)}${`${q(mv, 0.25)}~${q(mv, 0.75)}`.padStart(14)}${String(med(cv)).padStart(14)}`);
}

// 分档：用户的段里，有多少是"从明显高位跌下来之后拉的"
console.log('\n你的段按「起点比前 60 根高点低多少」分档：');
const buckets = { '跌了 >50%（深坑里拉）': 0, '跌了 30~50%': 0, '跌了 15~30%': 0, '跌了 <15%（高位横着拉）': 0 };
for (const m of mine) {
  if (m.priorFall > 50) buckets['跌了 >50%（深坑里拉）']++;
  else if (m.priorFall > 30) buckets['跌了 30~50%']++;
  else if (m.priorFall > 15) buckets['跌了 15~30%']++;
  else buckets['跌了 <15%（高位横着拉）']++;
}
for (const [k, v] of Object.entries(buckets)) console.log(`  ${k.padEnd(26)} ${String(v).padStart(2)} 段`);

console.log('\n逐段明细（按 priorFall 排序）：');
console.log(`${'段'.padEnd(20)}${'起点比前高'.padStart(10)}${'起点位置'.padStart(9)}${'涨幅'.padStart(7)}${'现在在几成'.padStart(9)}`);
for (const m of mine.sort((a, b) => b.priorFall - a.priorFall)) {
  console.log(`${m.key.padEnd(20)}${('-'+m.priorFall+'%').padStart(10)}${String(m.prePos).padStart(9)}${(m.rallyGain+'%').padStart(7)}${String(m.fromBase).padStart(9)}`);
}

fs.writeFileSync(path.join(DIR, 'out', 'height-compare.json'), JSON.stringify({ mine, cand }, null, 1));
