/**
 * 门槛标定探针：完全离线，只读 `data/review.sqlite`，不发起任何网络请求。
 *
 * 用法（仓库根目录）：
 *   node .trellis/tasks/09-20-early-convergence-calibration/research/threshold-calibration-probe.mjs
 *
 * 为什么离线：连续探测币安会触发 HTTP 418（IP 封禁 ~24min）。本地缓存已有
 * 82 个 USDT 品种 × 5 周期、各 ≥100 根，足够标定，且零请求。
 *
 * 对比两套口径：
 *   OLD = 改动前的 `0.7 × calm + 0.3 × min(1, runLen/16)`。**冻结在脚本里的镜像**，
 *         因为生产代码改成 calm-only 后，真实 `detectConvergence` 不再产生这组分数。
 *   NEW = 只保留收缩深度 `score = calm`（`detectCalmOnly` 镜像），并额外用真实
 *         `detectConvergence` 做交叉校验，确保实现与标定口径一致。
 * 门槛：OLD 固定 0.6（面板默认）；NEW 扫描 0.43 / 0.50 / 0.60。
 */
import Database from 'better-sqlite3';

const REPO = new URL('../../../../', import.meta.url).href; // 仓库根（本文件在 .trellis/tasks/<task>/research/ 下）
const { detectConvergence, defaultStructureParams, scanTimeframes } = await import(REPO + 'src/domain/coin-scan.ts');

const P = defaultStructureParams();
const STEP_MS = { '5m': 3e5, '15m': 9e5, '1H': 36e5, '4H': 144e5, '1D': 864e5 };
const WINDOW = 100;
const OLD_MIN_SCORE = 0.6;
const NEW_THRESHOLDS = [0.43, 0.50, 0.60];
const OLD_EQUIVALENT = 0.6 / 0.7 - 0.3 / 0.7; // 旧口径长带的等效 calm 门槛 = 0.4286
/** 冻结的旧长度刻度。生产代码已删除 lengthScale，基线镜像必须自带这个数。 */
const OLD_LENGTH_SCALE = 16;

const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
function edgeDrift(p, startIndex) {
  const n = p.length;
  if (n < 2) return 0;
  let sX = 0, sY = 0, sXY = 0, sXX = 0;
  for (let i = 0; i < n; i += 1) { const x = startIndex + i; sX += x; sY += p[i]; sXY += x * p[i]; sXX += x * x; }
  const d = n * sXX - sX * sX; if (!d) return 0;
  const slope = (n * sXY - sX * sY) / d; const m = sY / n; if (!m) return 0;
  return (Math.abs(slope) * (n - 1)) / m;
}

/** NEW 口径：在通过三道闸门的带里取 calm 最大的那条。 */
function detectCalmOnly(s) {
  if (s.length < P.minRun * 2 || s.some((c) => c.low <= 0)) return null;
  const vol = s.map((c) => (c.high - c.low) / c.low);
  const last = s.length - 1, lastPrice = s[last].close;
  let best = null;
  for (let start = last - P.minRun + 1; start >= 0; start -= 1) {
    const runLen = last - start + 1;
    if (start - runLen < 0) continue;
    const band = s.slice(start, last + 1);
    const runMed = median(vol.slice(start, last + 1));
    if (Math.max(edgeDrift(band.map((c) => c.low), start), edgeDrift(band.map((c) => c.high), start)) > P.flatRatio * runMed) continue;
    const preMed = median(vol.slice(start - runLen, start));
    if (runMed >= P.convergenceRatio * preMed) continue;
    const confirmed = band.slice(0, band.length - 1);
    const rl = Math.min(...confirmed.map((c) => c.low)), rh = Math.max(...confirmed.map((c) => c.high));
    const tol = 0.1 * (rh - rl);
    if (lastPrice < rl - tol || lastPrice > rh + tol) continue;
    const calm = clamp01(1 - runMed / preMed);
    if (!best || calm > best.calm) best = { calm, runLen, quietRatio: runMed / preMed };
  }
  return best;
}

// ---------------- 读缓存 ----------------
const db = new Database('data/review.sqlite', { readonly: true });
const candidates = db.prepare(`
  select instrument from candles
  where timeframe in ('5m','15m','1H','4H','1D') and instrument like '%USDT'
  group by instrument
  having count(distinct timeframe) = 5
`).all().map((r) => r.instrument);

const loadBars = db.prepare(`
  select timestamp, open, high, low, close, volume from candles
  where instrument = ? and timeframe = ? order by timestamp asc
`);

