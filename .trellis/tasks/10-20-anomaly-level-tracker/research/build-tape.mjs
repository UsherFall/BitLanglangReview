/**
 * 标尺：把「粗筛 → 人工标线 → 只报涨跌幅与距压力位」这个流程跑成一条产线。
 *
 * 这三步里，第 1 步（粗筛）只需要挑出"值得看一眼"的币，允许很不准；
 * 真正决定好坏的是第 3 步每天报出来的数字对不对。所以本脚本同时产出：
 *   A. 粗筛名单（每个上过榜的币带它的拉升区间）
 *   B. 以 38 段标注里的 33 条水平线为准，逐日回放每一段：当天涨跌幅 + 距压力位还差多少
 *   C. 口径自检：线上方/下方各多少、贴近/突破各多少
 *
 * 输出 research/out/rally-list.json, research/out/level-replay.json
 *
 * Run: node .trellis/tasks/10-20-anomaly-level-tracker/research/build-tape.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = '.trellis/tasks/10-20-anomaly-level-tracker/research';
const OUT = path.join(DIR, 'out');
fs.mkdirSync(OUT, { recursive: true });
const dayOf = (t) => new Date(Number(t)).toISOString().slice(0, 10);

// --as-of=YYYY-MM-DD：按哪一天出名单（默认 = 池里最新一天，未收盘那根也认）
const AS_OF = (process.argv.find((a) => a.startsWith('--as-of=')) ?? '').slice('--as-of='.length) || null;

const bars = new Map();
let latestDay = '';
for (const f of fs.readdirSync(path.join(DIR, 'pool'))) {
  if (!f.endsWith('.json')) continue;
  const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'pool', f), 'utf8'));
  if (raw.length >= 150) {
    const arr = raw.map(([t, o, h, l, c, v]) => ({ t: Number(t), o, h, l, c, v: Number(v), d: dayOf(t) }));
    const last = arr[arr.length - 1].d;
    if (last > latestDay) latestDay = last;
    bars.set(f.replace(/\.json$/, ''), { arr, latest: last });
  }
}
const AS_OF_DAY = AS_OF ?? latestDay;
const ann = JSON.parse(fs.readFileSync(path.join(DIR, 'labels.json'), 'utf8'));
console.log(`池 ${bars.size} 个币；名单日期 ${AS_OF_DAY}；有该日 bar 的：${[...bars.values()].filter((x) => x.arr.some((b) => b.d === AS_OF_DAY)).length}`);

// ---------------------------------------------------------------- 1. 粗筛
/**
 * 粗筛只回答一个问题：这个币最近有没有一段像样的上涨？
 * 找到就给出拉伸区间，供用户在图上标压力位。不判断顶，不判断收敛，不判断好坏。
 */
const RALLY_LOOKBACK = 90;   // 往回找拉升的范围（天）
const RALLY_MIN = 0.3;       // 这段涨幅至少多少（相对量：涨了 30%）
const RALLY_MIN_DAYS = 4;    // 至少几天（过滤单根插针）
const RALLY_MAX_HOLD = 0.6;  // 顶之后最多回吐拉升的几成（跌回一半以下 = 这波已经废了）

function rally(arr, E) {
  if (E < RALLY_LOOKBACK) return null;
  const from = E - RALLY_LOOKBACK;
  let best = null;
  let lo = from;
  let loC = arr[from].c;
  for (let i = from; i <= E; i++) {
    if (arr[i].c < loC) { loC = arr[i].c; lo = i; }
    const g = (arr[i].h - loC) / loC;
    if (g >= RALLY_MIN && i - lo + 1 >= RALLY_MIN_DAYS && (!best || g > best.gain)) best = { sAt: lo, pAt: i, gain: g };
  }
  if (!best) return null;
  const P = arr.slice(best.sAt, best.pAt + 1).reduce((m, b) => Math.max(m, b.h), -Infinity);
  const base = arr[Math.max(0, best.sAt - 1)].c;
  let L = arr[best.pAt].l;
  for (let i = best.pAt; i <= E; i++) L = Math.min(L, arr[i].l);
  const giveback = (P - L) / (P - base);
  if (giveback > RALLY_MAX_HOLD) return null;   // 拉起来又全跌回去 → 这波不算"还在"
  const now = arr[E].c;
  const close = arr[E - 1]?.c;
  return {
    inst: null,
    s0: arr[best.sAt].d,
    p: arr[best.pAt].d,
    e: arr[E].d,
    gain: +(best.gain * 100).toFixed(1),       // 这段涨幅 %
    fromPeak: +(((P - now) / P) * 100).toFixed(1), // 现价离这段最高点 %
    holdDays: E - best.pAt,                      // 顶之后多少天
    todayPct: close ? +(((now - close) / close) * 100).toFixed(2) : null,
    price: now,
    peak: P,
  };
}

const list = [];
for (const [inst, { arr }] of bars) {
  const E = arr.findIndex((x) => x.d === AS_OF_DAY);
  if (E < 0) continue;
  const r = rally(arr, E);
  if (r) list.push({ ...r, inst: inst.replace(/USDT$/, ''), asOf: arr[E].d });
}
list.sort((a, b) => a.fromPeak - b.fromPeak);
fs.writeFileSync(path.join(OUT, 'rally-list.json'), JSON.stringify(list, null, 1));
console.log(`\n=== 1. 粗筛名单（${AS_OF_DAY}）：${list.length} 个币 ===`);
console.log(`${'币'.padEnd(10)}${'拉升起点'.padStart(12)}${'顶'.padStart(12)}${'涨幅'.padStart(7)}${'离顶'.padStart(7)}${'顶后'.padStart(5)}${'今日'.padStart(8)}`);
for (const r of list.slice(0, 20)) {
  console.log(
    `${r.inst.padEnd(10)}${r.s0.padStart(12)}${r.p.padStart(12)}${(r.gain + '%').padStart(7)}${(r.fromPeak + '%').padStart(7)}${String(r.holdDays).padStart(5)}${(r.todayPct ?? '-').toString().padStart(8)}`,
  );
}
console.log(`... 共 ${list.length} 个，详见 out/rally-list.json`);

