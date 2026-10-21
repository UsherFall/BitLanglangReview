/**
 * 验证方案 C："只报今天新触发的币"能不能天然落在 20 个以内。
 *
 * 定义（不引入新判据，只用已有口径算"状态切换"）：
 *   某币在今天满足「异动拉升 + 未突破 + 顶后回吐≤60%」，但昨天不满足 → 今天新触发。
 *
 * 同时给出过去 30 天每天的新触发数量分布，看会不会爆。
 *
 * Run: node .trellis/tasks/10-20-anomaly-level-tracker/research/verify-newly-triggered.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = '.trellis/tasks/10-20-anomaly-level-tracker/research';
const dayOf = (t) => new Date(Number(t) + 8 * 3600 * 1000).toISOString().slice(0, 10);

const bars = new Map();
for (const f of fs.readdirSync(path.join(DIR, 'pool'))) {
  if (!f.endsWith('.json')) continue;
  const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'pool', f), 'utf8'));
  if (raw.length >= 200) bars.set(f.replace(/\.json$/, ''), raw.map(([t, o, h, l, c, v]) => ({ t: Number(t), o, h, l, c, v: Number(v), d: dayOf(t) })));
}

const LOOKBACK = 90;
function qualify(arr, E) {
  if (E < LOOKBACK + 20) return null;
  const from = E - LOOKBACK;
  let best = null;
  let lo = from;
  let loC = arr[from].c;
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
  const hi = Math.max(...after.map((b) => b.h));
  if (hi > peak * 1.0001) return null;          // 已突破
  let L = arr[pAt].l;
  for (let i = pAt; i <= E; i++) L = Math.min(L, arr[i].l);
  if ((peak - L) / (peak - base) > 0.6) return null; // 回吐过多
  return { s0: arr[sAt].d, p: arr[pAt].d, gain: best.gain };
}

// 收集所有日期
const days = new Set();
for (const arr of bars.values()) for (const b of arr) days.add(b.d);
const allDays = [...days].sort();
const last30 = allDays.slice(-31);

const stats = [];
for (let i = 1; i < last30.length; i++) {
  const d = last30[i], dPrev = last30[i - 1];
  let n = 0;
  let still = 0;
  for (const [inst, arr] of bars) {
    const E = arr.findIndex((x) => x.d === d);
    const Ep = arr.findIndex((x) => x.d === dPrev);
    if (E < 0 || Ep < 0) continue;
    const cur = qualify(arr, E);
    const prev = qualify(arr, Ep);
    if (cur && !prev) n++;
    else if (cur && prev) still++;
  }
  stats.push({ d, n, still });
}

console.log(`池 ${bars.size} 个币；最近 30 天的"今天新触发 / 仍在名单"：\n`);
console.log(`${'日期'.padEnd(12)}${'新触发'.padStart(8)}${'仍在'.padStart(8)}`);
for (const s of stats) console.log(`${s.d.padEnd(12)}${String(s.n).padStart(8)}${String(s.still).padStart(8)}`);

const ns = stats.map((s) => s.n).sort((a, b) => a - b);
const q = (p) => ns[Math.min(ns.length - 1, Math.floor(ns.length * p))];
console.log(`\n新触发数量：中位 ${q(0.5)} · p25 ${q(0.25)} · p75 ${q(0.75)} · 最大 ${ns[ns.length - 1]}`);
console.log(`超过 20 的天数：${stats.filter((s) => s.n > 20).length}/${stats.length}`);
