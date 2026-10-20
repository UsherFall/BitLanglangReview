/**
 * 趋势线/水平线警报（第四版，按用户 10/20 的口径）
 *
 * "接近"不用固定百分比，用该币自己的尺子：
 *   尺子 = 用户射线起点之后那段行情的"日内振幅中位数"
 *   （用户原话：打到高点后，就是我那个射线起点之后波动的中位数）
 *
 * 没有画射线（只画了水平线）的币，用该币历史上近 60 根的日内振幅中位数当尺子。
 *
 * 判定：
 *   现在距线 ≤ 0.5 × 尺子 → 报警
 *   0.5~1.0 × 尺子      → 观察（比平时近，但还没到）
 *   > 1.0 × 尺子         → 不接近
 *
 * 用用户标的 10 段真实数据回放验证：
 *   警报日 是否落在用户标注的区间内 / 接近区间末
 *
 * Run: node .trellis/tasks/10-20-anomaly-level-tracker/research/alert.mjs
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

const med = (xs) => {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : NaN;
};

/** 该币的"波动尺子"（日内振幅中位数 %）
 *  @param after 从这天起算（射线的起点那天）；缺省 = 最近 60 根
 */
function volScale(arr, afterIdx) {
  const from = afterIdx ?? Math.max(0, arr.length - 60);
  const xs = arr.slice(from).map((b) => ((b.h - b.l) / b.c) * 100);
  return med(xs);
}

const labels = JSON.parse(fs.readFileSync(path.join(DIR, 'draw', 'labels.json'), 'utf8'));

// 每个币的尺子：优先用"射线起点之后那段"，否则用最近 60 根
const scaleOf = new Map();
for (const c of labels) {
  const arr = bars.get(c.inst);
  if (!arr) continue;
  for (const s of c.segments ?? []) {
    const ray = (s.lines ?? []).find((x) => x.kind === 'r');
    if (ray) {
      const start = arr.findIndex((x) => x.t >= Number(ray.p1.t));
      const endIdx = arr.findIndex((x) => x.d === s.region[1]);
      if (start >= 0 && endIdx > start) scaleOf.set(c.inst, { v: volScale(arr.slice(0, endIdx + 1), start), from: 'ray-start' });
    }
  }
  if (!scaleOf.has(c.inst)) scaleOf.set(c.inst, { v: volScale(arr), from: 'last60' });
}

console.log('每个币自己的尺子（日内振幅中位数 %）：');
for (const [inst, s] of scaleOf) console.log(`  ${inst.replace(/USDT$/, '').padEnd(8)} ${s.v.toFixed(2)}%  （${s.from}）`);

// ---- 逐日回放：警报日 vs 用户区间末
console.log('\n=== 回放：警报日 vs 用户标的区间 ===\n');
console.log(`${'币'.padEnd(8)}${'尺子'.padStart(7)}${'警报日'.padStart(14)}${'用户区间'.padEnd(26)}  命中?`);

for (const c of labels) {
  const arr = bars.get(c.inst);
  if (!arr) continue;
  const short = c.inst.replace(/USDT$/, '');
  const scale = scaleOf.get(c.inst).v;
  for (const s of c.segments ?? []) {
    const lines = s.lines ?? [];
    if (!lines.length) continue;
    // 线画好日 = 射线的 p2 / 水平线的区间末
    const drawnAt = lines.find((x) => x.kind === 'r') ? dayOf(Number(lines.find((x) => x.kind === 'r').p2.t)) : s.region[1];
    const dIdx = arr.findIndex((x) => x.d === drawnAt);
    if (dIdx < 0) continue;
    // 画好之后，第一次距线 ≤ 0.5 尺子
    let alertDay = null;
    for (let i = dIdx; i < arr.length; i++) {
      for (const l of lines) {
        const line = l.kind === 'r' ? rayAt(l, arr[i].t) : l.price;
        const dist = Math.abs(((arr[i].c - line) / line) * 100);
        if (dist <= 0.5 * scale) { alertDay = { d: arr[i].d, dist }; break; }
      }
      if (alertDay) break;
    }
    const regionEnd = arr.findIndex((x) => x.d === s.region[1]);
    const alertIdx = alertDay ? arr.findIndex((x) => x.d === alertDay.d) : -1;
    const diff = alertIdx >= 0 && regionEnd >= 0 ? alertIdx - regionEnd : null;
    console.log(
      `${short.padEnd(8)}${scale.toFixed(2).padStart(7)}${(alertDay ? alertDay.d + `(${alertDay.dist.toFixed(2)}%)` : '无').padStart(14)}${s.region.join('~').padEnd(26)}  ${diff == null ? '—' : diff === 0 ? '✓ 正好' : diff < 0 ? `✓ 早 ${-diff} 天` : `晚 ${diff} 天`}`,
    );
  }
}

// ---- 当下状态
console.log('\n=== 当下（判定日 = 最后已收盘那根） ===\n');
const allDays = [...new Set([...bars.values()].flatMap((a) => a.map((b) => b.d)))].sort();
const lastDay = allDays.at(-1);
const nowBJ = new Date(Date.now() + 8 * 3600 * 1000);
const judgeDay = nowBJ.getUTCHours() >= 8 ? allDays.filter((d) => d < lastDay).at(-1) : lastDay;
console.log(`判定日 ${judgeDay}\n`);

const rows = [];
for (const c of labels) {
  const arr = bars.get(c.inst);
  if (!arr) continue;
  const short = c.inst.replace(/USDT$/, '');
  const scale = scaleOf.get(c.inst).v;
  const E = arr.findIndex((x) => x.d === judgeDay);
  if (E < 0) continue;
  for (const s of c.segments ?? []) {
    for (const l of s.lines ?? []) {
      const line = l.kind === 'r' ? rayAt(l, arr[E].t) : l.price;
      const dist = ((arr[E].c - line) / line) * 100;
      const mult = Math.abs(dist) / scale;
      rows.push({ inst: short, kind: l.kind === 'r' ? '趋势线' : '水平线', dist, mult, scale, price: arr[E].c, note: (c.note || '').trim().slice(0, 30) });
    }
  }
}

console.log(`${'币'.padEnd(8)}${'线'.padEnd(9)}${'距线'.padStart(8)}${'尺子'.padStart(7)}${'倍数'.padStart(7)}  状态`);
for (const r of rows.sort((a, b) => a.mult - b.mult)) {
  const st = r.mult <= 0.5 ? '🔔 报警' : r.mult <= 1.0 ? '· 观察中' : '  不接近';
  console.log(`${r.inst.padEnd(8)}${r.kind.padEnd(9)}${(r.dist >= 0 ? '+' : '') + r.dist.toFixed(2).padStart(7)}${r.scale.toFixed(2).padStart(7)}${r.mult.toFixed(2).padStart(7)}  ${st}`);
}
