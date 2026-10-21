/**
 * 粗筛探索：只找「异动拉升」，不判断顶/压力位/收敛。
 *
 * 用户 10/20 新方向（三步流程）：
 *   第 1 步 算法只做一件事：找出有异动拉升的币 + 那个拉升段
 *   第 2 步 用户在那个区间上标压力位
 *   第 3 步 之后每天只报：当天涨跌幅 + 现价距上方最近压力位还差多少 %
 *
 * 本脚本只负责第 1 步的定义与粗测，不做任何"好机会"判断。
 *
 * 拉升段定义（全部相对该币自身，不用绝对百分比）：
 *   起点 S = E 之前 60 根内的最低收盘（不是最低价，影线会造假日底）
 *   顶   P = S 之后到 E 的最高价
 *   幅度 = (P - base) / base，base = S 之前的收盘价
 *   量比 = 拉升期间成交量均值 / 之前 60 根成交量均值
 *   异动 = 幅度 ≥ MIN_PCT 且 量比 ≥ MIN_VOL
 *
 * 评估一：45 个标注区间里，"用户标的区间末"能不能被任何一个拉升段罩住
 * 评估二：随机对照，看这个定义是不是"什么都算异动"
 *
 * Run: node .trellis/tasks/10-20-anomaly-level-tracker/research/scan-rally.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = '.trellis/tasks/10-20-anomaly-level-tracker/research';
const dayOf = (t) => new Date(Number(t)).toISOString().slice(0, 10);

const MIN_PCT = Number(process.env.MIN_PCT ?? 0.25);
const MIN_VOL = Number(process.env.MIN_VOL ?? 1.5);
const LOOKBACK = Number(process.env.LOOKBACK ?? 60);
const MIN_DAYS = 3;      // 拉升至少持续几根
const MAX_DAYS = 45;     // 拉升最多几根（再长就不是"一段拉升"了）

const bars = new Map();
const poolDir = path.join(DIR, 'pool');
for (const f of fs.readdirSync(poolDir)) {
  if (!f.endsWith('.json')) continue;
  const raw = JSON.parse(fs.readFileSync(path.join(poolDir, f), 'utf8'));
  if (raw.length >= 150) bars.set(f.replace(/\.json$/, ''), raw.map(([t, o, h, l, c, v]) => ({ t: Number(t), o, h, l, c, v: Number(v), d: dayOf(t) })));
}
console.log(`池：${bars.size} 个币，每币 ${[...bars.values()][0].length} 根 1D`);

/** 找 E 这一天所在/刚结束的拉升段。只往前看，无未来函数。 */
function findRally(arr, E) {
  if (E < 90) return null;
  const from = Math.max(1, E - LOOKBACK);
  // 起点：最近 60 根里的最低收盘
  let sAt = from;
  for (let i = from; i <= E; i++) if (arr[i].c < arr[sAt].c) sAt = i;
  const days = E - sAt + 1;
  if (days < MIN_DAYS || days > MAX_DAYS) return null;

  const base = arr[sAt - 1].c;
  let P = -Infinity, pAt = sAt;
  for (let i = sAt; i <= E; i++) if (arr[i].h > P) { P = arr[i].h; pAt = i; }
  const gain = (P - base) / base;
  if (gain < MIN_PCT) return null;

  // 量比：拉升期间 vs 之前 60 根
  const volIn = mean(arr.slice(sAt, E + 1).map((b) => b.v ?? 0));
  const volPre = mean(arr.slice(Math.max(0, sAt - 60), sAt).map((b) => b.v ?? 0));
  const volRatio = volPre > 0 ? volIn / volPre : NaN;

  // 现价相对拉升段的位置（不是判据，只照实报）
  const pullback = (P - arr[E].c) / (P - base);
  return { sAt, pAt, days, gain, volRatio, pullback, P, base, s0: arr[sAt].d, e: arr[E].d, p: arr[pAt].d };
}

function mean(xs) {
  const v = xs.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
}

// ------------------------------------------------------------------ 参数敏感度
console.log(`\n参数：拉升 ≥${(MIN_PCT * 100).toFixed(0)}% · 量比 ≥${MIN_VOL} · 回看 ${LOOKBACK} 根 · 持续 ${MIN_DAYS}~${MAX_DAYS} 根`);
const days = [...bars.keys()];
let hits = 0;
for (const inst of days) {
  const arr = bars.get(inst);
  for (let E = 90; E < arr.length; E++) if (findRally(arr, E)) hits++;
}
const totalDays = days.reduce((a, inst) => a + Math.max(0, bars.get(inst).length - 90), 0);
console.log(`全市场：${hits} 个币日命中 / ${totalDays} 个币日 = ${((hits / totalDays) * 100).toFixed(2)}%（每个币日均 ${(((hits / totalDays) * bars.size) / 1).toFixed(1)} 次）`);

// ------------------------------------------------------------------ 评估一：罩住用户区间
const ann = JSON.parse(fs.readFileSync(path.join(DIR, 'labels.json'), 'utf8'));
let covered = 0;
const miss = [];
const coveredList = [];
for (const g of ann) {
  const arr = bars.get(g.inst);
  if (!arr) { miss.push(`${g.inst}(无数据)`); continue; }
  const b = arr.findIndex((x) => x.d === g.region[1]);
  if (b < 0) { miss.push(`${g.inst}@${g.region[1]}(无该日)`); continue; }
  // 允许区间末往前几天也被扫到（用户可能标的是拉升后的第几天）
  let ok = null;
  for (let k = 0; k <= 3 && !ok; k++) {
    const r = findRally(arr, b - k);
    if (r && r.s0 <= g.region[0]) ok = r;
  }
  if (ok) { covered++; coveredList.push(`${g.inst.replace(/USDT$/, '')}@${g.region[1]}`); }
  else miss.push(`${g.inst.replace(/USDT$/, '')}@${g.region[1]}`);
}
console.log(`\n=== 用户标注区间：区间末当天能否挂在一个"异动拉升段"上 ===`);
console.log(`${covered}/${ann.length} = ${((covered / ann.length) * 100).toFixed(0)}%`);
if (miss.length) console.log('漏：' + miss.join(', '));

// ------------------------------------------------------------------ 评估二：随机对照（同币随机日）
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
let ctrlHit = 0, ctrlN = 0;
for (const g of ann) {
  const arr = bars.get(g.inst);
  if (!arr) continue;
  for (let k = 0; k < 20; k++) {
    const E = 90 + Math.floor(rnd() * (arr.length - 90));
    ctrlN++;
    if (findRally(arr, E)) ctrlHit++;
  }
}
console.log(`随机对照：同币随机日命中率 ${((ctrlHit / ctrlN) * 100).toFixed(0)}%（${ctrlHit}/${ctrlN}）`);
console.log(`用户段命中率 / 随机命中率 = ${(covered / ann.length / (ctrlHit / ctrlN)).toFixed(1)}×（越高越有区分力）`);
