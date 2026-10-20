/**
 * 粗筛 v2：先找「异动拉升」，再看它之后「有没有横住」——横盘段就是用户要标的那个区间。
 *
 * v1 用「区间末现在正好在拉升里」来判，所以横盘段全漏。
 * 用户的区间本身就是拉升之后的横盘，所以顺序应该是：
 *   ① 找拉升：一段涨幅明显的上涨（S 起 → P 顶）
 *   ② 拉升之后有没有横：P 之后到现在，回调不深、横的时间够
 *   ③ 交出去的「区间」= 拉升起始日 → 今天（用户在这个范围里标压力位）
 *
 * 评估：
 *   覆盖 = 用户标注的区间末那天，能否挂在一个"拉升 → 横盘"上
 *   对照 = 同币随机日
 *
 * 全部相对量。参数（环境变量）：MIN_GAIN / MAX_HOLD / MIN_VOL
 *
 * Run: node .trellis/tasks/10-20-anomaly-level-tracker/research/scan-rally2.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = '.trellis/tasks/10-20-anomaly-level-tracker/research';
const dayOf = (t) => new Date(Number(t)).toISOString().slice(0, 10);

const LOOKBACK = Number(process.env.LOOKBACK ?? 90);
let MIN_GAIN = Number(process.env.MIN_GAIN ?? 0.25);
let MAX_HOLD = Number(process.env.MAX_HOLD ?? 1);
let MIN_VOL = Number(process.env.MIN_VOL ?? 1.2);

const bars = new Map();
for (const f of fs.readdirSync(path.join(DIR, 'pool'))) {
  if (!f.endsWith('.json')) continue;
  const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'pool', f), 'utf8'));
  if (raw.length >= 150) {
    bars.set(f.replace(/\.json$/, ''), raw.map(([t, o, h, l, c, v]) => ({ t: Number(t), o, h, l, c, v: Number(v), d: dayOf(t) })));
  }
}
const ann = JSON.parse(fs.readFileSync(path.join(DIR, 'labels.json'), 'utf8'));

function mean(xs) {
  const v = xs.filter(Number.isFinite);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
}

/** 在 E 这天往回找：最近的拉升段 + 它之后的横盘。只往前看，无未来函数。 */
function findRallyThenHold(arr, E) {
  if (E < 120) return null;
  const from = Math.max(1, E - LOOKBACK);

  // ① 拉升：[from, E] 内"从某低点到某高点"的最大涨幅段
  let best = null;
  let lo = from;
  let loC = arr[from].c;
  for (let i = from; i <= E; i++) {
    if (arr[i].c < loC) { loC = arr[i].c; lo = i; }
    const g = (arr[i].h - loC) / loC;
    if (g >= MIN_GAIN && i - lo + 1 >= 2 && (!best || g > best.gain)) best = { sAt: lo, pAt: i, gain: g };
  }
  if (!best) return null;
  const { sAt, pAt } = best;
  const P = arr.slice(sAt, pAt + 1).reduce((m, b) => Math.max(m, b.h), -Infinity);
  const base = arr[Math.max(0, sAt - 1)].c;

  // ② 拉升之后横住：P 之后的最低价相对拉升起点不能太差
  let L = arr[pAt].l;
  for (let i = pAt; i <= E; i++) L = Math.min(L, arr[i].l);
  const giveback = (P - L) / (P - base);
  if (giveback > MAX_HOLD) return null;

  // 量比（池里没成交量时跳过）
  const volIn = mean(arr.slice(sAt, pAt + 1).map((b) => b.v));
  const volPre = mean(arr.slice(Math.max(0, sAt - 60), sAt).map((b) => b.v));
  const volRatio = volPre > 0 ? volIn / volPre : NaN;
  if (Number.isFinite(volRatio) && volRatio > 0 && !(volRatio >= MIN_VOL)) return null;

  const holdDays = E - pAt;
  if (holdDays < 1) return null;
  return { s0: arr[sAt].d, p: arr[pAt].d, e: arr[E].d, gain: best.gain, volRatio, giveback, holdDays, days: E - sAt + 1 };
}

let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

function evaluate(tag) {
  let covered = 0;
  const miss = [];
  for (const g of ann) {
    const arr = bars.get(g.inst);
    if (!arr) { miss.push(`${g.inst}(无数据)`); continue; }
    const b = arr.findIndex((x) => x.d === g.region[1]);
    if (b < 0) { miss.push(`${g.inst.replace(/USDT$/, '')}@${g.region[1]}(无该日)`); continue; }
    const r = findRallyThenHold(arr, b);
    if (r && r.s0 <= g.region[0]) covered++;
    else miss.push(`${g.inst.replace(/USDT$/, '')}@${g.region[1]}`);
  }
  let ctrlHit = 0;
  let ctrlN = 0;
  seed = 7;
  for (const g of ann) {
    const arr = bars.get(g.inst);
    if (!arr) continue;
    for (let k = 0; k < 20; k++) {
      const E = 120 + Math.floor(rnd() * (arr.length - 120));
      ctrlN++;
      if (findRallyThenHold(arr, E)) ctrlHit++;
    }
  }
  const prec = ctrlHit / ctrlN;
  const cov = covered / ann.length;
  console.log(
    `${tag.padEnd(26)}覆盖 ${String(covered).padStart(2)}/${ann.length}=${String((cov * 100).toFixed(0)).padStart(3)}%   随机 ${(prec * 100).toFixed(0).padStart(2)}%   区分度 ${(cov / (prec || 1e-9)).toFixed(1)}x`,
  );
  return { covered, prec, miss, cov };
}

console.log('粗筛 v2：拉升 → 横住（覆盖 38 段，区间末那天）\n');
const results = [];
for (const gain of [0.15, 0.25, 0.35]) {
  for (const hold of [0.4, 0.6, 0.8, 1.0]) {
    MIN_GAIN = gain;
    MAX_HOLD = hold;
    MIN_VOL = 0;
    results.push({ gain, hold, ...evaluate(`拉升>=${(gain * 100).toFixed(0)}% · 回吐<=${(hold * 100).toFixed(0)}%`) });
  }
}

const best = results.reduce((a, b) => (b.covered > a.covered ? b : a));
console.log(`\n最好一组：拉升>=${(best.gain * 100) | 0}% 回吐<=${(best.hold * 100) | 0}%（覆盖 ${best.covered}/38）`);
console.log('漏：' + best.miss.join(', '));
