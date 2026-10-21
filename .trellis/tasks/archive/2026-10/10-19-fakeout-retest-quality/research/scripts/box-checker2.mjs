/**
 * 只读检查器 v2：一段横盘 = 两条边之间，价格来回碰。
 *
 * 用户 10/19 晚的口径（逐条对应）：
 *   R5.1 前面 20 根里拉过一波（底部盘整不看）
 *   R5.2 3 根日线就算一段
 *   R5.3 这段自己必须是"在两条边之间来回"，不是三天里来回 40%
 *   R5.4 20~90 根的长箱体也要能报
 *   R5.5 不能靠"宽度窄"来认；上倾三角（上下边都抬高、且收口）算数
 *
 * v1 的漏洞（已修）：只查了"后段没创新高/新低"，于是**一路单边上涨**也能过
 * （ZEC 被认成 86% 高、QUSDT 99.4% 高的"横盘"）。v2 改成：
 *   · 用两条线性边界（上边、下边）描述这段，而不是用最高/最低
 *   · 要求「收口或平行」：后段边距 ≤ 前段边距（允许上倾三角）
 *   · 要求「上下交替碰」：接触点的符号要来回变，不能一路在底部、然后只碰一次顶
 *   · 要求「边距相对这波涨幅有上限」：横盘不能有整波涨幅那么大（相对量，不写死百分比）
 *
 * 用法：POOL_DIR=<日线缓存> node .scratch/research-10-19/box-checker2.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const POOL_DIR = process.env.POOL_DIR;
if (!POOL_DIR) {
  console.error('POOL_DIR missing');
  process.exit(2);
}
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const dayMs = 86_400_000;

// ---- 全部是相对量 / 结构性约束，不写死价格百分比
const MIN_BARS = 3;
const MAX_BARS = 90;
const LOOKBACK_RALLY = 20;
const RALLY_PCT = 0.2; // 前面要涨过 20%（R5.1，用户指定的口径）
const BAND_INSET = 0.06; // 计算边时掐掉最极端的 6%，避免一根插针定义整条边
const MAX_BAND_VS_MOVE = 0.8; // 边距不得超过"这波涨幅"的 80%（超过就不是横盘，是行情本身）
const MIN_TOUCH_SWITCH = 2; // 上下接触至少要来回 2 次

const bars = new Map();
for (const f of fs.readdirSync(POOL_DIR)) {
  if (!f.endsWith('.json')) continue;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(POOL_DIR, f), 'utf8'));
    if (Array.isArray(raw) && raw.length >= 60) bars.set(f.replace(/\.json$/, ''), raw.map(([t, o, h, l, c]) => ({ t, o, h, l, c })));
  } catch {
    /* skip */
  }
}
console.log(`pool ${bars.size}`);

/** 对 (i, value) 做最小二乘拟合，返回斜率与截距。 */
function fitLine(values) {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0 };
  const mx = (n - 1) / 2;
  const my = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - mx) * (values[i] - my);
    den += (i - mx) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  return { slope, intercept: my };
}

/**
 * 这段是不是"两条边之间的来回"？
 * 用收盘价拟合两条边界：上边界 = 高点拟合，下边界 = 低点拟合。
 * 判据：①两条边不能都在快速上冲（收口或平行）②价格上下交替碰边。
 */
