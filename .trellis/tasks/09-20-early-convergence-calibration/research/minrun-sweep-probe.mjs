/**
 * minRun 扫描：离线只读 `data/review.sqlite`，零网络请求。
 *
 * 用法（仓库根目录）：
 *   node .trellis/tasks/09-20-early-convergence-calibration/research/minrun-sweep-probe.mjs
 *
 * 背景：门槛已定 0.60、分数已改为只看 calm（= 收缩深度）。去掉长度项后选中的带
 * 系统性变短（中位 17 → 7 根），`minRun`（当前 5）从辅助参数变成承重参数。
 * 本脚本扫 minRun = 5/6/8/10/12/15，看行数、带长、各周期（尤其 1D）还剩多少。
 */
import Database from 'better-sqlite3';
import { pathToFileURL } from 'node:url';

const REPO = pathToFileURL('D:/haveFun/BitLanglangReview/').href;
const { defaultStructureParams, scanTimeframes } = await import(REPO + 'src/domain/coin-scan.ts');
const BASE = defaultStructureParams();

const STEP_MS = { '5m': 3e5, '15m': 9e5, '1H': 36e5, '4H': 144e5, '1D': 864e5 };
const WINDOW = 100;
const NEW_MIN_SCORE = 0.60;
const MINRUNS = [5, 6, 8, 10, 12, 15];

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

/** minimuRun 可配的 NEW 口径：只取 calm 最大的带。 */
function detectCalmOnly(s, minRun) {
  if (s.length < minRun * 2 || s.some((c) => c.low <= 0)) return null;
  const vol = s.map((c) => (c.high - c.low) / c.low);
  const last = s.length - 1, lastPrice = s[last].close;
  let best = null;
  for (let start = last - minRun + 1; start >= 0; start -= 1) {
    const runLen = last - start + 1;
    if (start - runLen < 0) continue;
    const band = s.slice(start, last + 1);
    const runMed = median(vol.slice(start, last + 1));
    if (Math.max(edgeDrift(band.map((c) => c.low), start), edgeDrift(band.map((c) => c.high), start)) > BASE.flatRatio * runMed) continue;
    const preMed = median(vol.slice(start - runLen, start));
    if (runMed >= BASE.convergenceRatio * preMed) continue;
    const confirmed = band.slice(0, band.length - 1);
    const rl = Math.min(...confirmed.map((c) => c.low)), rh = Math.max(...confirmed.map((c) => c.high));
    const tol = 0.1 * (rh - rl);
    if (lastPrice < rl - tol || lastPrice > rh + tol) continue;
    const calm = clamp01(1 - runMed / preMed);
    if (!best || calm > best.calm) best = { calm, runLen, confirmedBars: confirmed.length };
  }
  return best;
}

/** 现状 OLD 口径基线（用于算 新增/丢失）。 */
function detectOld(s) {
  const P = BASE;
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
    const score = clamp01(0.7 * calm + 0.3 * clamp01(runLen / P.lengthScale));
    if (!best || score > best.score) best = { score };
  }
  return best;
}

const db = new Database('data/review.sqlite', { readonly: true });
const candidates = db.prepare(`
  select instrument from candles
  where timeframe in ('5m','15m','1H','4H','1D') and instrument like '%USDT'
  group by instrument having count(distinct timeframe) = 5
`).all().map((r) => r.instrument);
const loadBars = db.prepare(`select timestamp, open, high, low, close, volume from candles where instrument = ? and timeframe = ? order by timestamp asc`);

const windows = [];
for (const instrument of candidates) {
  for (const timeframe of scanTimeframes) {
    const step = STEP_MS[timeframe];
    const rows = loadBars.all(instrument, timeframe);
    if (rows.length < WINDOW + 1) continue;
    const bars = rows.slice(0, rows.length - 1).slice(-WINDOW);
    let ok = true;
    for (let i = 1; i < bars.length; i += 1) if (bars[i].timestamp - bars[i - 1].timestamp > step * 1.5) { ok = false; break; }
    if (!ok) continue;
    windows.push({ instrument, timeframe, bars });
  }
}
db.close();

const oldKeys = new Set();
for (const w of windows) {
  const o = detectOld(w.bars);
  if (o && o.score >= 0.6) oldKeys.add(`${w.instrument}:${w.timeframe}`);
}

const dur = (runLen, tf) => {
  const h = (runLen * STEP_MS[tf]) / 36e5;
  return h < 48 ? `${h.toFixed(1)}h` : `${(h / 24).toFixed(1)}d`;
};

console.log(`有效窗口 = ${windows.length}   NEW 口径 score=calm, 门槛 ${NEW_MIN_SCORE}   现状基线(OLD,0.6) 合格 = ${oldKeys.size}`);
console.log('');
console.log('minRun  合格  带长中位  确认区间中位(根)  新增  丢失  恰好=minRun的占比   5m  15m  1H  4H  1D');
const results = {};
for (const mr of MINRUNS) {
  const rows = [];
  for (const w of windows) {
    const d = detectCalmOnly(w.bars, mr);
    if (d && d.calm >= NEW_MIN_SCORE) rows.push({ ...w, ...d });
  }
  const keys = new Set(rows.map((r) => `${r.instrument}:${r.timeframe}`));
  const added = [...keys].filter((k) => !oldKeys.has(k)).length;
  const lost = [...oldKeys].filter((k) => !keys.has(k)).length;
  const perTf = {};
  for (const tf of scanTimeframes) perTf[tf] = rows.filter((r) => r.timeframe === tf).length;
  const atFloor = rows.filter((r) => r.runLen === mr).length;
  results[mr] = rows;
  console.log(`${String(mr).padEnd(7)} ${String(rows.length).padEnd(5)} ${String(median(rows.map((r) => r.runLen))).padEnd(9)} ${String(median(rows.map((r) => r.confirmedBars))).padEnd(16)} ${String(added).padEnd(5)} ${String(lost).padEnd(5)} ${((atFloor / Math.max(1, rows.length)) * 100).toFixed(0).padStart(3)}%${' '.repeat(12)} ${scanTimeframes.map((t) => String(perTf[t]).padEnd(4)).join('')}`);
}

console.log('');
console.log('== 各档 minRun 下，选中带长换算成实际时长（中位）==');
console.log('minRun  5m      15m     1H      4H      1D');
for (const mr of MINRUNS) {
  const rows = results[mr];
  console.log(`${String(mr).padEnd(7)} ` + scanTimeframes.map((tf) => {
    const t = rows.filter((r) => r.timeframe === tf).map((r) => r.runLen);
    return t.length ? dur(median(t), tf).padEnd(8) : '-'.padEnd(8);
  }).join(''));
}

console.log('');
console.log('== 1D 在这个门槛下本来就不多，逐条看（minRun=5 与 minRun=10 对比）==');
for (const mr of [5, 10]) {
  const d1 = results[mr].filter((r) => r.timeframe === '1D');
  console.log(`minRun=${mr}: 1D 合格 ${d1.length} 条`);
  d1.slice(0, 20).forEach((r) => console.log(`   ${r.instrument.padEnd(14)} 带长 ${String(r.runLen).padEnd(3)} (${dur(r.runLen, '1D').padEnd(6)}) calm ${r.calm.toFixed(3)} 确认区间 ${r.confirmedBars} 根`));
}