const windows = [];
const skipped = { bars: 0, gap: 0 };
for (const instrument of candidates) {
  for (const timeframe of scanTimeframes) {
    const step = STEP_MS[timeframe];
    const rows = loadBars.all(instrument, timeframe);
    if (rows.length < WINDOW + 1) { skipped.bars += 1; continue; }
    // 丢掉可能仍在形成中的最新一根，再取最近 WINDOW 根
    const completed = rows.slice(0, rows.length - 1).slice(-WINDOW);
    // 连续性校验（与 CandlestickService.contiguousCandles 同口径：跳空 > 1.5×step 即断）
    let contiguous = true;
    for (let i = 1; i < completed.length; i += 1) {
      if (completed[i].timestamp - completed[i - 1].timestamp > step * 1.5) { contiguous = false; break; }
    }
    if (!contiguous) { skipped.gap += 1; continue; }
    windows.push({ instrument, timeframe, bars: completed });
  }
}
db.close();

// ---------------- 计算 ----------------
const rows = [];
for (const w of windows) {
  // 注意：基线不能再用真实 detectConvergence —— 生产代码改成 calm-only 之后，
  // 它就不再是"改动前"了。所以基线走下面冻結的旧公式镜像 detectOldDetail，
  // 新口径走 detectCalmOnly，真实函数单独用一条交叉校验比对。
  const oldResult = detectOldDetail(w.bars);
  const newResult = detectCalmOnly(w.bars);
  rows.push({
    instrument: w.instrument,
    timeframe: w.timeframe,
    oldScore: oldResult ? oldResult.score : null,
    oldQualified: Boolean(oldResult && oldResult.score >= OLD_MIN_SCORE),
    calm: newResult ? newResult.calm : null,
    newRunLen: newResult ? newResult.runLen : null,
    oldRunLen: oldResult ? oldResult.runLen : null,
  });
}
/** 冻结的旧公式镜像（0.7×calm + 0.3×length）。改动后真实函数已不产生这组分数。 */
function detectOldDetail(s) {
  if (s.length < P.minRun * 2 || s.some((c) => c.low <= 0)) return null;
  const vol = s.map((c) => (c.high - c.low) / c.low);
  const last = s.length - 1, lastPrice = s[last].close;
  let best = null;
  for (let start = last - P.minRun + 1; start >= 0; start -= 1) {
    const runLen = last - start + 1;
    if (start - runLen < 0) continue;
    const band = s.slice(start, last + 1);
    const runMed = median(vol.slice(start, last + 1));
    if (Math.max(edgeDrift(band.map((c) => c.low), start), edgeDrift(band.map((c) => c.high), start)) > P.flatRatio * runMed) continue;
    const preMed = median(vol.slice(start - runLen, start));
    if (runMed >= P.convergenceRatio * preMed) continue;
    const confirmed = band.slice(0, band.length - 1);
    const rl = Math.min(...confirmed.map((c) => c.low)), rh = Math.max(...confirmed.map((c) => c.high));
    const tol = 0.1 * (rh - rl);
    if (lastPrice < rl - tol || lastPrice > rh + tol) continue;
    const calm = clamp01(1 - runMed / preMed);
    const score = clamp01(0.7 * calm + 0.3 * clamp01(runLen / OLD_LENGTH_SCALE));
    if (!best || score > best.score) best = { score, runLen, calm };
  }
  return best;
}
// 交叉校验：实现后的真实 detectConvergence 必须与标定用的 calm-only 镜像完全一致
// （决策 + 分数）。不一致说明实现与标定口径脱节，整份对照就失效。
const mismatches = [];
for (const w of windows) {
  const real = detectConvergence(w.bars, P);
  const mirror = detectCalmOnly(w.bars);
  const realScore = real ? real.score : null;
  const mirrorScore = mirror ? mirror.calm : null;
  if ((realScore === null) !== (mirrorScore === null)) { mismatches.push(`${w.instrument}:${w.timeframe} 决策不同`); continue; }
  if (realScore !== null && Math.abs(realScore - mirrorScore) > 1e-12) mismatches.push(`${w.instrument}:${w.timeframe} 分数 ${realScore} vs ${mirrorScore}`);
}

const dur = (runLen, tf) => {
  const h = (runLen * STEP_MS[tf]) / 36e5;
  return h < 48 ? `${h.toFixed(1)}h` : `${(h / 24).toFixed(1)}d`;
};
const pct = (a, b) => (b === 0 ? '-' : `${((a / b) * 100).toFixed(0)}%`);

console.log(`缓存候选品种 = ${candidates.length}   有效窗口 = ${windows.length}   (跳过: 根数不足 ${skipped.bars}, 有跳空 ${skipped.gap})`);
console.log(`OLD = 0.7×calm + 0.3×min(1,runLen/16), 门槛 ${OLD_MIN_SCORE}   |   NEW = calm, 门槛见下`);
console.log('');

const oldRows = rows.filter((r) => r.oldQualified);
const oldKeys = new Set(oldRows.map((r) => `${r.instrument}:${r.timeframe}`));