// ---------------------------------------------------------------- 2. 按用户标的线回放
/**
 * 用户规定：报「上方最近的一条」线上的距离。
 * 这一段完全不需要算法猜任何东西，只需要把 33 条线当成输入，逐日算两个数。
 */
function replay(lines, arr, idx) {
  const price = arr[idx].c;
  const prev = arr[idx - 1]?.c ?? price;
  const above = lines.filter((l) => l > price).sort((a, b) => a - b);
  const nearest = above[0] ?? null;
  return {
    d: arr[idx].d,
    close: price,
    pct: +(((price - prev) / prev) * 100).toFixed(2),
    linesAbove: above.length,
    nearest,
    toLevel: nearest == null ? null : +(((nearest - price) / price) * 100).toFixed(2),
  };
}

const hLines = [];
for (const g of ann) for (const l of g.lines ?? []) if (l.kind === 'h') hLines.push({ inst: g.inst, region: g.region, price: l.price });

const replayRows = [];
for (const g of ann) {
  const b = bars.get(g.inst);
  if (!b) continue;
  const lines = (g.lines ?? []).filter((l) => l.kind === 'h').map((l) => l.price);
  if (!lines.length) continue;
  const a = b.arr.findIndex((x) => x.d === g.region[0]);
  const z = b.arr.findIndex((x) => x.d === g.region[1]);
  if (a < 0 || z < 0) continue;
  for (let i = a; i <= z; i++) replayRows.push({ inst: g.inst.replace(/USDT$/, ''), verdict: g.verdict, region: g.region.join('~'), ...replay(lines, b.arr, i) });
}
fs.writeFileSync(path.join(OUT, 'level-replay.json'), JSON.stringify(replayRows, null, 1));

// ---------------------------------------------------------------- 3. 口径自检
const withLevel = replayRows.filter((r) => r.nearest != null);
const pcts = withLevel.map((r) => r.toLevel).sort((x, y) => x - y);
const q = (p) => pcts[Math.min(pcts.length - 1, Math.floor(pcts.length * p))];
console.log(`\n=== 2. 按你标的线回放（${replayRows.length} 个币日，其中 ${withLevel.length} 个有上方线）===`);
console.log(`距上方最近一条线：中位 ${q(0.5)}% · p25 ${q(0.25)}% · p75 ${q(0.75)}% · 最大 ${pcts[pcts.length - 1]}%`);
const bucket = { '已在上方线之外（>+5%）': 0, '贴近（-5% ~ +5%）': 0, '在中途（-15% ~ -5%）': 0, '还远（<-15%）': 0 };
for (const r of withLevel) {
  if (r.toLevel > 5) bucket['已在上方线之外（>+5%）']++;
  else if (r.toLevel > -5) bucket['贴近（-5% ~ +5%）']++;
  else if (r.toLevel > -15) bucket['在中途（-15% ~ -5%）']++;
  else bucket['还远（<-15%）']++;
}
for (const [k, v] of Object.entries(bucket)) console.log(`  ${k.padEnd(22)} ${String(v).padStart(4)} (${((v / withLevel.length) * 100).toFixed(0)}%)`);

console.log('\n样例（XMR 两段）：');
for (const r of replayRows.filter((x) => x.inst === 'XMR').slice(0, 8)) {
  console.log(`  ${r.d}  收盘 ${r.close}  当日 ${r.pct > 0 ? '+' : ''}${r.pct}%  上方 ${r.linesAbove} 条线  最近 ${r.nearest?.toFixed(2)}  还差 ${r.toLevel}%`);
}

// ---------------------------------------------------------------- 4. 人工可读的当日名单
const markdown = [
  `# 粗筛名单 ${AS_OF_DAY}`,
  '',
  `口径：拉升 ≥${(RALLY_MIN * 100).toFixed(0)}% 且 ≥${RALLY_MIN_DAYS} 天，顶后回吐 ≤${(RALLY_MAX_HOLD * 100).toFixed(0)}%。` +
    `全池 ${[...bars.values()].filter((x) => x.arr.some((b) => b.d === AS_OF_DAY)).length} 个币 → 候选 ${list.length} 个。`,
  '',
  '**第 2 步（你来做）**：在上面每个币的「拉升区间」里画压力位。',
  '**第 3 步（每天自动）**：只报「当天涨跌%」和「距你线的上方最近一条还差%」。',
  '',
  '| 币 | 拉升区间 | 涨幅 | 离拉升顶 | 顶后 | 当日涨跌 |',
  '|---|---|---|---|---|---|',
  ...list.map((r) => `| ${r.inst} | ${r.s0} → ${r.p} | ${r.gain}% | ${r.fromPeak}% | ${r.holdDays}d | ${r.todayPct ?? '-'}% |`),
  '',
].join('\n');
fs.writeFileSync(path.join(OUT, `list-${AS_OF_DAY}.md`), markdown);
console.log(`\n可读名单：out/list-${AS_OF_DAY}.md`);
