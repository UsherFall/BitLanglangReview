/**
 * 用户 10/20：我最多看 20 个了。
 *
 * 上一版（pick20.mjs）发现：你标过的 9 个在 82 候选里散布在第 1~35 名，
 * 任何单维排序取前 20 都只能覆盖 6/9 —— 排序救不了。
 *
 * 所以换思路：收窄"什么算异动"这个前提，让池子本身降到 20 附近。
 * 这里扫描几个"前提条件"，看哪个能把你的 9 个尽量留下、同时把池子压小。
 *
 * 注意：只用相对量，不用绝对百分比；每个条件都单独看效果，不做组合搜索（避免过拟合）。
 *
 * Run: node .trellis/tasks/10-20-anomaly-level-tracker/research/sweep-pool.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = '.trellis/tasks/10-20-anomaly-level-tracker/research';
const dayOf = (t) => new Date(Number(t) + 8 * 3600 * 1000).toISOString().slice(0, 10);

const bars = new Map();
for (const f of fs.readdirSync(path.join(DIR, 'pool'))) {
  if (!f.endsWith('.json')) continue;
  const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'pool', f), 'utf8'));
  if (raw.length >= 200) bars.set(f.replace(/\.json$/, ''), raw.map(([t, o, h, l, c, v]) => ({ t: Number(t), o, h, l, c, v: Number(v), d: dayOf(t) })));
}
const todayDay = [...bars.values()].map((a) => a[a.length - 1].d).sort().at(-1);

function rally(arr, E, o) {
  const LB = o.lookback ?? 90;
  if (E < LB + 20) return null;
  const from = E - LB;
  let best = null;
  let lo = from;
  let loC = arr[from].c;
  for (let i = from; i <= E; i++) {
    if (arr[i].c < loC) { loC = arr[i].c; lo = i; }
    const g = (arr[i].h - loC) / loC;
    if (g >= (o.gainMin ?? 0.3) && i - lo + 1 >= (o.minDays ?? 4) && (!best || g > best.gain)) best = { sAt: lo, pAt: i, gain: g };
  }
  if (!best) return null;
  const { sAt, pAt } = best;
  const base = arr[Math.max(0, sAt - 1)].c;
  const peak = arr.slice(sAt, pAt + 1).reduce((m, b) => Math.max(m, b.h), -Infinity);
  const now = arr[E].c;
  const after = arr.slice(pAt, E + 1);
  const hi = Math.max(...after.map((b) => b.h));
  const brokeOut = hi > peak * 1.0001;
  let L = arr[pAt].l;
  for (let i = pAt; i <= E; i++) L = Math.min(L, arr[i].l);
  const giveback = (peak - L) / (peak - base);
  // 顶后整理时的振幅（相对这波涨幅）—— 判断"顶后是不是还算稳"
  const afterHi = Math.max(...after.map((b) => b.h));
  const afterLo = Math.min(...after.map((b) => b.l));
  const settle = (afterHi - afterLo) / (peak - base || 1);
  // 最近 10 根振幅 / 这波涨幅
  const r10 = arr.slice(Math.max(0, E - 9), E + 1);
  const recentAmp = (Math.max(...r10.map((b) => b.h)) - Math.min(...r10.map((b) => b.l))) / (peak - base || 1);
  return {
    s0: arr[sAt].d, p: arr[pAt].d,
    gain: (peak - base) / base,
    fromPeak: (peak - now) / peak,
    holdDays: E - pAt,
    brokeOut,
    giveback,
    settle,
    recentAmp,
  };
}

const labels = JSON.parse(fs.readFileSync(path.join(DIR, 'draw', 'labels.json'), 'utf8'));
const judged = new Map(labels.map((c) => [c.inst.replace(/USDT$/, ''), (c.segments ?? [])[0]?.verdict ?? null]));
const picked = [...judged.entries()].filter(([, v]) => v === 'good' || v === 'structure').map(([k]) => k);
const wanted = [...judged.entries()].filter(([, v]) => v === 'good').map(([k]) => k);

const base = { gainMin: 0.3, minDays: 4, lookback: 90 };
const configs = [
  ['基准（现口径）', base],
  ['顶后没回吐超过 40%', { ...base, maxGiveback: 0.4 }],
  ['顶后没回吐超过 30%', { ...base, maxGiveback: 0.3 }],
  ['顶后整理振幅 < 涨幅的 80%', { ...base, maxSettle: 0.8 }],
  ['顶后整理振幅 < 涨幅的 60%', { ...base, maxSettle: 0.6 }],
  ['近 10 根振幅 < 涨幅的 30%', { ...base, maxRecent: 0.3 }],
  ['近 10 根振幅 < 涨幅的 20%', { ...base, maxRecent: 0.2 }],
  ['顶后 ≥ 20 天', { ...base, minHold: 20 }],
  ['顶后 ≥ 40 天', { ...base, minHold: 40 }],
  ['拉升 ≥ 50%', { ...base, gainMin: 0.5 }],
  ['拉升 ≥ 80%', { ...base, gainMin: 0.8 }],
  ['回看 60 根（更短的历史）', { ...base, lookback: 60 }],
];

console.log(`池 ${bars.size} 个币，今日 ${todayDay}；你的判定：会做 ${wanted.length}、会做+结构不行 ${picked.length}\n`);
console.log(`${'前提条件'.padEnd(30)}${'池大小'.padStart(7)}${'留下你的'.padStart(10)}${'（会做）'.padStart(9)}`);

const rows = [];
for (const [name, o] of configs) {
  let n = 0;
  const kept = new Set();
  for (const [inst, arr] of bars) {
    const E = arr.findIndex((x) => x.d === todayDay);
    if (E < 0) continue;
    const r = rally(arr, E, o);
    if (!r) continue;
    if (r.brokeOut) continue;
    if (o.maxGiveback != null && r.giveback > o.maxGiveback) continue;
    if (o.maxSettle != null && r.settle > o.maxSettle) continue;
    if (o.maxRecent != null && r.recentAmp > o.maxRecent) continue;
    if (o.minHold != null && r.holdDays < o.minHold) continue;
    n++;
    kept.add(inst.replace(/USDT$/, ''));
  }
  const hit = picked.filter((x) => kept.has(x)).length;
  const hitGood = wanted.filter((x) => kept.has(x)).length;
  rows.push({ name, n, hit, hitGood });
  console.log(`${name.padEnd(30)}${String(n).padStart(7)}${String(hit + '/' + picked.length).padStart(10)}${String(hitGood + '/' + wanted.length).padStart(9)}`);
}

console.log('\n最接近 20 个、且留下最多的：');
for (const r of rows.filter((x) => x.n >= 15 && x.n <= 30).sort((a, b) => b.hit - a.hit)) {
  console.log(`  ${r.name.padEnd(30)} ${r.n} 个，留下 ${r.hit}/${picked.length}（会做 ${r.hitGood}/${wanted.length}）`);
}
