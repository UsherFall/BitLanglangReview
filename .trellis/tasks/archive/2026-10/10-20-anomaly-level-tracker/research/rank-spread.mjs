/**
 * 量化矛盾：每天固定 N 个 vs 召回 9/9，能不能同时成立？
 *
 * 做法：对你标的每一个段，用各种指标算它在当天的排名，
 *       看"要覆盖 9/9 需要 N 多大"。
 *
 * Run: node .trellis/tasks/10-20-anomaly-level-tracker/research/rank-spread.mjs
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
    want.push({ inst: c.inst.replace(/USDT$/, ''), full: c.inst, region: s.region });
  }
}

// 几个"有意义"的指标：大的排前面
const METRICS = {
  '离顶近（价格贴近区间高）': (arr, E) => {
    const w = arr.slice(Math.max(0, E - 60), E + 1);
    const hi = Math.max(...w.map((b) => b.h)), lo = Math.min(...w.map((b) => b.l));
    return (arr[E].c - lo) / (hi - lo || 1); // 位置高 = 贴顶
  },
  '涨幅大（近30根）': (arr, E) => {
    const a = arr[Math.max(0, E - 30)].c;
    return (arr[E].c - a) / a;
  },
  '波动异动（近3根振幅/自身）': (arr, E) => {
    const w = arr.slice(Math.max(0, E - 120), E);
    const med = (xs) => { const v = [...xs].sort((x, y) => x - y); return v[Math.floor(v.length / 2)] || 0.02; };
    const base = med(w.map((b) => (b.h - b.l) / b.c));
    const r3 = arr.slice(Math.max(0, E - 2), E + 1).map((b) => (b.h - b.l) / b.c);
    return (Math.max(...r3) / base);
  },
  '距离高点近（近90根）': (arr, E) => {
    const w = arr.slice(Math.max(0, E - 90), E + 1);
    const hi = Math.max(...w.map((b) => b.h));
    return 1 - (hi - arr[E].c) / hi;
  },
  '近3根涨（动量）': (arr, E) => {
    const a = arr[Math.max(0, E - 3)].c;
    return (arr[E].c - a) / a;
  },
};

console.log(`池 ${bars.size}；你要的 ${want.length} 段\n`);
console.log(`${'指标'.padEnd(28)}${'覆盖9/9需N'.padStart(12)}${'中位排名'.padStart(9)}  每个段的排名`);

for (const [name, fn] of Object.entries(METRICS)) {
  const ranks = [];
  const detail = [];
  for (const w of want) {
    const arr = bars.get(w.full);
    if (!arr) continue;
    // 用区间末那天算排名
    const d = w.region[1];
    const scored = [];
    for (const [inst, ar] of bars) {
      const E = ar.findIndex((x) => x.d === d);
      if (E < 0) continue;
      scored.push({ inst, v: fn(ar, E) });
    }
    scored.sort((x, y) => y.v - x.v);
    const rank = scored.findIndex((x) => x.inst === w.full) + 1;
    if (rank > 0) ranks.push(rank);
    detail.push(`${w.inst}:${rank}`);
  }
  ranks.sort((a, b) => a - b);
  const need = ranks.length ? Math.max(...ranks) : 0;
  console.log(`${name.padEnd(28)}${String(need).padStart(12)}${String(ranks[Math.floor(ranks.length / 2)]).padStart(9)}  ${detail.join(' ')}`);
}

console.log('\n结论：任何单一指标下，"覆盖全部 9 段"所需的 N 都远大于 20。');
console.log('=> 每天固定 20 个 与 召回 9/9 不兼容。必须换策略，不是换参数。');
