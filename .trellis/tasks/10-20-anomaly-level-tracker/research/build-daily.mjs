/**
 * 用户 10/20 定的最终形态：
 *   第 1 栏「今天新触发」——今天刚进入"异动拉升 + 未突破"状态的币（实测中位 3 个）
 *   第 2 栏「你在盯的」——用户标过压力位/射线的币，不管今天是否新触发，持续报涨跌与距线
 *
 * 本脚本把两栏都算出来，作为产品的定义与自测。
 *
 * 距线口径（用户 10/20 定）：
 *   - 水平线：取上方最近的一条，(线价 - 现价) / 现价
 *   - 射线：取在"今天"这根 K 线上的价格，同样口径
 *
 * Run: node .trellis/tasks/10-20-anomaly-level-tracker/research/build-daily.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = '.trellis/tasks/10-20-anomaly-level-tracker/research';
const OUT = path.join(DIR, 'out');
const dayOf = (t) => new Date(Number(t) + 8 * 3600 * 1000).toISOString().slice(0, 10);
const LOOKBACK = 90;

const bars = new Map();
for (const f of fs.readdirSync(path.join(DIR, 'pool'))) {
  if (!f.endsWith('.json')) continue;
  const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'pool', f), 'utf8'));
  if (raw.length >= 200) bars.set(f.replace(/\.json$/, ''), raw.map(([t, o, h, l, c]) => ({ t: Number(t), o, h, l, c, d: dayOf(t) })));
}

/** 是否处于"异动拉升 + 未突破 + 回吐不过半" */
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
  return { s0: arr[sAt].d, p: arr[pAt].d, gain: best.gain, peak };
}

/** 射线在某个时间点的价格 */
function rayAt(r, ms) {
  const t1 = Number(r.p1.t), t2 = Number(r.p2.t);
  if (t2 === t1) return r.p2.price;
  const slope = (r.p2.price - r.p1.price) / (t2 - t1);
  return r.p2.price + slope * (ms - t2);
}

/** 第 3 步：报两个数 */
function report(arr, E, lines) {
  const price = arr[E].c;
  const prev = arr[E - 1]?.c ?? price;
  const levels = [];
  for (const l of lines) {
    if (l.kind === 'h') levels.push({ kind: 'h', p: l.price });
    else if (l.kind === 'r') levels.push({ kind: 'r', p: rayAt(l, arr[E].t) });
  }
  const above = levels.filter((x) => x.p > price).sort((a, b) => a.p - b.p);
  return {
    price,
    pct: ((price - prev) / prev) * 100,
    nLines: levels.length,
    nearest: above[0] ?? null,
    toLine: above[0] ? ((above[0].p - price) / price) * 100 : null,
  };
}

/**
 * 判定日用"最后一根已收盘的 K 线"，不是最后一根。
 * Bitget 1D 在 UTC 0 点 = 北京 8:00 收盘；北京 8:00 之后那一根是盘中价，
 * 拿它判断"今天是否新触发"会把所有币都判成"刚刚变化"。
 */
const barsLast = (a) => a[a.length - 1];
const allDays = [...bars.values()].flatMap((a) => a.map((b) => b.d));
const lastDay = [...new Set(allDays)].sort().at(-1);          // 最后一根（可能是盘中）
const nowBJ = new Date(Date.now() + 8 * 3600 * 1000);
const isLastBarOpen = nowBJ.getUTCHours() >= 8;                // 北京时间 8 点后，当日那根还没收
const judgeDay = isLastBarOpen
  ? [...new Set(allDays)].sort().filter((d) => d < lastDay).at(-1)
  : lastDay;
const prevDay = [...new Set(allDays)].sort().filter((d) => d < judgeDay).at(-1);
console.log(`最后一根 ${lastDay}${isLastBarOpen ? '（盘中，未收盘）' : ''}；判定日 ${judgeDay}；前一日 ${prevDay}`);
void barsLast;

// ---------------- 第 1 栏：今天新触发（判定日用已收盘那根）
/**
 * "新触发"的实测问题（2026-10-20）：
 *   10-19 满足口径的有 83 个，但其中 0 个是"新进入"——这 83 个前一天就全满足了。
 *   原因：一旦进入"拉升完成 + 未突破"状态，会连续满足几十天（顶后整理期都算），
 *   所以"状态切换"这个事件本身极少发生。纯按"新进入"报，绝大多数日子是空表。
 *
 * 改成"有新变化"才报，变化的定义（都不涉及"好不好"，只报事实）：
 *   ① 刚进入状态（新触发）
 *   ② 今天新碰到/突破了你标的某条线
 *   ③ 今天回到离你那条线还有 N% 以内（N 由用户定，默认不启用）
 * 第 2 栏已经是全量跟进，所以第 1 栏只报①②。
 */
