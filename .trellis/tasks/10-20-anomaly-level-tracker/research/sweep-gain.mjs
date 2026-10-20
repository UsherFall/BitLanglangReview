/**
 * 上一轮（sweep-bottom.mjs）发现问题不在"在哪拉"（起点位置怎么调都只覆盖 9~18/36），
 * 而在"拉了多少"（用户 36 段里 28 段涨幅在 15%~80%，今日候选中位 108%）。
 *
 * 这一版把"涨幅上限"当主条件，再叠一个"现在回到这波涨幅的几成"（fromBase）。
 * 输出每一档的：今日命中数、覆盖用户段数、随机日命中率（同币对照）。
 *
 * Run: node .trellis/tasks/10-20-anomaly-level-tracker/research/sweep-gain.mjs
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

/** 找"这波拉升"，返回涨幅 / 现在回到几成 / 顶后回吐 */
function shape(arr, E, LOOKBACK = 90) {
  if (E < LOOKBACK + 5) return null;
  const from = E - LOOKBACK;
  let best = null;
  let lo = from;
  let loC = arr[from].c;
  for (let i = from; i <= E; i++) {
    if (arr[i].c < loC) { loC = arr[i].c; lo = i; }
    const g = (arr[i].h - loC) / loC;
    if (g >= 0.1 && i - lo + 1 >= 3 && (!best || g > best.gain)) best = { sAt: lo, pAt: i, gain: g };
  }
  if (!best) return null;
  const { sAt, pAt } = best;
  const base = arr[Math.max(0, sAt - 1)].c;
  const peak = arr.slice(sAt, pAt + 1).reduce((m, b) => Math.max(m, b.h), -Infinity);
  const now = arr[E].c;
  let L = arr[pAt].l;
  for (let i = pAt; i <= E; i++) L = Math.min(L, arr[i].l);
  return {
    s0: arr[sAt].d,
    p: arr[pAt].d,
    gain: (peak - base) / base,
    fromBase: (now - base) / (peak - base || 1),
    giveback: (peak - L) / (peak - base),
    holdDays: E - pAt,
    peak,
    now,
    brokeOut: Math.max(...arr.slice(pAt, E + 1).map((b) => b.h)) > peak * 1.0001,
  };
}

// 用户段（用用户自己的起点）
const mine = [];
for (const g of ann) {
  const arr = bars.get(g.inst);
  if (!arr) continue;
  const a = arr.findIndex((x) => x.d === g.region[0]);
  const b = arr.findIndex((x) => x.d === g.region[1]);
  if (a < 30 || b < 0) continue;
  let s = a - 30;
  for (let i = a - 30; i < a; i++) if (arr[i].c < arr[s].c) s = i;
  const base = arr[s - 1].c;
  const peak = arr.slice(s, b + 1).reduce((m, x) => Math.max(m, x.h), -Infinity);
  mine.push({ key: `${g.inst.replace(/USDT$/, '')}@${g.region[1]}`, gain: (peak - base) / base, fromBase: (arr[b].c - base) / (peak - base || 1) });
}

const todayDay = [...bars.values()].map((a) => a[a.length - 1].d).sort().at(-1);
const today = [];
for (const [inst, arr] of bars) {
  const E = arr.findIndex((x) => x.d === todayDay);
  if (E < 0) continue;
  const s = shape(arr, E);
  if (s) today.push({ inst: inst.replace(/USDT$/, ''), ...s });
}

// 随机对照：同币随机日
let seed = 3;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const ctrl = [];
for (const g of ann) {
  const arr = bars.get(g.inst);
  if (!arr) continue;
  for (let k = 0; k < 15; k++) {
    const E = 100 + Math.floor(rnd() * (arr.length - 100));
    const s = shape(arr, E);
    if (s) ctrl.push(s);
  }
}

const pass = (o, x) => x.gain >= o.gMin && x.gain < o.gMax && (!o.fbMin || x.fromBase >= o.fbMin) && !(o.noBreak && x.brokeOut);

console.log(`你的 ${mine.length} 段 · 今日 ${today.length} 个 · 随机前一日样本 ${ctrl.length} 个\n`);
console.log(`${'涨幅区间'.padEnd(14)}${'回到几成>='.padEnd(12)}${'今日'.padStart(6)}${'覆盖你的段'.padStart(11)}${'随机'.padStart(6)}${'区分度'.padStart(8)}`);

const rows = [];
for (const [gMin, gMax] of [[0.1, 0.4], [0.1, 0.5], [0.15, 0.6], [0.2, 0.8], [0.3, 1.0], [0.1, 9]]) {
  for (const fbMin of [0, 0.5, 0.6, 0.7]) {
    for (const noBreak of [true, false]) {
      const o = { gMin, gMax, fbMin, noBreak };
      const n = today.filter((x) => pass(o, x)).length;
      const cov = mine.filter((x) => x.gain >= gMin && x.gain < gMax && (!fbMin || x.fromBase >= fbMin)).length;
      // 随机基线：同一条件在随机日上的占比
      const cRate = ctrl.filter((x) => pass(o, x)).length / (ctrl.length || 1);
      const covRate = cov / mine.length;
      rows.push({ gMin, gMax, fbMin, noBreak, n, cov, cRate, covRate });
      console.log(
        `${(gMin + '~' + gMax).padEnd(14)}${String(fbMin).padEnd(12)}${String(n).padStart(6)}${String(cov + '/' + mine.length).padStart(11)}${(cRate * 100).toFixed(0).padStart(5) + '%'}${(covRate / (cRate || 1e-9)).toFixed(1).padStart(7)}x${noBreak ? '  不报突破' : ''}`,
      );
    }
  }
}

console.log('\n候选数 10~45 且覆盖最高的：');
const good = rows.filter((r) => r.n >= 10 && r.n <= 45).sort((a, b) => b.cov - a.cov || a.n - b.n);
for (const r of good.slice(0, 8)) {
  console.log(`  涨幅 ${(r.gMin * 100) | 0}~${(r.gMax * 100) | 0}% · 回到${(r.fbMin * 100) | 0}%+ ${r.noBreak ? '· 不报突破' : ''} → 今日 ${r.n} 个，覆盖 ${r.cov}/${mine.length}，区分度 ${(r.covRate / (r.cRate || 1e-9)).toFixed(1)}x`);
}

fs.writeFileSync(path.join(DIR, 'out', 'gain-sweep.json'), JSON.stringify({ mine, today, ctrl, rows }, null, 1));
