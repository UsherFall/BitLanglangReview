/**
 * 验证：口径 B/E 的召回 8~9/9，是不是靠"什么都报"换来的？
 *
 * 必须确认：
 *   1. 每天 438~443 个，占全池（451）的多少 —— 如果接近 100%，那就是没筛
 *   2. 用"随机日"对照：如果随机日也几乎全满足，说明判据没有区分力
 *   3. 「未突破」这条到底砍掉了多少 —— 它是唯一还在起作用的约束
 *
 * Run: node .trellis/tasks/10-20-anomaly-level-tracker/research/check-recall-real.mjs
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

function detail(arr, E, o) {
  if (E < 60) return null;
  const LB = o.lookback ?? 90;
  const from = Math.max(0, E - LB);
  let best = null;
  let lo = from;
  let loC = arr[from].c;
  for (let i = from; i <= E; i++) {
    if (arr[i].c < loC) { loC = arr[i].c; lo = i; }
    const g = (arr[i].h - loC) / loC;
    if (g >= (o.gainMin ?? 0.3) && i - lo + 1 >= (o.minDays ?? 1) && (!best || g > best.gain)) best = { sAt: lo, pAt: i, gain: g };
  }
  if (!best) return { ok: false, why: 'no-rally' };
  const { sAt, pAt } = best;
  const base = arr[Math.max(0, sAt - 1)].c;
  const peak = arr.slice(sAt, pAt + 1).reduce((m, b) => Math.max(m, b.h), -Infinity);
  const after = arr.slice(pAt, E + 1);
  const broke = Math.max(...after.map((b) => b.h)) > peak * 1.0001;
  let L = arr[pAt].l;
  for (let i = pAt; i <= E; i++) L = Math.min(L, arr[i].l);
  const giveback = (peak - L) / (peak - base);
  if (o.noBreakout && broke) return { ok: false, why: 'broke' };
  return { ok: true, gain: best.gain, giveback };
}

const allDays = [...new Set([...bars.values()].flatMap((a) => a.map((b) => b.d)))].sort();
const sample = allDays.slice(-30);

const E_CFG = { gainMin: 0.2, minDays: 3, noBreakout: true };
const B_CFG = { gainMin: 0.3, minDays: 4, noBreakout: true };

console.log(`池 ${bars.size} 个币\n`);

for (const [name, cfg] of [['B 不限回吐(>=30%/>=4天/未破)', B_CFG], ['E 低门槛(>=20%/>=3天/未破)', E_CFG]]) {
  const counts = [];
  const why = { 'no-rally': 0, broke: 0, ok: 0 };
  for (const d of sample) {
    let n = 0;
    let total = 0;
    for (const arr of bars.values()) {
      const E = arr.findIndex((x) => x.d === d);
      if (E < 0) continue;
      total++;
      const r = detail(arr, E, cfg);
      if (r && r.ok) n++;
      else if (r) why[r.why]++;
      else why['no-rally']++;
    }
    counts.push({ d, n, total });
  }
  const ns = counts.map((c) => c.n).sort((a, b) => a - b);
  const med = ns[Math.floor(ns.length / 2)];
  const totalCoins = counts[0].total;
  console.log(`=== ${name} ===`);
  console.log(`  每天命中 中位 ${med} / 池 ${totalCoins} = ${((med / totalCoins) * 100).toFixed(0)}%`);
  console.log(`  被"已突破"挡掉：${why.broke} 个币日；被"没有拉升"挡掉：${why['no-rally']} 个币日；通过：${why.ok} 个币日`);
  console.log(`  ⇒ "未突破"是唯一还在起作用的约束，砍掉了 ${((why.broke / (why.broke + why.ok)) * 100).toFixed(0)}%\n`);
}

// 随机日对照：B 口径下，随机日与"用户标注日"的命中率差异
let seed = 5;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
let ctrlHit = 0;
let ctrlN = 0;
for (const arr of bars.values()) {
  for (let k = 0; k < 4; k++) {
    const E = 60 + Math.floor(rnd() * (arr.length - 60));
    ctrlN++;
    const r = detail(arr, E, B_CFG);
    if (r && r.ok) ctrlHit++;
  }
}
console.log(`随机日对照（B 口径）：${ctrlHit}/${ctrlN} = ${((ctrlHit / ctrlN) * 100).toFixed(0)}% 的随机币日也满足`);
console.log('⇒ 这个数越接近 100%，判据越接近"什么都不筛"');
