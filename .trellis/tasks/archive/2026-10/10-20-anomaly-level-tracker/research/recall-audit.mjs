/**
 * 核心问题（用户 10/20 指出）：
 *   "你要关注的是算法本身能不能扫出那些币，
 *    因为我们是先扫出来然后我标注压力位再持续关注"
 *
 * 评价指标只有一个：召回 —— 你标"会做"的段，算法扫不扫得到。
 * 同时必须看规模：每天报 200 个、召回才一半，等于没解决。
 *
 * Run: node .trellis/tasks/10-20-anomaly-level-tracker/research/recall-audit.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = '.trellis/tasks/10-20-anomaly-level-tracker/research';
const dayOf = (t) => new Date(Number(t) + 8 * 3600 * 1000).toISOString().slice(0, 10);

// 新币也要能扫（OPG 只有 181 根，之前被 ">=200" 的过滤挡掉了）
const bars = new Map();
for (const f of fs.readdirSync(path.join(DIR, 'pool'))) {
  if (!f.endsWith('.json')) continue;
  const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'pool', f), 'utf8'));
  if (raw.length >= 120) bars.set(f.replace(/\.json$/, ''), raw.map(([t, o, h, l, c]) => ({ t: Number(t), o, h, l, c, d: dayOf(t) })));
}

function scan(arr, E, o) {
  const LB = o.lookback ?? 90;
  if (E < 60) return null;
  const from = Math.max(0, E - LB);
  let best = null;
  let lo = from;
  let loC = arr[from].c;
  for (let i = from; i <= E; i++) {
    if (arr[i].c < loC) { loC = arr[i].c; lo = i; }
    const g = (arr[i].h - loC) / loC;
    const minLen = o.minDays ?? 1;
    if (g >= (o.gainMin ?? 0.3) && i - lo + 1 >= minLen && (!best || g > best.gain)) best = { sAt: lo, pAt: i, gain: g };
  }
  if (!best) return null;
  const { sAt, pAt } = best;
  const base = arr[Math.max(0, sAt - 1)].c;
  const peak = arr.slice(sAt, pAt + 1).reduce((m, b) => Math.max(m, b.h), -Infinity);
  const after = arr.slice(pAt, E + 1);
  if (o.noBreakout && Math.max(...after.map((b) => b.h)) > peak * 1.0001) return null;
  let L = arr[pAt].l;
  for (let i = pAt; i <= E; i++) L = Math.min(L, arr[i].l);
  const giveback = (peak - L) / (peak - base);
  if (o.maxGiveback != null && giveback > o.maxGiveback) return null;
  return { s0: arr[sAt].d, p: arr[pAt].d, gain: best.gain, giveback };
}

const CONFIGS = [
  ['A 现口径 (>=30% & >=4天 & 未破 & 回吐<=60%)', { gainMin: 0.3, minDays: 4, noBreakout: true, maxGiveback: 0.6 }],
  ['B 不限回吐 (>=30% & >=4天 & 未破)', { gainMin: 0.3, minDays: 4, noBreakout: true }],
  ['C 回看60根 (>=30% & >=4天 & 未破 & 回吐<=60%)', { gainMin: 0.3, minDays: 4, noBreakout: true, maxGiveback: 0.6, lookback: 60 }],
  ['D 不限时长 (>=30%)', { gainMin: 0.3 }],
  ['E 更低门槛 (>=20% & >=3天 & 未破)', { gainMin: 0.2, minDays: 3, noBreakout: true }],
];

const labels = JSON.parse(fs.readFileSync(path.join(DIR, 'draw', 'labels.json'), 'utf8'));
const want = [];
for (const c of labels) {
  for (const s of c.segments ?? []) {
    if (!s.region || s.verdict !== 'good') continue;
    want.push({ inst: c.inst.replace(/USDT$/, ''), full: c.inst, region: s.region });
  }
}

const allDays = [...new Set([...bars.values()].flatMap((a) => a.map((b) => b.d)))].sort();
const sample = allDays.slice(-30);

console.log(`池 ${bars.size} 个币（含少于 200 根的新币）；你标"会做"的段 ${want.length} 个\n`);
console.log(`${'口径'.padEnd(48)}${'区间末'.padStart(7)}${'区间内'.padStart(7)}${'每日规模'.padStart(9)}`);

for (const [name, o] of CONFIGS) {
  let hitEnd = 0;
  let hitAny = 0;
  const misses = [];
  for (const w of want) {
    const arr = bars.get(w.full);
    if (!arr) { misses.push(w.inst + '(无数据)'); continue; }
    const b = arr.findIndex((x) => x.d === w.region[1]);
    const a = arr.findIndex((x) => x.d === w.region[0]);
    if (b >= 0 && scan(arr, b, o)) hitEnd++;
    let any = false;
    if (a >= 0 && b >= 0) for (let i = a; i <= b; i++) if (scan(arr, i, o)) { any = true; break; }
    if (any) hitAny++;
    else misses.push(w.inst);
  }
  const counts = [];
  for (const d of sample) {
    let n = 0;
    for (const arr of bars.values()) {
      const E = arr.findIndex((x) => x.d === d);
      if (E >= 0 && scan(arr, E, o)) n++;
    }
    counts.push(n);
  }
  counts.sort((x, y) => x - y);
  const med = counts[Math.floor(counts.length / 2)];
  console.log(`${name.padEnd(48)}${String(hitEnd).padStart(7)}${String(hitAny).padStart(7)}${String(med).padStart(9)}  漏: ${[...new Set(misses)].join(', ')}`);
}

console.log('\n区间末 = 你标的区间最后一天算法当天扫没扫到；区间内 = 整段里有没有任何一天扫到');
