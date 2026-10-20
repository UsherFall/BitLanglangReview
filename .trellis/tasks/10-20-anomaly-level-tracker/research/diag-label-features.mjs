/**
 * 用户 10/20 的判定：日线只是筛导，真正判断看小级别。
 *
 * 那意味着粗筛的任务不是"猜好不好"，而是"别漏、别塞爆"。
 * 但眼下 17 个里你选了 8 个、否了 8 个，说明筛导本身还不够准。
 *
 * 本脚本只做一件事：把这 17 个按"你可能在意的那几类特征"分组，
 * 让"会做 vs 没标"的差别显形（不设判据、不下结论）。
 *
 * Run: node .trellis/tasks/10-20-anomaly-level-tracker/research/diag-label-features.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = '.trellis/tasks/10-20-anomaly-level-tracker/research';
const dayOf = (t) => new Date(Number(t) + 8 * 3600 * 1000).toISOString().slice(0, 10);

const labels = JSON.parse(fs.readFileSync(path.join(DIR, 'draw', 'labels.json'), 'utf8'));
const bars = new Map();
for (const f of fs.readdirSync(path.join(DIR, 'pool'))) {
  if (!f.endsWith('.json')) continue;
  const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'pool', f), 'utf8'));
  bars.set(f.replace(/\.json$/, ''), raw.map(([t, o, h, l, c]) => ({ t: Number(t), o, h, l, c, d: dayOf(t) })));
}

function features(arr, peakIdx, E) {
  const peak = Math.max(...arr.slice(Math.max(0, peakIdx - 3), peakIdx + 1).map((b) => b.h));
  const now = arr[E].c;
  const after = arr.slice(peakIdx, E + 1);
  const hi = Math.max(...after.map((b) => b.h));
  const lo = Math.min(...after.map((b) => b.l));

  // 1. 这波拉升之前，价格已经处在什么高度（"涨了很多波了"）
  const pre = arr.slice(Math.max(0, peakIdx - 150), peakIdx);
  const preHi = Math.max(...pre.map((b) => b.h));
  const preLo = Math.min(...pre.map((b) => b.l));
  const peakPosInPre = (peak - preLo) / (preHi - preLo || 1); // 1 = 这波顶就是历史最高

  // 2. 到顶之前涨了多久（连涨天数）
  let upBars = 0;
  for (let i = peakIdx; i > 0; i--) { if (arr[i].c >= arr[i - 1].c) upBars++; else break; }

  // 3. 顶后整理形态：波动收敛了吗（后半段振幅 vs 前半段）
  const half = Math.floor(after.length / 2);
  const amp = (s) => { const h = Math.max(...s.map((b) => b.h)), l = Math.min(...s.map((b) => b.l)); return (h - l) / l; };
  const conv = half >= 3 ? amp(after.slice(half)) - amp(after.slice(0, half)) : NaN;

  // 4. 顶后是否已经走出下降/上升通道（用首尾比较）
  const slope = after.length > 3 ? (now - after[0].c) / after[0].c : 0;

  return {
    gap: ((peak - now) / peak) * 100,       // 离顶 %
    pos: hi > lo ? (now - lo) / (hi - lo) : 1, // 顶后区间位置
    peakPosInPre: peakPosInPre * 100,        // 这波顶在"前 150 根区间"的位置
    upBars,
    conv: Number.isFinite(conv) ? conv * 100 : NaN,
    slope: slope * 100,
    afterBars: E - peakIdx,
  };
}

const rows = [];
for (const c of labels) {
  const arr = bars.get(c.inst);
  if (!arr) continue;
  const segs = c.segments ?? [];
  const verdict = segs[0]?.verdict ?? null;
  const nSeg = segs.length;
  // 用粗筛给的那波顶：从 note 里拿不到，用"区间开始前 90 根的最高"
  const region = segs[0]?.region;
  const E = arr.length - 1;
  let startIdx = region ? arr.findIndex((b) => b.d === region[0]) : E - 60;
  if (startIdx < 0) startIdx = E - 60;
  let peakIdx = Math.max(0, startIdx - 20);
  for (let i = Math.max(0, startIdx - 60); i < startIdx; i++) if (arr[i].h > arr[peakIdx].h) peakIdx = i;
  const f = features(arr, peakIdx, E);
  rows.push({ inst: c.inst.replace(/USDT$/, ''), verdict: verdict ?? (nSeg ? 'good?' : 'none'), note: (c.note || '').trim().slice(0, 30), ...f });
}

const med = (xs) => { const v = xs.filter(Number.isFinite).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : NaN; };
const yes = rows.filter((r) => r.verdict === 'good' || r.verdict === 'structure');
const no = rows.filter((r) => r.verdict === 'none');

console.log('=== 你做过判断的（含结构不行） vs 没标的 ===\n');
console.log(`${'量'.padEnd(22)}${'会做'.padStart(10)}${'没标'.padStart(10)}`);
for (const k of ['gap', 'pos', 'peakPosInPre', 'upBars', 'conv', 'slope', 'afterBars']) {
  console.log(`${k.padEnd(22)}${String(med(yes.map((x) => x[k]))).padStart(10)}${String(med(no.map((x) => x[k]))).padStart(10)}`);
}

console.log('\n=== 逐个（按 gap 排序） ===');
console.log(`${'币'.padEnd(8)}${'判定'.padEnd(10)}${'gap'.padStart(7)}${'位置'.padStart(7)}${'顶在高位'.padStart(9)}${'连涨'.padStart(6)}${'收敛'.padStart(8)}${'顶后斜率'.padStart(9)}${'顶后根'.padStart(7)}  备注`);
for (const r of rows.sort((a, b) => a.gap - b.gap)) {
  const v = { good: '会做', structure: '结构不行', none: '没标' }[r.verdict] ?? r.verdict;
  console.log(
    `${r.inst.padEnd(8)}${v.padEnd(10)}${r.gap.toFixed(1).padStart(7)}${r.pos.toFixed(2).padStart(7)}${r.peakPosInPre.toFixed(0).padStart(9)}${String(r.upBars).padStart(6)}${r.conv.toFixed(1).padStart(8)}${r.slope.toFixed(1).padStart(9)}${String(r.afterBars).padStart(7)}  ${r.note}`,
  );
}
