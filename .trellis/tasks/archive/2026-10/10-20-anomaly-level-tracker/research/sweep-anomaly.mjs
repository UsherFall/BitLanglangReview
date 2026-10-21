/**
 * A1 续：换一个思路 —— 「异动」用每个币自己的基准衡量，取当天最异动的 N 个。
 *
 * 动机：
 *   "有没有拉过 30%"在普涨里对所有币都成立（随机日命中率 23~76%），不是筛选。
 *   但"异动"这个词本身是对的（用户原话：找异动粗筛）。
 *   所以用**该币自己的历史**做基准：今天的波动相对它平时有多异常。
 *   这样天然自适应，不需要任何绝对百分比。
 *
 * 候选量：
 *   a) 当日 |涨跌幅| 相对该币近 N 根 |涨跌幅| 中位数的倍数
 *   b) 当日振幅 相对该币近 N 根振幅 中位数的倍数
 *   c) 近 3 根累计涨幅 相对该币近 N 根的分布分位
 *   d) 突破幅度：今天最高价相对近 N 根最高价的超出量（按该币自身波动折算）
 *
 * 取每天前 20 个，测 9 个"会做"段在区间末那天的召回。
 *
 * Run: node .trellis/tasks/10-20-anomaly-level-tracker/research/sweep-anomaly.mjs
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

const med = (xs) => { const v = xs.filter(Number.isFinite).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : NaN; };

/** 该币的自身基准（在 E 之前的历史上算，不含 E 本身） */
function baseline(arr, E, N) {
  const hist = arr.slice(Math.max(0, E - N), E);
  if (hist.length < 20) return null;
  const chg = [];
  for (let i = Math.max(1, arr.length - hist.length); i < E; i++) chg.push(Math.abs((arr[i].c - arr[i - 1].c) / arr[i - 1].c));
  const rng = hist.map((b) => (b.h - b.l) / b.c);
  return {
    chgMed: med(chg) || 0.01,
    rngMed: med(rng) || 0.02,
    hi: Math.max(...hist.map((b) => b.h)),
    lo: Math.min(...hist.map((b) => b.l)),
  };
}

const METRICS = {
  'a 当日涨跌/自身中位': (arr, E, bl) => {
    const chg = Math.abs((arr[E].c - arr[E - 1].c) / arr[E - 1].c);
    return chg / bl.chgMed;
  },
  'b 当日振幅/自身中位': (arr, E, bl) => {
    const rng = (arr[E].h - arr[E].l) / arr[E].c;
    return rng / bl.rngMed;
  },
  'c 近3根累计/自身日均': (arr, E, bl) => {
    const c3 = Math.abs((arr[E].c - arr[E - 3].c) / arr[E - 3].c);
    return c3 / (bl.chgMed * 3);
  },
  'd 突破幅度/自身波动': (arr, E, bl) => {
    const over = (arr[E].h - bl.hi) / bl.hi;
    return over > 0 ? over / bl.rngMed : 0;
  },
  'e 距区间下沿/自身振幅': (arr, E, bl) => {
    // 价格贴近区间下沿（低位）——可能是不动的地方
    return (arr[E].c - bl.lo) / (bl.hi - bl.lo || 1);
  },
  'f 拉回幅度/自身振幅': (arr, E, bl) => {
    // 从近 20 根最高点回落的幅度，按自身波动折算
    const w = arr.slice(Math.max(0, E - 20), E + 1);
    const hi = Math.max(...w.map((b) => b.h));
    const dd = (hi - arr[E].c) / arr[E].c;
    return dd / bl.rngMed;
  },
};

const labels = JSON.parse(fs.readFileSync(path.join(DIR, 'draw', 'labels.json'), 'utf8'));
const want = [];
for (const c of labels) {
  for (const s of c.segments ?? []) {
    if (!s.region || s.verdict !== 'good') continue;
    want.push({ inst: c.inst.replace(/USDT$/, ''), full: c.inst, region: s.region });
  }
}

const allDays = [...new Set([...bars.values()].flatMap((a) => a.map((b) => b.d)))].sort();
const TOP = 20;

console.log(`池 ${bars.size}；取每天前 ${TOP} 个\n`);
console.log(`${'指标'.padEnd(24)}${'区间末召回'.padStart(11)}${'区间内召回'.padStart(11)}${'规模中位'.padStart(9)}  漏`);

for (const [name, fn] of Object.entries(METRICS)) {
  // 召回：区间末那天，该币排进前 TOP 吗
  let hitEnd = 0;
  let hitAny = 0;
  const miss = [];
  for (const w of want) {
    const arr = bars.get(w.full);
    if (!arr) { miss.push(w.inst + '(无数据)'); continue; }
    // 区间末那天的排名
    const b = arr.findIndex((x) => x.d === w.region[1]);
    const a = arr.findIndex((x) => x.d === w.region[0]);
    if (b >= 0) {
      const scored = [];
      for (const [inst, ar] of bars) {
        const E = ar.findIndex((x) => x.d === w.region[1]);
        if (E < 0) continue;
        const bl = baseline(ar, E, 120);
        if (!bl) continue;
        scored.push({ inst, v: fn(ar, E, bl) });
      }
      scored.sort((x, y) => y.v - x.v);
      if (scored.slice(0, TOP).some((x) => x.inst === w.full)) hitEnd++;
    }
    // 区间内任一天排进前 TOP
    let any = false;
    if (a >= 0 && b >= 0) {
      for (let i = a; i <= b && !any; i++) {
        const scored = [];
        for (const [inst, ar] of bars) {
          const E = ar.findIndex((x) => x.d === ar[i]?.d);
          if (E < 0) continue;
          const bl = baseline(ar, E, 120);
          if (!bl) continue;
          scored.push({ inst, v: fn(ar, E, bl) });
        }
        scored.sort((x, y) => y.v - x.v);
        if (scored.slice(0, TOP).some((x) => x.inst === w.full)) any = true;
      }
    }
    if (any) hitAny++; else miss.push(w.inst);
  }

  // 规模中位（每天前 TOP 实际有多少个有分数）
  const counts = [];
  for (const d of allDays.slice(-20)) {
    const scored = [];
    for (const [inst, ar] of bars) {
      const E = ar.findIndex((x) => x.d === d);
      if (E < 0) continue;
      const bl = baseline(ar, E, 120);
      if (!bl) continue;
      scored.push({ inst, v: fn(ar, E, bl) });
    }
    counts.push(Math.min(TOP, scored.length));
  }
  counts.sort((x, y) => x - y);
  console.log(`${name.padEnd(24)}${String(hitEnd).padStart(11)}${String(hitAny).padStart(11)}${String(counts[Math.floor(counts.length / 2)]).padStart(9)}  ${[...new Set(miss)].join(', ')}`);
}
