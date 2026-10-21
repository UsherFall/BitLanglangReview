/**
 * 用户 10/20："你没看我画的三角收敛吗，他小级别一定在那个趋势线附近收敛了"
 *
 * 我把射线（趋势线）当成了"距离参考"，但它其实是判据本身：
 *   只要价格在趋势线附近收敛 —— 日线上还没启动，也值得看。
 *
 * 本脚本把用户画的所有射线提取出来，量三件事：
 *   1. 射线是哪条边（三角的上边/下边）：斜率正负
 *   2. 价格在区间内离射线的距离（按天）
 *   3. 价格在射线附近"收敛"了吗 —— 用"价格与射线距离的变化"看，不引入新阈值先只报数
 *
 * Run: node .trellis/tasks/10-20-anomaly-level-tracker/research/rays.mjs
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

const rays = [];
for (const c of labels) {
  for (const s of c.segments ?? []) {
    for (const l of s.lines ?? []) {
      if (l.kind !== 'r') continue;
      rays.push({ inst: c.inst.replace(/USDT$/, ''), full: c.inst, region: s.region, verdict: s.verdict, note: (c.note || '').trim(), ray: l });
    }
  }
}

console.log(`你画了 ${rays.length} 条射线：\n`);
for (const r of rays) {
  const t1 = Number(r.ray.p1.t), t2 = Number(r.ray.p2.t);
  const slope = (r.ray.p2.price - r.ray.p1.price) / (t2 - t1) * 86400000; // 每天涨跌多少
  const pctPerDay = (slope / r.ray.p2.price) * 100;
  console.log(`${r.inst.padEnd(6)} ${r.region.join('~')}  判定=${r.verdict}`);
  console.log(`   p1 ${dayOf(t1)} @ ${r.ray.p1.price.toFixed(6)} → p2 ${dayOf(t2)} @ ${r.ray.p2.price.toFixed(6)}`);
  console.log(`   斜率 ${slope > 0 ? '向上' : '向下'} ${pctPerDay.toFixed(3)}%/天 ${slope > 0 ? '（下边 / 上升趋势线）' : '（上边 / 下降趋势线）'}`);
  console.log(`   备注：${r.note}\n`);
}

// 逐日看价格与射线的距离（只用区间内 + 区间后 20 天）
console.log('价格与射线的距离（正 = 价格在线上方，负 = 在线下方），单位 = 线价 %：');
for (const r of rays) {
  const arr = bars.get(r.full);
  if (!arr) continue;
  const a = arr.findIndex((x) => x.d === r.region[0]);
  const b = Math.min(arr.length - 1, arr.findIndex((x) => x.d === r.region[1]) + 20);
  const t1 = Number(r.ray.p1.t);
  console.log(`\n${r.inst}（区间 ${r.region.join('~')} 起，往后 20 天）：`);
  const ds = [];
  for (let i = Math.max(0, a); i <= b; i++) {
    // 射线从 p1 开始，之前不算
    if (arr[i].t < t1) continue;
    const line = rayAt(r.ray, arr[i].t);
    const d = ((arr[i].c - line) / line) * 100;
    ds.push({ d: arr[i].d, dist: d });
  }
  // 每 3 天打一个，避免刷屏
  for (let k = 0; k < ds.length; k += 3) {
    const x = ds[k];
    console.log(`  ${x.d}  距线 ${x.dist >= 0 ? '+' : ''}${x.dist.toFixed(2)}%`);
  }
  if (ds.length) {
    const first = ds.slice(0, Math.ceil(ds.length / 2));
    const last = ds.slice(Math.ceil(ds.length / 2));
    const spread = (arr2) => Math.max(...arr2.map((x) => Math.abs(x.dist)));
    console.log(`  → 前半段离线的最大偏离 ${spread(first).toFixed(2)}%，后半段 ${spread(last).toFixed(2)}%（变小 = 在向线收敛）`);
  }
}
