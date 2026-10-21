/**
 * The unambiguous causal test the cards need: "什么是好机会" was defined by the USER
 * himself when he built the labels-43 set — per his own notes:
 *
 *   "9-28 到 9-30 那段横盘是好机会，现在做不了"   (BAT)
 *   "9-25 到 10-1 的收敛很好，现在不行"            (STRK)
 *
 * i.e. a good opportunity = CONSOLIDATE AT THE TOP, then BREAK OUT (not fade). So:
 *
 *   setup   = the 5 bars ending at day E stay within 5% of their own high
 *             (a quiet box at the top — what 收敛 means, measured without the
 *             volatility-shrink detector)
 *   success = the following `nb` sessions CLOSE above that box's high
 *             (a clean break up — the outcome the user calls 能做)
 *
 * Measure, on every (instrument, day) of the cache:
 *   - how many setups there are (volume — this is the raw supply of "good chances")
 *   - how many of them break out (the unconditional odds a setup pays)
 *   - what retention, ADX-like trendiness and bar count add on top
 * and compare the annual counts with the annotation history (285 / 43 labels).
 *
 * Run: POOL_DIR=<dir> node <this>
 */
import fs from 'node:fs';
import path from 'node:path';

const POOL_DIR = process.env.POOL_DIR;
const WINDOW = 60;
const iso = (t) => new Date(t).toISOString().slice(0, 10);

const daily = new Map();
for (const f of fs.readdirSync(POOL_DIR)) {
  if (!f.endsWith('.json')) continue;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(POOL_DIR, f), 'utf8'));
    if (Array.isArray(raw) && raw.length >= 100) daily.set(f.replace(/\.json$/, ''), raw.map(([t, o, h, l, c]) => ({ t, o, h, l, c })));
  } catch { /* skip */ }
}
console.log(`daily ${daily.size}`);

const allDates = new Set();
for (const arr of daily.values()) for (const b of arr) allDates.add(iso(b.t));
const dates = [...allDates].sort();
const last365 = new Set(dates.slice(-365));

function retention(arr, E) {
  const from = Math.max(0, E - WINDOW + 1);
  const w = arr.slice(from, E + 1);
  if (w.length < 20) return null;
  let loIdx = 0;
  for (let i = 1; i < w.length; i++) if (w[i].c < w[loIdx].c) loIdx = i;
  const lo = w[loIdx].c;
  let hi = -Infinity;
  for (let i = loIdx; i < w.length; i++) if (w[i].h > hi) hi = w[i].h;
  if (!(hi > lo)) return null;
  return (arr[E].c - lo) / (hi - lo);
}

/**
 * Box at the top ending at E over `len` bars: the last bar closes inside the box and
 * the whole box sits within `tol` of its own high.
 */
function topBox(arr, E, len = 5, tol = 0.05) {
  if (E - len + 1 < 0) return null;
  const w = arr.slice(E - len + 1, E + 1);
  const hi = Math.max(...w.map((b) => b.h));
  const lo = Math.min(...w.map((b) => b.l));
  if (!(hi > 0)) return null;
  if ((hi - lo) / hi > tol) return null;
  return { hi, lo };
}

/** breakout: a CLOSE above the box high in the next nb sessions */
function breakout(arr, E, box, nb = 5) {
  const fwd = arr.slice(E + 1, E + 1 + nb);
  if (fwd.length < nb) return null;
  return fwd.some((b) => b.c > box.hi);
}

const R = { n: 0, setups: 0, setupsTop: 0, brk: 0, brkTop: 0, retQ: [0, 0, 0, 0, 0], retBrk: [0, 0, 0, 0, 0] };
const byDateSetups = new Map();
for (const [inst, arr] of daily) {
  for (let E = WINDOW; E < arr.length - 5; E++) {
    const d = iso(arr[E].t);
    if (!last365.has(d)) continue;
    const box = topBox(arr, E);
    if (!box) continue;
    const b = breakout(arr, E, box);
    if (b == null) continue;
    const r = retention(arr, E);
    R.setups++;
    if (b) R.brk++;
    byDateSetups.set(d, (byDateSetups.get(d) ?? 0) + 1);
    if (r != null) {
      const q = Math.min(4, Math.max(0, Math.floor(r * 5)));
      R.retQ[q]++;
      if (b) R.retBrk[q]++;
      if (r >= 0.6) { R.setupsTop++; if (b) R.brkTop++; }
    }
  }
}

const pct = (a, b) => `${((a / Math.max(1, b)) * 100).toFixed(1)}%`;
console.log(`\n定义：收敛=${5} 根内区间 ≤5%（贴着顶部） · 成功=${5} 个交易日内收盘价突破该区间上沿`);
console.log(`样本 ${R.setups} 个"收敛·币·日"（${dates.length} 个交易日里 ${byDateSetups.size} 天有）`);
console.log(`  无条件突破率  ${pct(R.brk, R.setups)}（${R.brk}/${R.setups}）——这就是"好机会"的基础赔率`);
console.log(`  retention ≥0.6（贴着这波高点）的收敛 ${R.setupsTop} 个，突破率 ${pct(R.brkTop, R.setupsTop)}`);
console.log('\n按 retention 分五档（收敛样本）：');
const labels = ['0–20%', '20–40%', '40–60%', '60–80%', '80–100%'];
for (let q = 0; q < 5; q++) {
  console.log(`  ${labels[q].padStart(8)} 样本 ${String(R.retQ[q]).padStart(6)} · 突破率 ${pct(R.retBrk[q], R.retQ[q])}`);
}
const perDay = R.setups / 365;
console.log(`\n每年"收敛·币·日" = ${perDay.toFixed(0)} 个/天 × 365 ≈ ${(perDay * 365).toFixed(0)}（按 ${daily.size} 个有日线的币）`);
console.log(`对照：用户一年里标了 285 + 43 = ${285 + 43} 次判读（含重复币），其中"能做" 36 + 17 = 53 个`);
console.log(`若一个"好机会"= 收敛 ∧ 之后突破，那么每年这样的"币·日"≈ ${((R.brk / Math.max(1, R.setups)) * perDay * 365).toFixed(0)} 个`);
