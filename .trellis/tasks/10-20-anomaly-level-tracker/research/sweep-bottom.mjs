/**
 * 找"底部拉升 → 盘整"这个形态最接近的口径。
 *
 * 上一轮（diag-height.mjs）测出来：
 *   用户的段：起点偏低位（prePos 中位 32）、涨幅温和（43%）、现在回到涨幅的 74%
 *   今日候选：起点多在高位（prePos 11）、涨幅大（108%）、现在只在 57%
 *
 * 这里把两个"相对量"组合起来扫参数，看哪一档能同时满足：
 *   A. 今天的候选数落在用户愿意看的范围（几十个以内）
 *   B. 覆盖用户标过的段最好（说明形状对上了）
 * 指标全部相对该币自身，不写死价格百分比。
 *
 * Run: node .trellis/tasks/10-20-anomaly-level-tracker/research/sweep-bottom.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = '.trellis/tasks/10-20-anomaly-level-tracker/research';
const dayOf = (t) => new Date(Number(t)).toISOString().slice(0, 10);
const PRIOR = 60;
const LOOKBACK = 90;
const LOOKBACK_PRE = 150;   // 探"起点是不是低位"要往前看得更远

const bars = new Map();
for (const f of fs.readdirSync(path.join(DIR, 'pool'))) {
  if (!f.endsWith('.json')) continue;
  const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'pool', f), 'utf8'));
  if (raw.length >= 150) bars.set(f.replace(/\.json$/, ''), raw.map(([t, o, h, l, c]) => ({ t: Number(t), o, h, l, c, d: dayOf(t) })));
}

/** 找拉升段 + 量"在什么位置拉的" */
function shape(arr, E, o = {}) {
  const lookback = o.lookback ?? LOOKBACK;
  if (E < LOOKBACK_PRE + 5) return null;
  const from = E - lookback;
  let best = null;
  let lo = from;
  let loC = arr[from].c;
  for (let i = from; i <= E; i++) {
    if (arr[i].c < loC) { loC = arr[i].c; lo = i; }
    const g = (arr[i].h - loC) / loC;
    if (g >= 0.15 && i - lo + 1 >= 3 && (!best || g > best.gain)) best = { sAt: lo, pAt: i, gain: g };
  }
  if (!best) return null;
  const { sAt, pAt } = best;
  const base = arr[Math.max(0, sAt - 1)].c;
  const peak = arr.slice(sAt, pAt + 1).reduce((m, b) => Math.max(m, b.h), -Infinity);
  const now = arr[E].c;

  // 起点在"更长时间窗"里的位置：0 = 最底，1 = 最高
  const win = arr.slice(Math.max(0, sAt - LOOKBACK_PRE), sAt + 1);
  const hi = Math.max(...win.map((b) => b.h));
  const loP = Math.min(...win.map((b) => b.l));
  const basePos = (base - loP) / (hi - loP || 1);

  return {
    gain: best.gain,
    basePos,
    fromBase: (now - base) / (peak - base || 1),  // 现在在这波涨幅的几成位置
    fromPeak: (peak - now) / peak,
    giveback: (peak - Math.min(...arr.slice(pAt, E + 1).map((b) => b.l))) / (peak - base),
    holdDays: E - pAt,
  };
}

const ann = JSON.parse(fs.readFileSync(path.join(DIR, 'labels.json'), 'utf8'));
const mine = [];
for (const g of ann) {
  const arr = bars.get(g.inst);
  if (!arr) continue;
  const a = arr.findIndex((x) => x.d === g.region[0]);
  const b = arr.findIndex((x) => x.d === g.region[1]);
  if (a < 30 || b < 0) continue;
  let s = a - 30;
  for (let i = a - 30; i < a; i++) if (arr[i].c < arr[s].c) s = i;
  const E = b;
  // 用用户自己的起点算这些量（而不是我们找的）
  const base = arr[s - 1].c;
  const peak = arr.slice(s, b + 1).reduce((m, x) => Math.max(m, x.h), -Infinity);
  const win = arr.slice(Math.max(0, s - LOOKBACK_PRE), s + 1);
  const hi = Math.max(...win.map((x) => x.h));
  const loP = Math.min(...win.map((x) => x.l));
  mine.push({
    key: `${g.inst.replace(/USDT$/, '')}@${g.region[1]}`,
    gain: (peak - base) / base,
    basePos: (base - loP) / (hi - loP || 1),
    fromBase: (arr[b].c - base) / (peak - base || 1),
  });
}

const today = [];
let todayDay = '';
for (const [inst, arr] of bars) {
  const E = arr.length - 1;
  if (arr[E].d > todayDay) todayDay = arr[E].d;
}
for (const [inst, arr] of bars) {
  const E = arr.findIndex((x) => x.d === todayDay);
  if (E < 0) continue;
  const s = shape(arr, E, { lookback: LOOKBACK });
  if (s) today.push({ inst: inst.replace(/USDT$/, ''), ...s });
}
console.log(`用户 ${mine.length} 段 · 今日 ${today.length} 个候选（${todayDay}）\n`);

// 组合参数扫描
console.log(`${'起点位置<'.padEnd(10)}${'涨幅<'.padEnd(8)}${'涨幅>'.padEnd(8)}${'今日命中'.padStart(9)}${'覆盖你的段'.padStart(11)}   （这些币里能罩住几段）`);
const results = [];
for (const posMax of [0.25, 0.35, 0.45, 0.6]) {
  for (const gainMin of [0.2, 0.3, 0.5]) {
    for (const gainMax of [0.5, 0.8, 1.2, 9]) {
      const hits = today.filter((t) => t.basePos <= posMax && t.gain >= gainMin && t.gain < gainMax);
      // 覆盖：用户的段是否落在这一档里
      const cov = mine.filter((m) => m.basePos <= posMax && m.gain >= gainMin && m.gain < gainMax).length;
      results.push({ posMax, gainMin, gainMax, n: hits.length, cov, pct: (cov / mine.length) * 100 });
      console.log(
        `${String(posMax).padEnd(10)}${String(gainMin).padEnd(8)}${String(gainMax).padEnd(8)}${String(hits.length).padStart(9)}${String(cov + '/' + mine.length).padStart(11)}`,
      );
    }
  }
}

const good = results.filter((r) => r.n >= 8 && r.n <= 40).sort((a, b) => b.cov - a.cov);
console.log('\n候选数在 8~40 之间、覆盖最好的几档：');
for (const r of good.slice(0, 6)) {
  console.log(`  起点位置<${r.posMax} 涨幅 ${r.gainMin}~${r.gainMax}：今日 ${r.n} 个，覆盖 ${r.cov}/${mine.length}`);
}

fs.writeFileSync(path.join(DIR, 'out', 'bottom-sweep.json'), JSON.stringify({ mine, today, results }, null, 1));
