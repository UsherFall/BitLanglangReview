/**
 * 「拉起后才算横盘」：只用你的话能验证的两件事。
 *
 * 用户 10/19 的原话：
 *   "NEAR 不对，他那个底部盘整我是不会去看的，拉起来后收敛才会看"
 *   "区间 3 根是可以的，日线级别还是比较大"
 *
 * 所以量两个数（都对每一只币的每一天算，用全池）：
 *   1. 这段横盘之前，20 根日线里有没有一波 ≥20% 的上涨？（有 = 拉起后）
 *   2. 这段横盘本身：区间内最高/最低的宽度（%）和根数
 * 然后看：现有扫描器（detectConvergence）在这些"拉起后横盘"里出了多少，
 * 以及"看到今天"的扫描器漏掉了多少（横盘已经过去、今天不在横盘里）。
 *
 * Run: POOL_DIR=<dir> node <this>
 */
import fs from 'node:fs';
import path from 'node:path';

const POOL_DIR = process.env.POOL_DIR;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const bars = new Map();
for (const f of fs.readdirSync(POOL_DIR)) {
  if (!f.endsWith('.json')) continue;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(POOL_DIR, f), 'utf8'));
    if (Array.isArray(raw) && raw.length >= 100) bars.set(f.replace(/\.json$/, ''), raw.map(([t, o, h, l, c]) => ({ t, o, h, l, c })));
  } catch { /* skip */ }
}
console.log(`pool ${bars.size}`);

/** widest 3-day box ending at E, and how much it already rallied before it. */
function boxAt(arr, E, len = 3) {
  if (E - len + 1 < 20) return null;
  const w = arr.slice(E - len + 1, E + 1);
  const hi = Math.max(...w.map((b) => b.h));
  const lo = Math.min(...w.map((b) => b.l));
  const width = (hi - lo) / hi;
  const lead = arr.slice(E - len - 19, E - len + 1);
  const leadLow = Math.min(...lead.map((b) => b.l));
  const leadHigh = Math.max(...lead.map((b) => b.h));
  const rally = (leadHigh / leadLow - 1) * 100;
  return { hi, lo, width, rally };
}

// how common is each shape, and where does the box sit relative to the prior 60 days?
const buckets = { noRally: 0, rally20: 0, total: 0, rally20Low: 0 };
for (const arr of bars.values()) {
  for (let E = 60; E < arr.length; E++) {
    const b = boxAt(arr, E);
    if (!b) continue;
    if (b.width > 0.06) continue; // 只算"像横盘"的：3 根盘 6% 以内
    buckets.total++;
    if (b.rally >= 20) buckets.rally20++;
    else buckets.noRally++;
    const win = arr.slice(Math.max(0, E - 59), E + 1);
    const wlo = Math.min(...win.map((x) => x.l));
    const whi = Math.max(...win.map((x) => x.h));
    const pos = whi > wlo ? (arr[E].c - wlo) / (whi - wlo) : 0.5;
    if (b.rally >= 20 && pos < 0.5) buckets.rally20Low++;
  }
}
const p = (a) => `${((a / buckets.total) * 100).toFixed(1)}%`;
console.log(`\n3 根横盘窗口（宽度 ≤6%）共 ${buckets.total} 个币·日`);
console.log(`  前面 20 根里涨过 ≥20%（拉起后横盘）  ${buckets.rally20} = ${p(buckets.rally20)}`);
console.log(`  前面 20 根里涨不到 20%（盘底）      ${buckets.noRally} = ${p(buckets.noRally)}`);
console.log(`  拉起后横盘、但已从 60 日高点跌回一半以下（横盘在后段）  ${buckets.rally20Low} = ${p(buckets.rally20Low)}`);

// the six coins the user is reviewing, around their marked dates
const WATCH = [
  ['OPUSDT', '2026-10-10'],
  ['ZECUSDT', '2026-05-20'],
  ['AZTECUSDT', '2026-09-18'],
  ['BERAUSDT', '2026-08-31'],
  ['NEARUSDT', '2026-08-25'],
  ['NIGHTUSDT', '2026-08-19'],
];
console.log(`\n你圈的那几根，当时的横盘宽度 / 之前 20 根涨幅：`);
for (const [inst, date] of WATCH) {
  const arr = bars.get(inst);
  if (!arr) continue;
  const t = Date.parse(`${date}T00:00:00Z`) + 86399999;
  let E = -1;
  for (let i = 0; i < arr.length; i++) if (arr[i].t <= t) E = i;
  if (E < 30) continue;
  const out = [];
  for (let k = 0; k <= 4; k++) {
    const b = boxAt(arr, E - k);
    if (b) out.push(`${iso(arr[E - k].t).slice(5)} 宽 ${(b.width * 100).toFixed(1)}% 前涨 ${b.rally.toFixed(0)}%`);
  }
  console.log(`  ${inst.padEnd(10)} ${out.join(' | ')}`);
}
