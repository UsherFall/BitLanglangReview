/**
 * 诊断：当前候选里，有多少是"已经拉起来、贴着顶/已突破"的？
 *
 * 用户 10/20 的反馈："这些有点像已经拉起来突破的币"。
 * 本脚本只用相对量（不引新阈值）把候选分档，看分布对不对得上他的感觉。
 *
 * Run: node .trellis/tasks/10-20-anomaly-level-tracker/research/diag-buckets.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = '.trellis/tasks/10-20-anomaly-level-tracker/research';
const list = JSON.parse(fs.readFileSync(path.join(DIR, 'out', 'rally-list.json'), 'utf8'));
const dayOf = (t) => new Date(Number(t)).toISOString().slice(0, 10);

const bars = new Map();
for (const f of fs.readdirSync(path.join(DIR, 'pool'))) {
  if (!f.endsWith('.json')) continue;
  const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'pool', f), 'utf8'));
  bars.set(f.replace(/\.json$/, ''), raw.map(([t, o, h, l, c]) => ({ t: Number(t), o, h, l, c, d: dayOf(t) })));
}

const out = [];
for (const r of list) {
  const arr = bars.get(`${r.inst}USDT`);
  if (!arr) continue;
  const E = arr.findIndex((b) => b.d === r.e);
  const p = arr.findIndex((b) => b.d === r.p);
  if (E < 0 || p < 0) continue;
  // 顶之后这段：最高价 / 最低价 / 今天收盘 落在哪
  const after = arr.slice(p, E + 1);
  const hi = Math.max(...after.map((b) => b.h));
  const lo = Math.min(...after.map((b) => b.l));
  const close = arr[E].c;
  // 突破前高了吗（顶之后创过新高）
  const brokeOut = hi > r.peak * 1.0001;
  // 现价在"顶后区间"里的位置 0=底 1=顶
  const pos = hi > lo ? (close - lo) / (hi - lo) : 1;
  // 顶后几根
  const n = E - p;
  out.push({ ...r, brokeOut, pos: +pos.toFixed(2), afterBars: n, afterHi: hi, afterLo: lo });
}

const bucket = (x) => (x.fromPeak <= 0 ? 'A 已破顶/创新高' : x.brokeOut ? 'B 顶后创过新高、现回落' : x.pos >= 0.7 ? 'C 顶后横在偏上位置' : 'D 顶后深处/回落明显');
const groups = {};
for (const x of out) {
  const k = bucket(x);
  (groups[k] ??= []).push(x);
}
console.log(`候选 ${out.length} 个，按"顶之后发生了什么"分档：\n`);
for (const k of Object.keys(groups).sort()) {
  const g = groups[k];
  console.log(`${k.padEnd(24)} ${String(g.length).padStart(3)} 个 (${((g.length / out.length) * 100).toFixed(0)}%)`);
  console.log(`   ${g.slice(0, 14).map((x) => `${x.inst}(${x.fromPeak > 0 ? '-' : '+'}${Math.abs(x.fromPeak)}%)`).join(', ')}`);
}

console.log('\n前 20 个候选的细节（按离顶排序）：');
console.log(`${'币'.padEnd(9)}${'离顶'.padStart(8)}${'顶后'.padStart(5)}${'顶后位置'.padStart(9)}${'顶后创高'.padStart(9)}`);
for (const x of out.slice(0, 20)) {
  console.log(`${x.inst.padEnd(9)}${(x.fromPeak + '%').padStart(8)}${String(x.afterBars).padStart(5)}${String(x.pos).padStart(9)}${(x.brokeOut ? '是' : '否').padStart(9)}`);
}

// 如果用户要的是"拉起来 → 回踩中 → 还没回到顶"，这一档有多少
const pullback = out.filter((x) => x.fromPeak > 8 && x.fromPeak < 30 && !x.brokeOut);
console.log(`\n"拉起来后回踩 8%~30% 且顶后没创过新高"：${pullback.length} 个`);
console.log('  ' + pullback.slice(0, 20).map((x) => `${x.inst}(${x.fromPeak}%)`).join(', '));
