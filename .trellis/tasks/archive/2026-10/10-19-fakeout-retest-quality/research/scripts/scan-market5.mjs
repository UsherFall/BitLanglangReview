/**
 * 粗筛 v5：顶 = 「掉下来那段的起点」。
 *
 * 用户 10/20 最终确认的逻辑：
 *   ① 先找「掉下来」：价格从某个高点跌了明显幅度
 *   ② 再找「涨回去」：现在快回到那个高点了
 *   ③ 那个「掉下来之前的最高点」就是粗筛的顶 → 交给用户标真正的压力位
 *
 * 这样顶不需要在 150 根里找全局最高，它由走势自带：
 *   掉下来的起点 = 一段下跌开始之前的最高价。
 *
 * 判据（全部相对量，单位 = 该币自己的日均波动 ATR）：
 *   找回落：从 E 往回看 60 根内，最高价 P（且它到 E 之间的最低 L 明显低于 P）
 *   掉下来：drop = (P - L) / ATR
 *   涨回去：recall = (now - L) / (P - L)   0=还在低点, 1=回到顶
 *   还差：  gap = (P - now) / ATR
 *   收敛：  最近这段 (3~6 根) 的宽度 / ATR
 *
 * 精度评估：用户 34 个 good 段的「区间末」那天能否被扫到（目标 ≥80%）
 *
 * Run: POOL_DIR=<dir> node .scratch/research-10-19/scan-market5.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const POOL_DIR = process.env.POOL_DIR;
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

const LOOKBACK = Number(process.env.LOOKBACK ?? 90);   // 找"掉下来"的范围
const MAX_DROP = Number(process.env.MAX_DROP ?? 12);   // 掉下来最多多少个 ATR（太深的不要）
const MIN_RECALL = Number(process.env.MIN_RECALL ?? 0.5); // 至少要涨回一半
const MAX_GAP = Number(process.env.MAX_GAP ?? 1.5);    // 离顶最多几个 ATR
const MAX_WIDTH = Number(process.env.MAX_WIDTH ?? 2.5); // 横盘最多几个 ATR
const MIN_SEG = 3;

const cls = JSON.parse(fs.readFileSync('.scratch/research-10-19/market-class.json', 'utf8'));
const cryptoSet = new Set(cls.crypto);

const bars = new Map();
for (const f of fs.readdirSync(POOL_DIR)) {
  if (!f.endsWith('.json')) continue;
  const inst = f.replace(/\.json$/, '');
  if (!cryptoSet.has(inst)) continue;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(POOL_DIR, f), 'utf8'));
    if (Array.isArray(raw) && raw.length >= 200) {
      bars.set(inst, raw.map(([t, o, h, l, c]) => ({ t, o, h, l, c, d: dayOf(t) })));
    }
  } catch { /* skip */ }
}
console.log(`池（加密，≥200 根）${bars.size}`);

function atrPct(arr, E, n = 20) {
  let s = 0, k = 0;
  for (let i = Math.max(1, E - n + 1); i <= E; i++) {
    const tr = Math.max(arr[i].h - arr[i].l, Math.abs(arr[i].h - arr[i - 1].c), Math.abs(arr[i].l - arr[i - 1].c));
    s += tr / arr[i].c; k++;
  }
  return k ? s / k : 0.02;
}

function evaluate(arr, E) {
  if (E < 60) return null;
  const atr = atrPct(arr, E) * arr[E].c;
  const price = arr[E].c;
  const from = Math.max(0, E - LOOKBACK);

  // ① 找"掉下来"的那段：在 [from, E-3] 里的最高价 P
  let P = -Infinity, pAt = -1;
  for (let i = from; i <= E - 3; i++) if (arr[i].h > P) { P = arr[i].h; pAt = i; }
  if (pAt < 0) return null;

  // P 之后的最低 L（这就是"掉下来"）
  let L = Infinity, lAt = pAt;
  for (let i = pAt + 1; i <= E; i++) if (arr[i].l < L) { L = arr[i].l; lAt = i; }
  if (!(L < Infinity) || !(P > L)) return null;

  const dropUnits = (P - L) / atr;
  if (dropUnits > MAX_DROP) return null;   // 掉太深的不算（那种不是"来回"）
  if (dropUnits < 0.5) return null;        // 几乎没掉的不算

  // ② 涨回去：现在回到"掉的这段"的多少
  const recall = (price - L) / (P - L);
  if (recall < MIN_RECALL) return null;    // 还没涨回来一半
  if (price >= P) return null;             // 已经破顶了 → 不报（用户要求）

  const gap = (P - Math.max(price, arr[E].h)) / atr;
  if (gap > MAX_GAP) return null;

  // ③ 收敛：最近几根是不是横住
  for (let len = MIN_SEG; len <= 6; len++) {
    const s0 = E - len + 1;
    if (s0 <= lAt) break;
    const seg = arr.slice(s0, E + 1);
    const hi = Math.max(...seg.map((b) => b.h));
    const lo = Math.min(...seg.map((b) => b.l));
    const width = (hi - lo) / atr;
    if (width <= MAX_WIDTH && price >= lo) {
      return { len, P, L, pAt, lAt, dropUnits, recall, gap, width, atr, daysSincePeak: E - pAt, daysSinceLow: E - lAt };
    }
  }
  return null;
}