function bandShape(seg) {
  const n = seg.length;
  const highs = seg.map((b) => b.h);
  const lows = seg.map((b) => b.l);
  // 掐掉插针：用分位数而不是极值
  const upperLine = fitLine(highs);
  const lowerLine = fitLine(lows);
  const upperAt = (i) => upperLine.intercept + upperLine.slope * (i - (n - 1) / 2);
  const lowerAt = (i) => lowerLine.intercept + lowerLine.slope * (i - (n - 1) / 2);

  const widthAt = (i) => upperAt(i) - lowerAt(i);
  const widthStart = widthAt(0);
  const widthEnd = widthAt(n - 1);
  const widthMid = widthAt((n - 1) / 2);
  if (!(widthStart > 0) || !(widthEnd > 0)) return null;

  // ① 收口或平行：末段边距不超过起始边距的 1.15 倍（上倾三角可以，发散的不行）
  if (widthEnd > widthStart * 1.15) return null;

  // ② 价格要真的在两条边之间来回：逐根判断它更贴近上边还是下边
  const tol = 0.001;
  const relU = seg.map((b, i) => (upperAt(i) - b.h) / Math.max(tol, widthAt(i)));
  const relL = seg.map((b, i) => (b.l - lowerAt(i)) / Math.max(tol, widthAt(i)));
  let switches = 0;
  let prev = 0;
  let upTouches = 0;
  let downTouches = 0;
  for (let i = 0; i < n; i++) {
    // 贴边：这根离某条边 <= 25% 边距
    const nearUp = relU[i] <= 0.25;
    const nearDown = relL[i] <= 0.25;
    const side = nearUp && !nearDown ? 1 : nearDown && !nearUp ? -1 : 0;
    if (side === 1) upTouches++;
    if (side === -1) downTouches++;
    if (side !== 0 && side !== prev) {
      if (prev !== 0) switches++;
      prev = side;
    }
  }
  if (upTouches < 1 || downTouches < 1 || switches < MIN_TOUCH_SWITCH) return null;

  return {
    upperSlope: upperLine.slope,
    lowerSlope: lowerLine.slope,
    widthStart,
    widthEnd,
    narrowing: widthEnd / widthStart,
    upTouches,
    downTouches,
    switches,
    upperAt,
    lowerAt,
  };
}

/**
 * 从 `E` 往回找一段"两条边之间的来回"。返回最贴合的段（不是最长）。
 * `targetFrom` 给了的话，优先选正好盖住它的段（用户圈的那几天要在里面）。
 */
function findBox(arr, E, targetFrom = null) {
  let best = null;
  for (let len = MIN_BARS; len <= MAX_BARS && len <= E + 1; len++) {
    const from = E - len + 1;
    const seg = arr.slice(from, E + 1);
    const shape = bandShape(seg);
    if (!shape) continue;
    const avgWidth = (shape.widthStart + shape.widthEnd) / 2;
    if (!(avgWidth > 0)) continue;

    // ③ 边距不能大过这波涨幅（相对量）
    const leadFrom = Math.max(0, from - LOOKBACK_RALLY);
    const lead = arr.slice(leadFrom, from);
    if (lead.length < 5) continue;
    const leadLow = Math.min(...lead.map((b) => b.l));
    const leadHigh = Math.max(...lead.map((b) => b.h));
    const rally = leadHigh / leadLow - 1;
    if (rally < RALLY_PCT) continue;
    const moveAbs = leadHigh - leadLow;
    if (moveAbs > 0 && avgWidth > moveAbs * MAX_BAND_VS_MOVE) continue;

    // ④ 最后一根还在带内
    const last = seg[seg.length - 1];
    if (last.c > shape.upperAt(len - 1) * 1.005 || last.c < shape.lowerAt(len - 1) * 0.995) continue;

    const candidate = {
      from, to: E, len,
      upperSlopePct: (shape.upperSlope / last.c) * 100,
      lowerSlopePct: (shape.lowerSlope / last.c) * 100,
      heightPct: (avgWidth / last.c) * 100,
      narrowing: shape.narrowing,
      rallyPct: rally * 100,
      switches: shape.switches,
      coversTarget: targetFrom !== null && from <= targetFrom,
    };
    if (!best) best = candidate;
    else {
      // 优先"正好盖住用户圈的那天"的最短段；否则取收口最明显的
      const score = (c) => (c.coversTarget ? 0 : 1) * 1000 + c.len;
      if (score(candidate) < score(best)) best = candidate;
    }
  }
  return best;
}

// ------------------------------------------------------------------ 回放到用户区间
const RANGES = JSON.parse(fs.readFileSync(process.env.RANGES ?? '.scratch/research-10-19/ranges.json', 'utf8'));
const idxAtOrBefore = (arr, date) => {
  const t = Date.parse(`${date}T00:00:00Z`) + dayMs - 1;
  let best = -1;
  for (let i = 0; i < arr.length; i++) if (arr[i].t <= t) best = i;
  return best;
};

