/**
 * 组合排序：单一指标排不进前 20 的那些，换组合试试。
 *
 * rank-spread 显示：
 *   "离 90 根高点近" 覆盖 9/9 需 N=132，中位排名 16
 *   你的 9 个排名：BNB:1 BTC:8 OPG:11 LINEA:11 ETH:16 ZRX:19 APT:43 BAND:84 RENDER:132
 *   → 前 20 能进 7 个，卡在 BAND / RENDER
 *
 * diag-badrank 显示 BAND/RENDER 的"位置"其实很好（pos60 0.81/0.77），
 * 排名差是因为那天它们离高点远一点 —— 单指标不够。
 *
 * 这里试几个组合（每个分量都相对该币自身），看能不能把 9 个都压进前 20~30。
 *
 * Run: node .trellis/tasks/10-20-anomaly-level-tracker/research/sweep-combo.mjs
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

function parts(arr, E) {
  const w30 = arr.slice(Math.max(0, E - 30), E + 1);
  const w60 = arr.slice(Math.max(0, E - 60), E + 1);
  const w90 = arr.slice(Math.max(0, E - 90), E + 1);
  const pos = (w) => {
    const hi = Math.max(...w.map((b) => b.h)), lo = Math.min(...w.map((b) => b.l));
    return (arr[E].c - lo) / (hi - lo || 1);
  };
  const ret = (n) => (arr[E].c - arr[Math.max(0, E - n)].c) / arr[Math.max(0, E - n)].c;
  const hi90 = Math.max(...w90.map((b) => b.h));
  return {
    pos30: pos(w30),
    pos60: pos(w60),
    pos90: pos(w90),
    toHigh90: 1 - (hi90 - arr[E].c) / hi90,
    ret5: ret(5),
    ret10: ret(10),
    ret30: ret(30),
  };
}

const COMBOS = {
  'pos60': (p) => p.pos60,
  'pos60 + 0.3*toHigh90': (p) => p.pos60 + 0.3 * p.toHigh90,
  'pos90 + 0.3*ret30': (p) => p.pos90 + 0.3 * p.ret30,
  'pos60 + 0.2*ret10 + 0.2*toHigh90': (p) => p.pos60 + 0.2 * p.ret10 + 0.2 * p.toHigh90,
  '0.5*pos90+0.3*pos30+0.2*toHigh90': (p) => 0.5 * p.pos90 + 0.3 * p.pos30 + 0.2 * p.toHigh90,
  'max(pos30,pos60,pos90)': (p) => Math.max(p.pos30, p.pos60, p.pos90),
  'pos60 + 0.3*ret5': (p) => p.pos60 + 0.3 * p.ret5,
  'pos60 + 0.4*ret10': (p) => p.pos60 + 0.4 * p.ret10,
};

console.log(`池 ${bars.size}；9 段。取前 N，覆盖全部 9 段需要的 N：\n`);
console.log(`${'组合'.padEnd(30)}${'需N'.padStart(6)}${'≤20命中'.padStart(9)}${'≤30命中'.padStart(9)}${'≤50命中'.padStart(9)}  各段排名`);

for (const [name, fn] of Object.entries(COMBOS)) {
  const ranks = [];
  const detail = [];
  for (const w of want) {
    const arr = bars.get(w.full);
    if (!arr) continue;
    const d = w.region[1];
    const scored = [];
    for (const [inst, ar] of bars) {
      const E = ar.findIndex((x) => x.d === d);
      if (E < 0) continue;
      scored.push({ inst, v: fn(parts(ar, E)) });
    }
    scored.sort((x, y) => y.v - x.v);
    const rank = scored.findIndex((x) => x.inst === w.full) + 1;
    if (rank > 0) ranks.push(rank);
    detail.push(`${w.inst}:${rank}`);
  }
  ranks.sort((a, b) => a - b);
  const need = ranks.length ? Math.max(...ranks) : 0;
  const c20 = ranks.filter((r) => r <= 20).length;
  const c30 = ranks.filter((r) => r <= 30).length;
  const c50 = ranks.filter((r) => r <= 50).length;
  console.log(`${name.padEnd(30)}${String(need).padStart(6)}${String(c20).padStart(9)}${String(c30).padStart(9)}${String(c50).padStart(9)}  ${detail.join(' ')}`);
}
