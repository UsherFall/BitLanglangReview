/**
 * 趋势线收敛监视器（第二版，按用户 10/20 的纠正）
 *
 * 用户原话：
 *   "8-8那个不是反弹吗，是用来确定趋势线的啊，第三次拉升接近趋势线并小级别收敛才能看成机会，
 *    不用站上去，在附近就行"
 *
 * 所以形态是：
 *   ① 拉升 → 反弹高点（确定趋势线用）
 *   ② 再次拉升 → 反弹高点（趋势线的第二个点）
 *   ③ 第三次拉升 → 接近趋势线（附近即算）+ 小级别收敛 ← 机会
 *
 * 关键差异 vs 我上一版：
 *   - 前两次接近**不算信号**，它们就是趋势线的成因
 *   - 第三次接近才算
 *   - "附近"就算，不需要站上线
 *
 * 本脚本用 ETH 的真实数据把 ①②③ 标出来，验证这个理解对不对。
 *
 * Run: node .trellis/tasks/10-20-anomaly-level-tracker/research/trendline-touches.mjs
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

for (const c of labels) {
  const arr = bars.get(c.inst);
  if (!arr) continue;
  for (const s of c.segments ?? []) {
    for (const ray of (s.lines ?? []).filter((l) => l.kind === 'r')) {
      const t1 = Number(ray.p1.t), t2 = Number(ray.p2.t);
      const start = arr.findIndex((x) => x.t >= t1);
      if (start < 0) continue;
      const end = Math.min(arr.length - 1, start + 60);
      const short = c.inst.replace(/USDT$/, '');

      console.log(`\n${'='.repeat(70)}`);
      console.log(`${short}  你的区间 ${s.region.join('~')}  [${s.verdict === 'good' ? '会做' : s.verdict}]`);
      console.log(`趋势线：${dayOf(t1)} @ ${ray.p1.price.toFixed(2)} → ${dayOf(t2)} @ ${ray.p2.price.toFixed(2)}  （下降）`);
      console.log(`${'日期'.padEnd(12)}${'收盘'.padStart(10)}${'线'.padStart(10)}${'距线%'.padStart(8)}  说明`);
      console.log('-'.repeat(70));

      // 找出价格"接近线"的日期（连续贴近算一次）
      const NEAR = 1.5; // 先只做展示，用 1.5% 看看能不能对齐用户说的三次
      const touches = [];
      let inTouch = false;
      for (let i = start; i <= end; i++) {
        const line = rayAt(ray, arr[i].t);
        const dist = ((arr[i].c - line) / line) * 100;
        const near = dist >= -NEAR; // 距线 1.5% 以内或已站上
        const isP1 = arr[i].t === t1;
        const isP2 = arr[i].t === t2;
        let tag = '';
        if (isP1) tag = '★ 线的第 1 个点（用户画的起点）';
        else if (isP2) tag = '★ 线的第 2 个点';
        if (near && !inTouch && !isP1 && !isP2) { tag += ' ← 接近'; touches.push({ d: arr[i].d, dist, i }); }
        inTouch = near;
        const mark = i >= arr.findIndex((x) => x.d === s.region[0]) && i <= arr.findIndex((x) => x.d === s.region[1]) ? ' ' : '·';
        if (near || isP1 || isP2 || Math.abs(dist) < 3) {
          console.log(`${mark}${arr[i].d.padEnd(11)}${String(arr[i].c).padStart(10)}${line.toFixed(2).padStart(10)}${(dist >= 0 ? '+' : '') + dist.toFixed(2).padStart(7)}  ${tag}`);
        }
      }

      console.log('-'.repeat(70));
      console.log(`接近趋势线的次数：${touches.length}`);
      touches.forEach((t, k) => {
        const which = k === 0 ? '第 1 次' : k === 1 ? '第 2 次' : k === 2 ? '第 3 次 ← 用户说的机会' : `第 ${k + 1} 次`;
        console.log(`  ${which}  ${t.d}  距线 ${t.dist.toFixed(2)}%`);
      });
      const third = touches[2];
      const regionEnd = arr.findIndex((x) => x.d === s.region[1]);
      if (third) {
        console.log(`\n  第三次接近 = ${third.d}（距线 ${third.dist.toFixed(2)}%）`);
        console.log(`  用户的区间末 = ${arr[regionEnd].d}，差 ${(regionEnd - third.i)} 天`);
        const after = arr.slice(third.i, Math.min(arr.length, third.i + 8));
        console.log(`  之后 8 天：${after.map((b) => `${b.d.slice(5)} ${(((b.c - arr[third.i].c) / arr[third.i].c) * 100).toFixed(1)}%`).join(' | ')}`);
      } else {
        console.log(`\n  ⚠ 只找到 ${touches.length} 次接近（用户说的是第三次）`);
      }
    }
  }
}