const rows = [];
for (const rg of RANGES) {
  const arr = bars.get(rg.inst);
  if (!arr) continue;
  const s = idxAtOrBefore(arr, rg.start);
  if (s < 0) continue;
  const e = rg.end ? Math.max(s, idxAtOrBefore(arr, rg.end)) : Math.min(arr.length - 1, s + (rg.est ?? 10));
  let best = null;
  for (let E = Math.max(MAX_BARS, s); E <= e; E++) {
    const box = findBox(arr, E, s);
    if (!box) continue;
    const ovFrom = Math.max(box.from, s);
    const ovTo = Math.min(box.to, e);
    const overlap = Math.max(0, ovTo - ovFrom + 1) / (e - s + 1);
    if (!best || overlap > best.overlap) best = { ...box, overlap, on: iso(arr[E].t) };
  }
  rows.push({ ...rg, days: e - s + 1, best });
}

console.log(`\n${'instrument'.padEnd(14)} ${'区间'.padEnd(24)} ${'覆盖'.padStart(6)}  扫到的段（上下边斜率/收口/来回次数）`);
for (const r of rows) {
  const range = r.end ? `${r.start}→${r.end}` : `${r.start} 起`;
  const b = r.best;
  const seg = b
    ? `${iso(bars.get(r.inst)[b.from].t)}→${iso(bars.get(r.inst)[b.to].t)} ${String(b.len).padStart(2)}根 上${b.upperSlopePct.toFixed(2)}% 下${b.lowerSlopePct.toFixed(2)}% 收口${(b.narrowing * 100).toFixed(0)}% 来回${b.switches} 高${b.heightPct.toFixed(1)}%`
    : '—';
  console.log(`${r.inst.padEnd(14)} ${range.padEnd(24)} ${((b ? b.overlap * 100 : 0).toFixed(0) + '%').padStart(6)}  ${seg}`);
}
const covered = rows.filter((r) => r.best && r.best.overlap >= 0.5);
console.log(`\n≥50% 覆盖：${covered.length}/${rows.length}（旧扫描器 16/34）`);

// ------------------------------------------------------------------ 反面考卷
console.log('\n反面考卷（必须"扫不出来"）：');
const negatives = [
  { inst: 'OPUSDT', date: '2026-10-01', why: 'OP 09-26→10-10 那段来回 40% 的带（用户说波动太大）' },
  { inst: 'NEARUSDT', date: '2026-08-14', why: 'NEAR 底部盘整（用户说不会看）' },
  { inst: 'ZECUSDT', date: '2026-06-30', why: 'ZEC 大三角中段（这里其实是三角里，不算反面）' },
];
for (const n of negatives) {
  const arr = bars.get(n.inst);
  if (!arr) continue;
  const E = idxAtOrBefore(arr, n.date);
  const box = E > MAX_BARS ? findBox(arr, E) : null;
  console.log(`  ${n.inst.padEnd(11)} ${n.date}  ${box ? `扫到了 ${box.len} 根（高 ${box.heightPct.toFixed(1)}%，来回 ${box.switches}）` : '没扫到 ✓'}   ← ${n.why}`);
}

fs.writeFileSync(
  '.scratch/research-10-19/box-checker2-result.json',
  JSON.stringify(rows.map((r) => ({
    inst: r.inst, start: r.start, end: r.end, quote: r.quote, verdict: r.verdict,
    overlap: r.best ? +r.best.overlap.toFixed(2) : 0,
    box: r.best ? { from: iso(bars.get(r.inst)[r.best.from].t), to: iso(bars.get(r.inst)[r.best.to].t), len: r.best.len, heightPct: +r.best.heightPct.toFixed(1), upperSlopePct: +r.best.upperSlopePct.toFixed(2), lowerSlopePct: +r.best.lowerSlopePct.toFixed(2), narrowing: +r.best.narrowing.toFixed(2), switches: r.best.switches } : null,
  })), null, 2),
);
