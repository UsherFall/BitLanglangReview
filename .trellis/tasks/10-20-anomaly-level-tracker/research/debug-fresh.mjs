import fs from 'node:fs';
import path from 'node:path';
const DIR = '.trellis/tasks/10-20-anomaly-level-tracker/research';
const dayOf = (t) => new Date(Number(t) + 8 * 3600 * 1000).toISOString().slice(0, 10);
const bars = new Map();
for (const f of fs.readdirSync(path.join(DIR, 'pool'))) {
  if (!f.endsWith('.json')) continue;
  const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'pool', f), 'utf8'));
  if (raw.length >= 200) bars.set(f.replace(/\.json$/, ''), raw.map(([t, o, h, l, c]) => ({ t: Number(t), o, h, l, c, d: dayOf(t) })));
}
const LOOKBACK = 90;
function qualify(arr, E) {
  if (E < LOOKBACK + 20) return null;
  const from = E - LOOKBACK;
  let best = null, lo = from, loC = arr[from].c;
  for (let i = from; i <= E; i++) {
    if (arr[i].c < loC) { loC = arr[i].c; lo = i; }
    const g = (arr[i].h - loC) / loC;
    if (g >= 0.3 && i - lo + 1 >= 4 && (!best || g > best.gain)) best = { sAt: lo, pAt: i, gain: g };
  }
  if (!best) return null;
  const { sAt, pAt } = best;
  const base = arr[Math.max(0, sAt - 1)].c;
  const peak = arr.slice(sAt, pAt + 1).reduce((m, b) => Math.max(m, b.h), -Infinity);
  const after = arr.slice(pAt, E + 1);
  if (Math.max(...after.map((b) => b.h)) > peak * 1.0001) return null;
  let L = arr[pAt].l;
  for (let i = pAt; i <= E; i++) L = Math.min(L, arr[i].l);
  if ((peak - L) / (peak - base) > 0.6) return null;
  return { s0: arr[sAt].d, p: arr[pAt].d, gain: best.gain };
}
for (const d of ['2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20']) {
  let n = 0;
  for (const arr of bars.values()) {
    const E = arr.findIndex((x) => x.d === d);
    if (E < 0) continue;
    if (qualify(arr, E)) n++;
  }
  console.log(d, '满足口径:', n);
}
// 10-19 满足、10-18 不满足 的有几个？
let fresh = 0;
const names = [];
for (const [inst, arr] of bars) {
  const a = arr.findIndex((x) => x.d === '2026-10-19');
  const b = arr.findIndex((x) => x.d === '2026-10-18');
  if (a < 0 || b < 0) continue;
  const cur = qualify(arr, a), prev = qualify(arr, b);
  if (cur && !prev) { fresh++; names.push(inst.replace(/USDT$/, '')); }
}
console.log('10-19 新触发:', fresh, names.join(', '));
