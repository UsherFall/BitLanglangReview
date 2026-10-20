/**
 * 检验用户的心得：**打到压力位 → 砸下来 → 再拉上去收敛 = 最该关注**
 *
 * 数据 = 用户亲手画的 34 张卡 / 38 段（36 个 good，2 个 structure）。
 * 每段有：好区间（region）、结论（verdict）、他画的压力位线（水平）或突破方向（射线）。
 *
 * 方法：对每段算出若干个"三段式"特征，然后看
 *   ① 这些特征在 good 里是否有明显倾向（中位数 / 分位）
 *   ② 能不能把 2 个 structure 排除掉
 * 注意：负例只有 2 个，任何"分得开"都可能只是巧合——所以这里只报分布，
 * 不下"能分开"的结论，等负例多了再说。
 *
 * Run: POOL_DIR=<dir> node .scratch/research-10-19/check-pattern.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const POOL_DIR = process.env.POOL_DIR;
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
const DAY = 86_400_000;

const bars = new Map();
for (const f of fs.readdirSync(POOL_DIR)) {
  if (!f.endsWith('.json')) continue;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(POOL_DIR, f), 'utf8'));
    if (Array.isArray(raw) && raw.length >= 120) {
      bars.set(f.replace(/\.json$/, ''), raw.map(([t, o, h, l, c]) => ({ t, o, h, l, c, d: dayOf(t) })));
    }
  } catch { /* skip */ }
}
console.log(`pool ${bars.size}`);

const idxOf = (arr, d) => arr.findIndex((b) => b.d === d);

/** 从 region 里取出那几根。 */
function segBars(arr, region) {
  const a = idxOf(arr, region[0]);
  const b = idxOf(arr, region[1]);
  if (a < 0 || b < 0) return null;
  return { from: a, to: b, bars: arr.slice(a, b + 1) };
}

/**
 * 三条核心特征（用户口述的三段式）：
 *   压力位 level  —— 他画的水平线（没画就用这段的最高价）
 *   碰了几次      —— 这段之前，价格碰到这个位（±1.5% 内）的 K 线簇数
 *   砸下来多深    —— 从最后一次碰到压力位，到之后的低点，回落多少（相对压力位）
 *   再拉上来多少  —— 从那个低点到现在，回来了多少
 */
function analyse(arr, seg, level) {
  const from = seg.from;
  const lookback = 90;
  const start = Math.max(0, from - lookback);
  const tol = 0.015; // ±1.5% 内算"碰到"
  const hits = [];
  for (let i = start; i < from; i++) {
    if (arr[i].h >= level * (1 - tol)) hits.push(i);
  }
  // 把连续的被碰的 K 线并成"一次"
  const touches = [];
  for (const i of hits) {
    if (!touches.length || i - touches[touches.length - 1].last > 3) touches.push({ first: i, last: i });
    else touches[touches.length - 1].last = i;
  }
  const touchCount = touches.length;
  // 最后一次碰到之后的低点（"砸下来"）
  const lastTouch = touches.length ? touches[touches.length - 1].last : start;
  let low = Infinity;
  let lowIdx = lastTouch;
  for (let i = lastTouch; i <= seg.to; i++) if (arr[i].l < low) { low = arr[i].l; lowIdx = i; }
  const dropPct = low < Infinity ? ((level - low) / level) * 100 : null;
  // 从低点回到现在
  const now = arr[seg.to].c;
  const recoverPct = low < Infinity ? ((now - low) / low) * 100 : null;
  // 这段本身的宽度
  const hi = Math.max(...seg.bars.map((b) => b.h));
  const lo = Math.min(...seg.bars.map((b) => b.l));
  const widthPct = ((hi - lo) / lo) * 100;
  // 这段离压力位多近（收盘价相对压力位）
  const distPct = ((level - now) / level) * 100;
  return { touchCount, dropPct, recoverPct, widthPct, distPct, lowIdx };
}

const ann = JSON.parse(fs.readFileSync('annotations-34.json', 'utf8'));
const rows = [];
for (const card of ann) {
  const arr = bars.get(card.inst);
  if (!arr) continue;
  for (const g of card.segments ?? []) {
    if (!g.region || !g.verdict) continue;
    const seg = segBars(arr, g.region);
    if (!seg) continue;
    const hLine = (g.lines ?? []).find((L) => L.kind === 'h');
    const level = hLine ? hLine.price : Math.max(...seg.bars.map((b) => b.h));
    const f = analyse(arr, seg, level);
    rows.push({
      inst: card.inst.replace(/USDT$/, ''),
      region: g.region.join('~'),
      verdict: g.verdict,
      level,
      hasLine: !!hLine,
      ...f,
    });
  }
}

const good = rows.filter((r) => r.verdict === 'good');
const bad = rows.filter((r) => r.verdict === 'structure');
console.log(`\n样本：good ${good.length}，structure ${bad.length}`);

const med = (xs) => {
  const a = xs.filter((x) => x != null && Number.isFinite(x)).sort((p, q) => p - q);
  return a.length ? a[Math.floor(a.length / 2)] : NaN;
};
const qs = (xs, p) => {
  const a = xs.filter((x) => x != null && Number.isFinite(x)).sort((p2, q2) => p2 - q2);
  return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : NaN;
};

console.log(`\n${'特征'.padEnd(14)}${'good 中位'.padStart(11)}${'good p25'.padStart(10)}${'good p75'.padStart(10)}${'structure'.padStart(22)}`);
for (const [name, key, unit] of [
  ['碰到压力位次数', 'touchCount', '次'],
  ['砸下来多深', 'dropPct', '%'],
  ['再拉上来多少', 'recoverPct', '%'],
  ['这段宽度', 'widthPct', '%'],
  ['离压力位', 'distPct', '%'],
]) {
  const g = good.map((r) => r[key]);
  const b = bad.map((r) => r[key]);
  console.log(
    `${name.padEnd(14)}${(med(g).toFixed(1) + unit).padStart(11)}${(qs(g, 0.25).toFixed(1) + unit).padStart(10)}${(qs(g, 0.75).toFixed(1) + unit).padStart(10)}${('  ' + b.map((x) => x.toFixed(1) + unit).join(' / ')).padStart(22)}`,
  );
}

console.log('\n逐条（按"碰到几次"排序）：');
console.log(`${'币'.padEnd(11)}${'区间'.padEnd(24)}${'结论'.padEnd(11)}${'碰次'.padStart(5)}${'砸下%'.padStart(8)}${'回升%'.padStart(8)}${'宽度%'.padStart(8)}${'离位%'.padStart(8)}${'线'}`);
for (const r of rows.sort((a, b) => b.touchCount - a.touchCount)) {
  console.log(
    `${r.inst.padEnd(11)}${r.region.padEnd(24)}${r.verdict.padEnd(11)}${String(r.touchCount).padStart(5)}${r.dropPct.toFixed(1).padStart(8)}${r.recoverPct.toFixed(1).padStart(8)}${r.widthPct.toFixed(1).padStart(8)}${r.distPct.toFixed(1).padStart(8)}${r.hasLine ? '✓' : '—'}`,
  );
}

fs.writeFileSync('.scratch/research-10-19/pattern-features.json', JSON.stringify(rows, null, 2));
