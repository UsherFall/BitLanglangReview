/**
 * 诊断：为什么用户的段没被"异动拉升"罩住？
 * 对每个漏掉的段，打印几个候选起点的拉升幅度，看是"起点找错"还是"幅度不够"。
 *
 * Run: node .trellis/tasks/10-20-anomaly-level-tracker/research/diag-miss.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = '.trellis/tasks/10-20-anomaly-level-tracker/research';
const dayOf = (t) => new Date(Number(t)).toISOString().slice(0, 10);

const bars = new Map();
for (const f of fs.readdirSync(path.join(DIR, 'pool'))) {
  if (!f.endsWith('.json')) continue;
  const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'pool', f), 'utf8'));
  if (raw.length >= 150) bars.set(f.replace(/\.json$/, ''), raw.map(([t, o, h, l, c, v]) => ({ t: Number(t), o, h, l, c, v: Number(v), d: dayOf(t) })));
}
const ann = JSON.parse(fs.readFileSync(path.join(DIR, 'labels.json'), 'utf8'));

const miss = ['WAL@2026-10-08', 'WAL@2026-10-12', 'INIT@2026-09-01', 'INIT@2026-09-19', 'BAT@2026-09-30',
  'AXL@2026-10-05', 'XMR@2026-08-04', 'OPG@2026-10-07', 'TIA@2026-10-05', 'OP@2026-10-12', 'ZEC@2026-08-17',
  'ZEC@2026-09-01', 'NEAR@2026-08-18', 'FLUX@2026-10-02', 'INJ@2026-04-23', 'INJ@2026-05-06', 'Q@2026-07-03',
  'BTC@2026-08-17', 'BTC@2026-09-19'];

function stats(arr, a, b) {
  // 在 [a,b] 里找最高价，和它之前的最低收盘
  let P = -Infinity, pAt = a;
  for (let i = a; i <= b; i++) if (arr[i].h > P) { P = arr[i].h; pAt = i; }
  let sAt = a;
  for (let i = a; i <= pAt; i++) if (arr[i].c < arr[sAt].c) sAt = i;
  const base = arr[Math.max(0, sAt - 1)].c;
  const gain = (P - base) / base;
  const volIn = arr.slice(sAt, b + 1).reduce((x, y) => x + (y.v || 0), 0) / (b - sAt + 1);
  const volPre = arr.slice(Math.max(0, sAt - 60), sAt).reduce((x, y) => x + (y.v || 0), 0) / Math.max(1, sAt - Math.max(0, sAt - 60));
  return { gain, days: b - a + 1, vol: volPre > 0 ? volIn / volPre : NaN, s0: arr[sAt].d, p: arr[pAt].d };
}

console.log(`${'段'.padEnd(20)}${'区间长'.padStart(7)}${'区间内涨幅'.padStart(11)}${'量比'.padStart(7)}  起点→顶`);
for (const key of miss) {
  const [inst, d] = key.split('@');
  const g = ann.find((x) => x.inst === `${inst}USDT` && x.region[1] === d);
  const arr = bars.get(`${inst}USDT`);
  if (!g || !arr) { console.log(`${key.padEnd(20)}  无`); continue; }
  const a = arr.findIndex((x) => x.d === g.region[0]);
  const b = arr.findIndex((x) => x.d === g.region[1]);
  if (a < 0 || b < 0) { console.log(`${key.padEnd(20)}  日期不在池里`); continue; }
  // 用户区间本身
  const inRegion = stats(arr, a, b);
  // 放宽：区间起点往前 20 根
  const wide = stats(arr, Math.max(0, a - 20), b);
  console.log(`${key.padEnd(20)}${String(b - a + 1).padStart(7)}${(inRegion.gain * 100).toFixed(0).padStart(10)}%${inRegion.vol.toFixed(2).padStart(7)}  ${inRegion.s0}→${inRegion.p}   | 往前20根: ${(wide.gain * 100).toFixed(0)}%`);
}
