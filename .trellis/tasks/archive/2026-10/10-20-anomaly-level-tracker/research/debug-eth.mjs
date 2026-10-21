/**
 * ETH 为什么在"不限回吐"的口径下都扫不到？（唯一一个 8/9 里的漏）
 * 逐日看 ETH 在你标的区间 07-27~08-17 里，各口径分别卡在哪。
 */
import fs from 'node:fs';
import path from 'node:path';
const DIR = '.trellis/tasks/10-20-anomaly-level-tracker/research';
const dayOf = (t) => new Date(Number(t) + 8 * 3600 * 1000).toISOString().slice(0, 10);
const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'pool', 'ETHUSDT.json'), 'utf8'));
const arr = raw.map(([t, o, h, l, c]) => ({ t: Number(t), o, h, l, c, d: dayOf(t) }));

console.log('ETH 在 07-20 ~ 08-20 的日线：');
const a = arr.findIndex((x) => x.d === '2026-07-20'), b = arr.findIndex((x) => x.d === '2026-08-20');
for (let i = a; i <= b; i++) {
  const prev = arr[i - 1].c;
  const pct = ((arr[i].c - prev) / prev) * 100;
  console.log(`  ${arr[i].d}  o ${arr[i].o} h ${arr[i].h} l ${arr[i].l} c ${arr[i].c}  ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`);
}

// 看看在区间末 08-17 那天，回看内最大的涨幅是多少
const E = arr.findIndex((x) => x.d === '2026-08-17');
for (const LB of [60, 90, 120, 150]) {
  let lo = Math.max(0, E - LB), loC = arr[lo].c, best = null;
  for (let i = lo; i <= E; i++) {
    if (arr[i].c < loC) { loC = arr[i].c; lo = i; }
    const g = (arr[i].h - loC) / loC;
    if (!best || g > best.gain) best = { gain: g, lo, hi: i };
  }
  console.log(`\n回看 ${LB} 根，到 08-17 为止最大涨幅 ${(best.gain * 100).toFixed(1)}%  (${arr[best.lo].d} → ${arr[best.hi].d})`);
}
