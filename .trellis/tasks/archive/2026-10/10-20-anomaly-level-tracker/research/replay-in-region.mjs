/**
 * 用户 10/20 纠正：
 *   "你要扫描的就是我标注区间的那段时间，而不是现在，现在这些币的机会不好"
 *
 * 之前 build-daily 拿"今天"的价格去比用户 8~10 月标的线，8 个里 6 个显示"已破线"。
 * 那不是线的问题，是时间点错了 —— 用户标的是"当时那段的压力位"。
 *
 * 正确做法：在用户标注的那段时间里逐日回放，报"当天涨跌 + 当天距线"，
 * 看这些数字在当时是否说得通。
 *
 * Run: node .trellis/tasks/10-20-anomaly-level-tracker/research/replay-in-region.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = '.trellis/tasks/10-20-anomaly-level-tracker/research';
const dayOf = (t) => new Date(Number(t) + 8 * 3600 * 1000).toISOString().slice(0, 10);

const bars = new Map();
for (const f of fs.readdirSync(path.join(DIR, 'pool'))) {
  if (!f.endsWith('.json')) continue;
  const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'pool', f), 'utf8'));
  bars.set(f.replace(/\.json$/, ''), raw.map(([t, o, h, l, c]) => ({ t: Number(t), o, h, l, c, d: dayOf(t) })));
}

function rayAt(r, ms) {
  const t1 = Number(r.p1.t), t2 = Number(r.p2.t);
  if (t2 === t1) return r.p2.price;
  return r.p2.price + ((r.p2.price - r.p1.price) / (t2 - t1)) * (ms - t2);
}

const labels = JSON.parse(fs.readFileSync(path.join(DIR, 'draw', 'labels.json'), 'utf8'));

console.log('在「你标注的那段区间内」逐日回放（不是拿今天的价去比）：\n');
console.log(`${'币'.padEnd(8)}${'区间'.padEnd(24)}${'天数'.padStart(5)}${'距线范围'.padStart(16)}${'区间内突破'.padStart(11)}  说明`);

const rows = [];
for (const c of labels) {
  const arr = bars.get(c.inst);
  if (!arr) continue;
  for (const s of c.segments ?? []) {
    if (!s.region) continue;
    const lines = s.lines ?? [];
    if (!lines.length) continue;
    const a = arr.findIndex((x) => x.d === s.region[0]);
    const b = arr.findIndex((x) => x.d === s.region[1]);
    if (a < 0 || b < 0) { console.log(`${c.inst.replace(/USDT$/, '').padEnd(8)}${s.region.join('~').padEnd(24)}  区间不在数据里`); continue; }
    const ds = [];
    let crossed = 0;
    for (let i = a; i <= b; i++) {
      const price = arr[i].c;
      const levels = lines.map((l) => (l.kind === 'h' ? { kind: 'h', p: l.price } : { kind: 'r', p: rayAt(l, arr[i].t) }));
      const above = levels.filter((x) => x.p > price).sort((x, y) => x.p - y.p);
      if (above.length) ds.push(((above[0].p - price) / price) * 100);
      else crossed++;
    }
    const min = Math.min(...ds), max = Math.max(...ds);
    rows.push({ inst: c.inst.replace(/USDT$/, ''), region: s.region.join('~'), days: b - a + 1, min, max, crossed, verdict: s.verdict });
    console.log(
      `${c.inst.replace(/USDT$/, '').padEnd(8)}${s.region.join('~').padEnd(24)}${String(b - a + 1).padStart(5)}${(min.toFixed(1) + ' ~ ' + max.toFixed(1) + '%').padStart(16)}${(crossed ? crossed + ' 天' : '—').padStart(11)}  ${s.verdict === 'good' ? '会做' : s.verdict === 'structure' ? '结构不行' : ''}`,
    );
  }
}

const allMin = rows.map((r) => r.min).filter(Number.isFinite);
const allMax = rows.map((r) => r.max).filter(Number.isFinite);
console.log(`\n全部区间：区间内离线最近 ${Math.min(...allMin).toFixed(2)}%，最远 ${Math.max(...allMax).toFixed(2)}%`);
console.log(`区间内就突破线的：${rows.filter((r) => r.crossed).length}/${rows.length} 段`);