console.log('== OLD 基线（现状）==');
console.log(`合格窗口 ${oldRows.length}   其中带长<16(早期) ${oldRows.filter((r) => r.oldRunLen < OLD_LENGTH_SCALE).length} (${pct(oldRows.filter((r) => r.oldRunLen < OLD_LENGTH_SCALE).length, oldRows.length)})`);
console.log(`选中带长: 中位 ${median(oldRows.map((r) => r.oldRunLen))}  分布 ${JSON.stringify(oldRows.reduce((m, r) => ((m[r.oldRunLen] = (m[r.oldRunLen] ?? 0) + 1), m), {}))}`);
console.log('');

console.log('== NEW 各门槛对比 ==');
console.log('门槛    合格窗口  早期(<16根)  早期占比   新增   丢失   超集?');
for (const th of NEW_THRESHOLDS) {
  const nr = rows.filter((r) => r.calm !== null && r.calm >= th);
  const nk = new Set(nr.map((r) => `${r.instrument}:${r.timeframe}`));
  const added = [...nk].filter((k) => !oldKeys.has(k)).length;
  const lost = [...oldKeys].filter((k) => !nk.has(k)).length;
  const early = nr.filter((r) => r.newRunLen < OLD_LENGTH_SCALE).length;
  console.log(`${th.toFixed(2).padEnd(7)} ${String(nr.length).padEnd(10)} ${String(early).padEnd(12)} ${pct(early, nr.length).padEnd(10)} ${String(added).padEnd(6)} ${String(lost).padEnd(6)} ${lost === 0 ? 'YES' : 'NO'}`);
}
console.log('');

console.log('== 超集性质校验（门槛 = 旧口径等效点 ' + OLD_EQUIVALENT.toFixed(4) + '）==');
{
  const nr = rows.filter((r) => r.calm !== null && r.calm >= OLD_EQUIVALENT);
  const nk = new Set(nr.map((r) => `${r.instrument}:${r.timeframe}`));
  const lost = [...oldKeys].filter((k) => !nk.has(k));
  console.log(`合格窗口 ${nr.length}   丢失旧结果 ${lost.length} 条 ${lost.length ? '→ ' + lost.slice(0, 8).join(', ') : '（超集成立）'}`);
}
console.log('');

console.log('== OLD 合格行的 calm 分布（用来判断门槛该落在哪）==');
{
  const calms = oldRows.map((r) => r.calm).sort((a, b) => a - b);
  for (const q of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
    const idx = Math.min(calms.length - 1, Math.floor(q * (calms.length - 1)));
    console.log(`  分位 ${(q * 100).toFixed(0).padStart(3)}%  calm = ${calms[idx].toFixed(3)}   等价"振幅 ≤ 前段 ${((1 - calms[idx]) * 100).toFixed(0)}%"`);
  }
  console.log(`  旧基线里 calm < 0.43 的行数 = ${oldRows.filter((r) => r.calm < 0.4286).length}（这些是短带，靠长度项补分上榜的）`);
}
console.log('');

console.log('== NEW 选中的带长 vs OLD（看"16 根堆积"是否消失）==');
{
  const nr = rows.filter((r) => r.calm !== null && r.calm >= 0.43);
  const hist = (arr) => JSON.stringify(arr.reduce((m, v) => ((m[v] = (m[v] ?? 0) + 1), m), {}));
  const atSaturation = (arr) => arr.filter((v) => v === OLD_LENGTH_SCALE).length;
  console.log(`OLD 带长分布: ${hist(oldRows.map((r) => r.oldRunLen))}   恰好=16 的: ${atSaturation(oldRows.map((r) => r.oldRunLen))}/${oldRows.length}`);
  console.log(`NEW 带长分布: ${hist(nr.map((r) => r.newRunLen))}   恰好=16 的: ${atSaturation(nr.map((r) => r.newRunLen))}/${nr.length}`);
  console.log(`NEW 带长中位 ${median(nr.map((r) => r.newRunLen))} 根；按周期看选中带长的实际时长中位：`);
  for (const tf of scanTimeframes) {
    const t = nr.filter((r) => r.timeframe === tf).map((r) => r.newRunLen);
    if (t.length) console.log(`   ${tf.padEnd(4)} ${String(t.length).padEnd(3)} 行   带长中位 ${String(median(t)).padEnd(3)} → ${dur(median(t), tf)}`);
  }
}
console.log('');

console.log('== 实现一致性交叉校验（真实 detectConvergence vs 标定用的 calm-only 镜像）==');
console.log(`比对窗口 ${windows.length} 个   决策或分数不一致 = ${mismatches.length} 条${mismatches.length ? ' → ' + mismatches.slice(0, 8).join('; ') : '（完全一致：实现与标定口径吻合）'}`);
