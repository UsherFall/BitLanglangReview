/**
 * 每日两栏（2026-10-20 定稿版）
 *
 * 用户 10/20 的三条决定：
 *   1. 只报今天新触发，但标过压力位的要持续关注
 *   2. **扫描的是"我标注区间的那段时间"，不是现在** —— 现在的机会不好
 *   3. 加规则：线离价格太远 → 提示"线已过期，该重标了"
 *
 * 因此：
 *   第 1 栏 新变化：今天新进入"拉升完成+未突破"的币（事件驱动，可能为空）
 *   第 2 栏 你在盯的：按**你标注的区间**回放，报区间内每一天的涨跌与距线，
 *          并在区间结束那天判断"这条线还作不作数"
 *
 * Run: node .trellis/tasks/10-20-anomaly-level-tracker/research/build-daily.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = '.trellis/tasks/10-20-anomaly-level-tracker/research';
const OUT = path.join(DIR, 'out');
const dayOf = (t) => new Date(Number(t) + 8 * 3600 * 1000).toISOString().slice(0, 10);
const LOOKBACK = 90;

/** 线离价格超过这个比例就认为"过期"，提示重标（相对量，不用绝对百分比） */
const STALE_RATIO = Number(process.env.STALE_RATIO ?? 0.5); // 半个"涨幅"的距离

const bars = new Map();
for (const f of fs.readdirSync(path.join(DIR, 'pool'))) {
  if (!f.endsWith('.json')) continue;
  const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'pool', f), 'utf8'));
  if (raw.length >= 200) bars.set(f.replace(/\.json$/, ''), raw.map(([t, o, h, l, c]) => ({ t: Number(t), o, h, l, c, d: dayOf(t) })));
}

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
  if (Math.max(...after.map((b) => b.h)) > peak * 1.0001) return null;
  let L = arr[pAt].l;
  for (let i = pAt; i <= E; i++) L = Math.min(L, arr[i].l);
  if ((peak - L) / (peak - base) > 0.6) return null;
  return { s0: arr[sAt].d, p: arr[pAt].d, gain: best.gain, peakBase: peak - base };
}

function rayAt(r, ms) {
  const t1 = Number(r.p1.t), t2 = Number(r.p2.t);
  if (t2 === t1) return r.p2.price;
  return r.p2.price + ((r.p2.price - r.p1.price) / (t2 - t1)) * (ms - t2);
}

/** 第 3 步：某一天的两个数 */
function report(arr, i, lines) {
  const price = arr[i].c;
  const prev = arr[i - 1]?.c ?? price;
  const levels = lines.map((l) => (l.kind === 'h' ? { kind: 'h', p: l.price } : { kind: 'r', p: rayAt(l, arr[i].t) }));
  const above = levels.filter((x) => x.p > price).sort((a, b) => a.p - b.p);
  const nearest = above[0] ?? null;
  return {
    d: arr[i].d,
    price,
    pct: ((price - prev) / prev) * 100,
    nearest,
    toLine: nearest ? ((nearest.p - price) / price) * 100 : null,
  };
}

// ---- 判定日：用最后一根已收盘的 K 线（北京 8:00 收盘）
const allDays = [...new Set([...bars.values()].flatMap((a) => a.map((b) => b.d)))].sort();
const lastDay = allDays.at(-1);
const nowBJ = new Date(Date.now() + 8 * 3600 * 1000);
const isLastOpen = nowBJ.getUTCHours() >= 8;
const judgeDay = isLastOpen ? allDays.filter((d) => d < lastDay).at(-1) : lastDay;
const prevDay = allDays.filter((d) => d < judgeDay).at(-1);

/**
 * 第 1 栏：今天新触发（事件驱动）
 *
 * 实测：10-19 满足口径的 83 个里，0 个是新进入的 —— 该状态会连续满足几十天。
 * 所以这一栏天然可能是空的，空才是正常的，不要为了"有东西看"放松口径。
 */
const fresh = [];
for (const [inst, arr] of bars) {
  const Ej = arr.findIndex((x) => x.d === judgeDay);
  const Ep = arr.findIndex((x) => x.d === prevDay);
  const E = arr.findIndex((x) => x.d === lastDay);
  if (Ej < 0 || E < 0) continue;
  const cur = qualify(arr, Ej);
  const prev = Ep >= 0 ? qualify(arr, Ep) : null;
  if (cur && !prev) fresh.push({ inst: inst.replace(/USDT$/, ''), arr, E, cur });
}

