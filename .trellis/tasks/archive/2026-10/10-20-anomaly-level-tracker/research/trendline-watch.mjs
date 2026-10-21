/**
 * 趋势线监视器（用户 10/20 定的形态）
 *
 * 用户决策：
 *   1. 趋势线由用户标，系统只算距离
 *   2. 触发 = 收盘价回到趋势线附近/上方
 *
 * 为什么这是对的（从 ETH 验证）：
 *   下降趋势线每天自己在降，所以价格哪怕原地不动，也会逐渐"贴近"它。
 *   之前用"涨幅/回吐/水平压力位"全都对不齐，是因为它们都是静态的。
 *
 * 本脚本对每个用户标注的段：
 *   - 逐日算 收盘价 vs 趋势线 的距离（%）
 *   - 找出"第一次从下方回到线附近/上方"的那天，报告它
 *
 * 注意：这里先不上阈值。先用 ETH/BTC 两条真实标注验证口径说得通，再定"附近"是多少。
 *
 * Run: node .trellis/tasks/10-20-anomaly-level-tracker/research/trendline-watch.mjs
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

function rayAt(r, ms) {
  const t1 = Number(r.p1.t), t2 = Number(r.p2.t);
  if (t2 === t1) return r.p2.price;
  return r.p2.price + ((r.p2.price - r.p1.price) / (t2 - t1)) * (ms - t2);
}

const labels = JSON.parse(fs.readFileSync(path.join(DIR, 'draw', 'labels.json'), 'utf8'));

console.log('用户标的趋势线：逐日距离 + 第一次"回到线上方"的日子\n');

for (const c of labels) {
  const arr = bars.get(c.inst);
  if (!arr) continue;
  for (const s of c.segments ?? []) {
    const rays = (s.lines ?? []).filter((l) => l.kind === 'r');
    if (!rays.length) continue;
    for (const ray of rays) {
      const t1 = Number(ray.p1.t);
      const a = arr.findIndex((x) => x.d === s.region[0]);
      const b = arr.findIndex((x) => x.d === s.region[1]);
      if (a < 0 || b < 0) continue;

      // 从线的 p1 那天开始算，往后看 40 天
      let start = arr.findIndex((x) => x.t >= t1);
      if (start < 0) start = a;
      const end = Math.min(arr.length - 1, Math.max(b, start) + 40);

      const series = [];
      for (let i = start; i <= end; i++) {
        const line = rayAt(ray, arr[i].t);
        series.push({
          d: arr[i].d,
          close: arr[i].c,
          line,
          dist: ((arr[i].c - line) / line) * 100,
          inRegion: i >= a && i <= b,
        });
      }

      const cross = series.find((x) => x.dist >= 0);
      console.log(`\n=== ${c.inst.replace(/USDT$/, '')}  区间 ${s.region.join('~')}  [${s.verdict === 'good' ? '会做' : s.verdict}] ===`);
      console.log(`  趋势线：${dayOf(t1)} 起，${(ray.p2.price < ray.p1.price) ? '下降' : '上升'}（${ray.p1.price.toFixed(4)} → ${ray.p2.price.toFixed(4)}）`);
      for (const x of series.filter((_, i) => i % 2 === 0 || Math.abs(_.dist) < 1)) {
        const mark = x.inRegion ? ' ' : '·';
        console.log(`  ${mark} ${x.d}  收 ${String(x.close).padStart(10)}  线 ${x.line.toFixed(4).padStart(10)}  距线 ${x.dist >= 0 ? '+' : ''}${x.dist.toFixed(2)}%`);
      }
      if (cross) {
        const after = series.filter((x) => x.d > cross.d);
        const maxAfter = after.length ? Math.max(...after.map((x) => x.dist)) : 0;
        console.log(`  ⇒ 第一次回到线上方：${cross.d}（距线 +${cross.dist.toFixed(2)}%）${cross.inRegion ? ' **在用户标注区间内**' : '（区间外）'}`);
        console.log(`     之后最大偏离 +${maxAfter.toFixed(1)}%`);
      } else {
        console.log('  ⇒ 这段里价格从未回到线上方');
      }
    }
  }
}