// ---------------------------------------------------------------- 精度
const ann = JSON.parse(fs.readFileSync('annotations-34.json', 'utf8'));
let hit = 0;
const miss = [];
const hits = [];
for (const card of ann) {
  const arr = bars.get(card.inst);
  if (!arr) continue;
  for (const g of card.segments ?? []) {
    if (!g.region || g.verdict !== 'good') continue;
    const b = arr.findIndex((x) => x.d === g.region[1]);
    if (b < 0) continue;
    if (evaluate(arr, b)) { hit++; hits.push(`${card.inst.replace(/USDT$/, '')}@${g.region[1]}`); }
    else miss.push(`${card.inst.replace(/USDT$/, '')}@${g.region[1]}`);
  }
}
const total = hit + miss.length;
console.log(`\n=== 对你 34 个 good 段的命中率 ===`);
console.log(`${hit}/${total} = ${((hit / total) * 100).toFixed(0)}%  ${hit / total >= 0.8 ? '✓ 达标（目标 80%）' : '✗ 未达 80%'}`);
console.log('命中：' + hits.join(', '));
if (miss.length) console.log('漏掉：' + miss.join(', '));

// ---------------------------------------------------------------- 全市场
const byDate = new Map();
for (const [inst, arr] of bars) {
  for (let E = 60; E < arr.length; E++) {
    const r = evaluate(arr, E);
    if (!r) continue;
    const d = arr[E].d;
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push({ inst: inst.replace(/USDT$/, ''), ...r });
  }
}
const dates = [...byDate.keys()].sort();
const counts = dates.map((d) => byDate.get(d).length).sort((a, b) => a - b);
console.log(`\n=== 全市场 ===`);
console.log(`参数：回调≤${MAX_DROP}ATR · 涨回≥${MIN_RECALL} · 离顶≤${MAX_GAP}ATR · 横盘≤${MAX_WIDTH}ATR`);
console.log(`每天：中位 ${counts[Math.floor(counts.length / 2)]}，p25 ${counts[Math.floor(counts.length * 0.25)]}，p75 ${counts[Math.floor(counts.length * 0.75)]}`);
console.log('\n最近 8 天：');
for (const d of dates.slice(-8)) {
  const l = byDate.get(d);
  console.log(`  ${d}  ${String(l.length).padStart(3)}  ${l.slice(0, 14).map((x) => x.inst).join(', ')}`);
}
const last = dates[dates.length - 1];
console.log(`\n${last} 名单：`);
console.log(`${'币'.padEnd(12)}${'掉下来'.padStart(7)}${'涨回'.padStart(7)}${'离顶'.padStart(7)}${'横盘'.padStart(7)}${'距顶'.padStart(6)}`);
for (const x of (byDate.get(last) ?? []).sort((a, b) => a.gap - b.gap)) {
  console.log(`${x.inst.padEnd(12)}${x.dropUnits.toFixed(1).padStart(7)}${((x.recall) * 100).toFixed(0).padStart(6)}%${x.gap.toFixed(2).padStart(7)}${x.width.toFixed(1).padStart(7)}${String(x.daysSincePeak).padStart(6)}`);
}

fs.writeFileSync('.scratch/research-10-19/market-scan-v5.json', JSON.stringify(Object.fromEntries([...byDate].map(([d, l]) => [d, l.map((x) => ({ inst: x.inst, drop: +x.dropUnits.toFixed(2), recall: +x.recall.toFixed(2), gap: +x.gap.toFixed(2), width: +x.width.toFixed(2), ds: x.daysSincePeak }))])), null, 0));