// ---- 第 2 栏：按"你标注的区间"回放
const labels = JSON.parse(fs.readFileSync(path.join(DIR, 'draw', 'labels.json'), 'utf8'));
const watching = [];
for (const c of labels) {
  const arr = bars.get(c.inst);
  if (!arr) continue;
  const short = c.inst.replace(/USDT$/, '');
  for (const s of c.segments ?? []) {
    const lines = s.lines ?? [];
    if (!lines.length) continue;                  // 没画线的不需要跟
    const a = arr.findIndex((x) => x.d === s.region?.[0]);
    const b = arr.findIndex((x) => x.d === s.region?.[1]);
    if (a < 0 || b < 0) continue;

    // 区间内逐日
    const days = [];
    for (let i = a; i <= b; i++) days.push(report(arr, i, lines));

    // 区间结束时，这条线还作不作数：
    //   用"这波拉升的幅度"当尺子（不是拍脑袋的百分比）
    const shape = qualify(arr, b) ?? qualify(arr, arr.length - 1);
    const gainAbs = shape ? shape.peakBase : Math.abs(arr[b].c - arr[a].c);
    const lastRep = days[days.length - 1];
    const distAbs = lastRep.nearest ? Math.abs(lastRep.nearest.p - lastRep.price) : Infinity;
    const stale = lastRep.nearest ? distAbs > gainAbs * STALE_RATIO : true; // 已破线也算过期

    const ds = days.filter((d) => d.toLine != null).map((d) => d.toLine);
    watching.push({
      inst: short,
      region: s.region.join('~'),
      verdict: s.verdict,
      note: (c.note || '').trim(),
      days,
      minLine: ds.length ? Math.min(...ds) : null,
      maxLine: ds.length ? Math.max(...ds) : null,
      crossedDays: days.filter((d) => d.toLine == null).length,
      stale,
      endDist: lastRep.nearest ? lastRep.toLine : null,
      gainAbs,
      distAbs,
    });
  }
}

// ---- 输出
const V = { good: '会做', structure: '结构不行', chart: '股性不行', converge: '没收敛', missed: '错过了' };
console.log(`${lastDay}（北京时间；判定日 ${judgeDay}）\n`);

console.log(`=== 第 1 栏：今天新触发的（${fresh.length} 个） ===`);
if (!fresh.length) console.log('  （今天没有新进入"拉升完成+未突破"的币 —— 这种日子是正常的）');
for (const x of fresh) console.log(`  ${x.inst.padEnd(8)} 拉升 ${x.cur.s0.slice(5)}→${x.cur.p.slice(5)} 涨${(x.cur.gain * 100).toFixed(0)}%`);

console.log(`\n=== 第 2 栏：按你标注的区间回放（${watching.length} 段） ===`);
console.log(`${'币'.padEnd(8)}${'区间'.padEnd(24)}${'判定'.padEnd(10)}${'区间内距线范围'.padStart(16)}${'区间内破线'.padStart(10)}  线的状态`);
for (const w of watching) {
  const range = w.minLine == null ? '全部在线上' : `${w.minLine.toFixed(1)} ~ ${w.maxLine.toFixed(1)}%`;
  console.log(
    `${w.inst.padEnd(8)}${w.region.padEnd(24)}${(V[w.verdict] ?? '—').padEnd(10)}${range.padStart(16)}${(w.crossedDays ? w.crossedDays + ' 天' : '—').padStart(10)}  ${w.stale ? '⚠ 线已过期，该重标' : '✓ 区间内有效'}`,
  );
}

// 逐日序列（挑典型的两段打印）
for (const w of watching.filter((x) => ['BNB', 'LINEA'].includes(x.inst))) {
  console.log(`\n${w.inst} ${w.region} 逐日：`);
  for (const d of w.days) {
    console.log(`  ${d.d}  收 ${d.price}  当日 ${d.pct >= 0 ? '+' : ''}${d.pct.toFixed(2)}%  距线 ${d.toLine == null ? '已破线' : d.toLine.toFixed(2) + '%'}`);
  }
}

const staleCount = watching.filter((w) => w.stale).length;
console.log(`\n每天要看的量：新触发 ${fresh.length} + 在盯的 ${watching.length}（其中 ${staleCount} 段的线已过期，需要重标）`);

fs.writeFileSync(path.join(OUT, 'daily.json'), JSON.stringify({
  asOf: lastDay,
  judgeDay,
  fresh: fresh.map((x) => ({ inst: x.inst, ...x.cur })),
  watching,
}, null, 1));
