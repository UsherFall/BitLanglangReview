/**
 * 用户 10/20：我最多看 20 个了。
 *
 * 那粗筛的目标就变成：给 20 个，且这 20 个里尽量没有一个"根本不用看"的。
 * 但"好不好"算法判不了（收敛/股性已确认失败），所以能做的只有：
 *   A. 只保留"最近真的拉过、且这波还在"的币（已有口径）
 *   B. 在 A 里按一个与"好不好"无关、但与你关注方式有关的量排出前 20
 *
 * 排序用什么？不能再用涨幅（已证伪）。这里把几个候选排序量都算出来，
 * 看它们各取前 20 会选进哪些币、和你的 17 个标注重合多少 —— 只作观察，不下结论。
 *
 * Run: node .trellis/tasks/10-20-anomaly-level-tracker/research/pick20.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = '.trellis/tasks/10-20-anomaly-level-tracker/research';
const dayOf = (t) => new Date(Number(t) + 8 * 3600 * 1000).toISOString().slice(0, 10);
const N = Number(process.env.N ?? 20);

const bars = new Map();
for (const f of fs.readdirSync(path.join(DIR, 'pool'))) {
  if (!f.endsWith('.json')) continue;
  const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'pool', f), 'utf8'));
  if (raw.length >= 150) bars.set(f.replace(/\.json$/, ''), raw.map(([t, o, h, l, c, v]) => ({ t: Number(t), o, h, l, c, v: Number(v), d: dayOf(t) })));
}

// 基准口径：沿用 build-tape 的"异动拉升"（涨幅≥30% & ≥4天 & 回吐≤60% & 不报突破），不掺涨幅上限
const LOOKBACK = 90;
function rally(arr, E) {
  if (E < LOOKBACK + 20) return null;
  const from = E - LOOKBACK;
  let best = null;
  let lo = from;
  let loC = arr[from].c;
  for (let i = from; i <= E; i++) {
    if (arr[i].c < loC) { loC = arr[i].c; lo = i; }
    const g = (arr[i].h - loC) / loC;
    if (g >= 0.3 && i - lo + 1 >= 4 && (!best || g > best.gain)) best = { sAt: lo, pAt: i, gain: g };
  }
  if (!best) return { none: true };
  const { sAt, pAt } = best;
  const base = arr[Math.max(0, sAt - 1)].c;
  const peak = arr.slice(sAt, pAt + 1).reduce((m, b) => Math.max(m, b.h), -Infinity);
  const now = arr[E].c;
  const after = arr.slice(pAt, E + 1);
  const hi = Math.max(...after.map((b) => b.h));
  const lo2 = Math.min(...after.map((b) => b.l));
  const brokeOut = hi > peak * 1.0001;
  let L = arr[pAt].l;
  for (let i = pAt; i <= E; i++) L = Math.min(L, arr[i].l);
  return {
    s0: arr[sAt].d, p: arr[pAt].d,
    gain: (peak - base) / base,
    fromPeak: (peak - now) / peak,
    fromBase: (now - base) / (peak - base || 1),
    holdDays: E - pAt,
    brokeOut,
    giveback: (peak - L) / (peak - base),
    // "最近动过"：近 5 根振幅 / 近 20 根振幅（越大 = 最近在动）
    recent: (Math.max(...arr.slice(E - 4, E + 1).map((b) => b.h)) - Math.min(...arr.slice(E - 4, E + 1).map((b) => b.l))) /
      (Math.max(...arr.slice(E - 19, E + 1).map((b) => b.h)) - Math.min(...arr.slice(E - 19, E + 1).map((b) => b.l)) || 1),
    vol: arr[E].v,
  };
}

const todayDay = [...bars.values()].map((a) => a[a.length - 1].d).sort().at(-1);
const all = [];
for (const [inst, arr] of bars) {
  const E = arr.findIndex((x) => x.d === todayDay);
  if (E < 0) continue;
  const r = rally(arr, E);
  if (!r || r.none) continue;
  if (r.brokeOut) continue;
  if (r.giveback > 0.6) continue;
  all.push({ inst: inst.replace(/USDT$/, ''), ...r });
}

console.log(`${todayDay}：满足"异动拉升 + 未突破 + 回吐≤60%"的共 ${all.length} 个，要挑出 ${N} 个\n`);

const labels = JSON.parse(fs.readFileSync(path.join(DIR, 'draw', 'labels.json'), 'utf8'));
const judged = new Map(labels.map((c) => [c.inst.replace(/USDT$/, ''), (c.segments ?? [])[0]?.verdict ?? null]));

const sorts = {
  '离顶最近（回踩浅）': (a, b) => a.fromPeak - b.fromPeak,
  '离顶最远（回踩深）': (a, b) => b.fromPeak - a.fromPeak,
  '最近 5 根最活跃': (a, b) => b.recent - a.recent,
  '最近 5 根最安静': (a, b) => a.recent - b.recent,
  '顶后横得最久': (a, b) => b.holdDays - a.holdDays,
};
console.log(`${'排序量'.padEnd(20)}前 ${N} 个里你标过的有几个（命中/9）  名单`);
for (const [name, cmp] of Object.entries(sorts)) {
  const top = [...all].sort(cmp).slice(0, N);
  const hit = top.filter((x) => judged.get(x.inst) === 'good' || judged.get(x.inst) === 'structure');
  const goodHit = top.filter((x) => judged.get(x.inst) === 'good');
  console.log(`${name.padEnd(20)}${String(hit.length).padStart(10)}/${9}  (会做 ${goodHit.length})   ${top.slice(0, 12).map((x) => x.inst).join(', ')}...`);
}

console.log('\n你这 9 个会做/结构不行，在全部候选里的位置：');
const byNear = [...all].sort((a, b) => a.fromPeak - b.fromPeak);
for (const inst of [...judged.entries()].filter(([, v]) => v).map(([k]) => k)) {
  const row = byNear.find((x) => x.inst === inst);
  if (!row) { console.log(`  ${inst.padEnd(8)} 不在基准口径里（可能已突破或回吐>60%）`); continue; }
  const rank = byNear.indexOf(row) + 1;
  console.log(`  ${inst.padEnd(8)} 离顶排序第 ${String(rank).padStart(3)} 名  离顶 ${(row.fromPeak * 100).toFixed(1)}%  最近活跃度 ${row.recent.toFixed(2)}`);
}
fs.writeFileSync(path.join(DIR, 'out', 'pick20.json'), JSON.stringify(all, null, 1));
