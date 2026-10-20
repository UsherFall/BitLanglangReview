/**
 * 每日播报（主线，2026-10-20 定：方向 C，粗筛降级）
 *
 * 流程：
 *   fetch-pool.mjs      拉当日 1D
 *        ↓
 *   alert.mjs           算"距你标的线" + 波动尺 → 警报/观察中/不接近
 *        ↓
 *   out/daily.md        人工可读的今日播报
 *
 * 核心规则（用户定）：
 *   尺子 = 该币自己的波动中位数（日内振幅中位）
 *          有射线 → 射线起点之后那段行情的中位
 *          否则   → 最近 60 根的中位
 *   距线 ≤ 0.5 尺子 → 报警
 *   距线 ≤ 1.0 尺子 → 观察中
 *   否则             → 不接近（不显示）
 *
 * Run: node .trellis/tasks/10-20-anomaly-level-tracker/research/alert.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = '.trellis/tasks/10-20-anomaly-level-tracker/research';
const OUT = path.join(DIR, 'out');
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

function volScale(arr, afterIdx) {
  const from = afterIdx ?? Math.max(0, arr.length - 60);
  const xs = arr.slice(from).map((b) => ((b.h - b.l) / b.c) * 100);
  return med(xs);
}

// ---- 判定日：最后一根已收盘的 K 线
const allDays = [...new Set([...bars.values()].flatMap((a) => a.map((b) => b.d)))].sort();
const lastDay = allDays.at(-1);
const nowBJ = new Date(Date.now() + 8 * 3600 * 1000);
const isOpen = nowBJ.getUTCHours() >= 8;           // 北京 8 点后当日那根在盘中
const judgeDay = isOpen ? allDays.filter((d) => d < lastDay).at(-1) : lastDay;
const priceDay = lastDay;                         // 报现价用最后一根（含盘中）

// ---- 读用户标注
const LABEL_FILE = path.join(DIR, 'draw', 'labels.json');
if (!fs.existsSync(LABEL_FILE)) {
  console.error(`找不到 ${LABEL_FILE}\n请在 out/annotate-today.html 标注后导出，存到 research/draw/labels.json`);
  process.exit(1);
}
const labels = JSON.parse(fs.readFileSync(LABEL_FILE, 'utf8'));

// ---- 收集每个币的尺子与线
const items = [];
for (const c of labels) {
  const arr = bars.get(c.inst);
  if (!arr) continue;
  const short = c.inst.replace(/USDT$/, '');
  let scale = null;
  // 优先用射线起点之后那段
  for (const s of c.segments ?? []) {
    const ray = (s.lines ?? []).find((x) => x.kind === 'r');
    if (!ray) continue;
    const start = arr.findIndex((x) => x.t >= Number(ray.p1.t));
    const endIdx = arr.findIndex((x) => x.d === s.region?.[1]);
    if (start >= 0 && endIdx > start) { scale = volScale(arr.slice(0, endIdx + 1), start); break; }
  }
  if (scale == null) scale = volScale(arr);

  for (const s of c.segments ?? []) {
    for (const l of s.lines ?? []) {
      items.push({
        inst: short,
        arr,
        kind: l.kind === 'r' ? '趋势线' : '水平线',
        line: l,
        region: s.region,
        verdict: s.verdict,
        note: (c.note || '').trim(),
        scale,
      });
    }
  }
}

// ---- 判定
const rows = [];
for (const it of items) {
  const E = it.arr.findIndex((x) => x.d === judgeDay);
  const Ep = it.arr.findIndex((x) => x.d === priceDay);
  if (E < 0) continue;
  const useIdx = Ep >= 0 ? Ep : E;
  const line = it.line.kind === 'r' ? rayAt(it.line, it.arr[useIdx].t) : it.line.price;
  const price = it.arr[useIdx].c;
  const prev = it.arr[useIdx - 1]?.c ?? price;
  const dist = ((price - line) / line) * 100;
  const mult = Math.abs(dist) / it.scale;
  rows.push({
    ...it,
    linePrice: line,
    price,
    pct: ((price - prev) / prev) * 100,
    dist,
    mult,
    state: mult <= 0.5 ? 'alert' : mult <= 1.0 ? 'watch' : 'far',
  });
}

rows.sort((a, b) => a.mult - b.mult);
const alerts = rows.filter((r) => r.state === 'alert');
const watch = rows.filter((r) => r.state === 'watch');

// ---- 输出
const V = { good: '会做', structure: '结构不行', chart: '股性不行', converge: '没收敛', missed: '错过了' };
const md = [
  `# 今日播报 ${judgeDay}`,
  '',
  `数据：${lastDay}${isOpen ? '（盘中价）' : ''}　｜　判定日：${judgeDay}`,
  '',
  `## 🔔 警报（${alerts.length}）— 价格回到你标的线附近`,
  '',
  '| 币 | 线 | 距线 | 尺子 | 倍数 | 现价 | 当日 | 判定 | 备注 |',
  '|---|---|---|---|---|---|---|---|---|',
  ...alerts.map((r) => `| ${r.inst} | ${r.kind} | ${r.dist >= 0 ? '+' : ''}${r.dist.toFixed(2)}% | ${r.scale.toFixed(2)}% | ${r.mult.toFixed(2)}× | ${r.price} | ${r.pct >= 0 ? '+' : ''}${r.pct.toFixed(2)}% | ${V[r.verdict] ?? '—'} | ${r.note.slice(0, 30)} |`),
  '',
  `## · 观察中（${watch.length}）— 线已画好，还没接近`,
  '',
  '| 币 | 线 | 距线 | 倍数 | 现价 | 当日 | 备注 |',
  '|---|---|---|---|---|---|---|',
  ...watch.map((r) => `| ${r.inst} | ${r.kind} | ${r.dist >= 0 ? '+' : ''}${r.dist.toFixed(2)}% | ${r.mult.toFixed(2)}× | ${r.price} | ${r.pct >= 0 ? '+' : ''}${r.pct.toFixed(2)}% | ${r.note.slice(0, 34)} |`),
  '',
  '## 规则',
  '',
  '尺子 = 该币自己的日内振幅中位数（有射线用射线起点之后那段，否则用最近 60 根）。',
  '距线 ≤ 0.5 尺子 → 报警；≤ 1.0 → 观察中；否则不显示。',
  '',
].join('\n');
fs.writeFileSync(path.join(OUT, 'daily.md'), md);
fs.writeFileSync(path.join(OUT, 'daily.json'), JSON.stringify({ judgeDay, priceDay, rows }, null, 1));

console.log(`判定日 ${judgeDay}　现价用 ${lastDay}${isOpen ? '（盘中）' : ''}\n`);
console.log(`🔔 警报 ${alerts.length} 个：`);
for (const r of alerts) console.log(`   ${r.inst.padEnd(8)} ${r.kind}  距线 ${r.dist >= 0 ? '+' : ''}${r.dist.toFixed(2)}%（${r.mult.toFixed(2)}×尺）  当日 ${r.pct >= 0 ? '+' : ''}${r.pct.toFixed(2)}%`);
console.log(`\n· 观察中 ${watch.length} 个：`);
for (const r of watch) console.log(`   ${r.inst.padEnd(8)} ${r.kind}  距线 ${r.dist >= 0 ? '+' : ''}${r.dist.toFixed(2)}%（${r.mult.toFixed(2)}×尺）`);
console.log(`\n其余 ${rows.length - alerts.length - watch.length} 个不接近，不显示`);
console.log(`\n写出 out/daily.md`);