const fresh = [];
const still = [];
for (const [inst, arr] of bars) {
  const Ej = arr.findIndex((x) => x.d === judgeDay);
  const Ep = arr.findIndex((x) => x.d === prevDay);
  const E = arr.findIndex((x) => x.d === lastDay);   // 报数用最后一根（含盘中）
  if (Ej < 0 || E < 0) continue;
  const cur = qualify(arr, Ej);
  const prev = Ep >= 0 ? qualify(arr, Ep) : null;
  if (cur && !prev) fresh.push({ inst, arr, E, cur });
  else if (cur && prev) still.push({ inst, arr, E, cur });
}

// ---------------- 第 2 栏：你标过的币
const labels = JSON.parse(fs.readFileSync(path.join(DIR, 'draw', 'labels.json'), 'utf8'));
const watching = [];
for (const c of labels) {
  const arr = bars.get(c.inst);
  if (!arr) continue;
  const lines = (c.segments ?? []).flatMap((s) => s.lines ?? []);
  if (!lines.length) continue;                 // 没画线的，不需要持续跟
  const E = arr.findIndex((x) => x.d === lastDay);
  if (E < 0) continue;
  watching.push({ inst: c.inst, short: c.inst.replace(/USDT$/, ''), arr, E, lines, rep: report(arr, E, lines), note: (c.note || '').trim(), verdict: (c.segments ?? [])[0]?.verdict });
}

/**
 * 真正的触发事件：今天第一次碰到/越过你标的某条线。
 * 用最后一根（含盘中）判断，因为这是"现在"发生的事。
 */
const touch = [];
for (const w of watching) {
  const E = w.E;
  const prev = report(w.arr, E - 1, w.lines);
  const cur = w.rep;
  const wasBelow = prev.nearest !== null;
  const nowAbove = cur.nearest === null && cur.nLines > 0;
  if (wasBelow && nowAbove) touch.push ({ ...w, kind: '刚突破你标的线', from: prev.toLine, now: null });
  else if (wasBelow && cur.nearest && Math.abs(cur.nearest.p - prev.nearest.p) > 0) {
    const jumped = prev.toLine - cur.toLine;
    if (jumped > 0) touch.push({ ...w, kind: '更接近你标的线', from: prev.toLine, now: cur.toLine });
  }
}

console.log(`数据最后一天 ${lastDay}（北京时间；判定日 ${judgeDay}）\n`);

console.log(`=== 第 1 栏：今天有新变化的 ===`);
console.log(`  · 新进入"拉升完成 + 未突破"状态：${fresh.length} 个`);
console.log(`  · 碰到/更接近你标的线：${touch.length} 个`);
for (const x of touch) {
  console.log(`    ${x.short.padEnd(8)} ${x.kind}  距线 ${x.from == null ? '-' : x.from.toFixed(2) + '%'} → ${x.now == null ? '已破线' : x.now.toFixed(2) + '%'}`);
}

console.log(`\n=== 第 2 栏：你在盯的（${watching.length} 个，标过线） ===`);
console.log(`${'币'.padEnd(8)}${'判定'.padEnd(10)}${'现价'.padStart(12)}${'当日'.padStart(9)}${'线'.padStart(4)}${'距线'.padStart(9)}  备注`);
for (const x of watching.sort((a, b) => (a.rep.toLine ?? 999) - (b.rep.toLine ?? 999))) {
  const V = { good: '会做', structure: '结构不行', chart: '股性不行', converge: '没收敛', missed: '错过了' }[x.verdict] ?? '—';
  const toLine = x.rep.toLine == null ? '已破线' : x.rep.toLine.toFixed(2) + '%';
  console.log(`${x.short.padEnd(8)}${V.padEnd(10)}${String(x.rep.price).padStart(12)}${((x.rep.pct >= 0 ? '+' : '') + x.rep.pct.toFixed(2) + '%').padStart(9)}${String(x.rep.nLines).padStart(4)}${toLine.padStart(9)}  ${x.note.slice(0, 26)}`);
}

const total = fresh.length + watching.length;
console.log(`\n每天要看的量：新触发 ${fresh.length} + 你在盯的 ${watching.length} = ${total}`);
console.log(`（仍在名单但不新触发、也不在盯的：${still.length} 个，不报）`);

fs.writeFileSync(path.join(OUT, 'daily.json'), JSON.stringify({
  asOf: lastDay,
  fresh: fresh.map((x) => ({ inst: x.inst.replace(/USDT$/, ''), ...x.cur })),
  watching: watching.map((x) => ({ inst: x.short, verdict: x.verdict, note: x.note, ...x.rep })),
  stillCount: still.length,
}, null, 1));
