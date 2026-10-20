/**
 * A1/A2：粗筛重做
 *
 * 问题（recall-audit.md）：
 *   现口径「回看90根有涨幅>=30%的拉升 + 顶后未破 + 回吐<=60%」
 *   → 每天 208/451 个（46%），等于没筛
 *   → 而且 ETH 那种"提前判断"的段结构上扫不到
 *
 * 新定义（A1 的候选）：
 *   「这个币最近有过一次拉升，并且从那之后还没破它的顶」
 *   —— 这是"值得画线"的最小条件，不判断好坏
 *
 * 关键设计：把"拉升"和"破顶"拆开看：
 *   ① 拉升段：近 N 根内，某个低点到某个高点，涨幅 X
 *   ② 破顶：从那个高点之后，价格有没有再创新高
 *   ③ 关键：拉升的"起点"要相对低（否则是高位拉）
 *
 * 参数都用相对量。这里扫描几个参数组合，看：
 *   - 召回（9 个"会做"段）
 *   - 规模（每天多少个）
 *   - 区分度（随机日命中率）
 *
 * Run: node .trellis/tasks/10-20-anomaly-level-tracker/research/sweep-screen.mjs
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

/**
 * 新口径：
 *   从 E 往回找最近一次"拉升"（低点到高点，涨幅 >= gainMin）
 *   然后判断：从那个高点之后到现在，价格有没有再创新高（broke）
 *   破顶的 -> 不要（已经走完了）
 *   没破顶的 -> 候选
 *
 * 额外的"相对低位"要求：拉升起点要低于前期的某个位置？
 *   用 basePos：拉升起点在"起点之前 lookbackPre 根"的高低区间里的位置
 */
function screen(arr, E, o) {
  const LB = o.lookback ?? 90;
  if (E < 60) return null;
  const from = Math.max(0, E - LB);
  let best = null;
  let lo = from;
  let loC = arr[from].c;
  for (let i = from; i <= E; i++) {
    if (arr[i].c < loC) { loC = arr[i].c; lo = i; }
    const g = (arr[i].h - loC) / loC;
    if (g >= (o.gainMin ?? 0.3) && (!best || g > best.gain)) best = { sAt: lo, pAt: i, gain: g };
  }
  if (!best) return null;
  const { sAt, pAt } = best;
  const base = arr[Math.max(0, sAt - 1)].c;
  const peak = arr.slice(sAt, pAt + 1).reduce((m, b) => Math.max(m, b.h), -Infinity);
  const after = arr.slice(pAt + 1, E + 1);   // 顶之后（不含顶那根）
  const broke = after.length ? Math.max(...after.map((b) => b.h)) > peak : false;
  if (o.noBroke && broke) return null;

  // 起点相对低？（起点在"更长的历史区间"里的位置，0=最底）
  const preWin = arr.slice(Math.max(0, sAt - (o.lookbackPre ?? 150)), sAt + 1);
  const hi = Math.max(...preWin.map((b) => b.h));
  const loP = Math.min(...preWin.map((b) => b.l));
  const basePos = (base - loP) / (hi - loP || 1);
  if (o.maxBasePos != null && basePos > o.maxBasePos) return null;

  // 顶后回吐（用来排除"拉完就废掉"的）
  let L = arr[pAt].l;
  for (let i = pAt; i <= E; i++) L = Math.min(L, arr[i].l);
  const giveback = (peak - L) / (peak - base);
  if (o.maxGiveback != null && giveback > o.maxGiveback) return null;

  // 顶后时间（多久了）
  const holdDays = E - pAt;
  if (o.minHold != null && holdDays < o.minHold) return null;
  if (o.maxHold != null && holdDays > o.maxHold) return null;

  return { s0: arr[sAt].d, p: arr[pAt].d, gain: best.gain, basePos, giveback, holdDays, peak, broke };
}

const labels = JSON.parse(fs.readFileSync(path.join(DIR, 'draw', 'labels.json'), 'utf8'));
const want = [];
for (const c of labels) {
  for (const s of c.segments ?? []) {
    if (!s.region || s.verdict !== 'good') continue;
    want.push({ inst: c.inst.replace(/USDT$/, ''), full: c.inst, region: s.region });
  }
}

const allDays = [...new Set([...bars.values()].flatMap((a) => a.map((b) => b.d)))].sort();
const sample = allDays.slice(-20);

// 参数组合
const CONFIGS = [];
for (const gainMin of [0.3, 0.4, 0.5]) {
  for (const maxBasePos of [null, 0.4, 0.6]) {
    for (const minHold of [3, 10, 20]) {
      CONFIGS.push({ gainMin, maxBasePos, minHold, noBroke: true });
    }
  }
}

console.log(`池 ${bars.size}；你要的 9 段\n`);
console.log(`${'gain'.padEnd(7)}${'起点位置<'.padEnd(11)}${'顶后≥'.padEnd(8)}${'召回'.padStart(6)}${'规模'.padStart(7)}${'随机日'.padStart(8)}  漏`);

let seed = 9;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

const results = [];
for (const o of CONFIGS) {
  // 召回：区间末那天 + 区间内任一天
  let hitEnd = 0;
  let hitAny = 0;
  const miss = [];
  for (const w of want) {
    const arr = bars.get(w.full);
    if (!arr) { miss.push(w.inst + '(无数据)'); continue; }
    const b = arr.findIndex((x) => x.d === w.region[1]);
    const a = arr.findIndex((x) => x.d === w.region[0]);
    if (b >= 0 && screen(arr, b, o)) hitEnd++;
    let any = false;
    if (a >= 0 && b >= 0) for (let i = a; i <= b; i++) if (screen(arr, i, o)) { any = true; break; }
    if (any) hitAny++; else miss.push(w.inst);
  }
  // 规模
  const counts = [];
  for (const d of sample) {
    let n = 0;
    for (const arr of bars.values()) {
      const E = arr.findIndex((x) => x.d === d);
      if (E >= 0 && screen(arr, E, o)) n++;
    }
    counts.push(n);
  }
  counts.sort((x, y) => x - y);
  const med = counts[Math.floor(counts.length / 2)];
  // 随机日
  let ctrlHit = 0;
  let ctrlN = 0;
  for (const arr of bars.values()) {
    for (let k = 0; k < 3; k++) {
      const E = 60 + Math.floor(rnd() * (arr.length - 60));
      ctrlN++;
      if (screen(arr, E, o)) ctrlHit++;
    }
  }
  const ctrlRate = ctrlHit / ctrlN;
  results.push({ o, hitEnd, hitAny, med, ctrlRate, miss });
  console.log(
    `${(o.gainMin * 100).toFixed(0).padEnd(7)}${String(o.maxBasePos ?? '-').padEnd(11)}${String(o.minHold).padEnd(8)}${String(hitAny).padStart(6)}${String(med).padStart(7)}${(ctrlRate * 100).toFixed(0).padStart(7)}%  ${[...new Set(miss)].join(', ')}`,
  );
}

console.log('\n候选（规模<=30 且 召回>=7）：');
for (const r of results.filter((x) => x.med <= 30 && x.hitAny >= 7).sort((a, b) => b.hitAny - a.hitAny || a.med - b.med)) {
  console.log(`  gain=${r.o.gainMin} 起点位<${r.o.maxBasePos ?? '-'} 顶后>=${r.o.minHold}d → 规模 ${r.med}，召回 ${r.hitAny}/9，随机日 ${(r.ctrlRate * 100).toFixed(0)}%  漏:${[...new Set(r.miss)].join(',')}`);
}
