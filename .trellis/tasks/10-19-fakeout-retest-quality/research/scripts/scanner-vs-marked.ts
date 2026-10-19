/**
 * What the SHIPPED scanner marks on the chart — and does it match the ranges the
 * user said he watches?
 *
 * The scanner is `detectConvergence` (src/domain/coin-scan.ts): over the 1D series it
 * searches a contiguous BAND that (a) is flat, (b) is quieter than the equal-length
 * stretch before it, (c) still contains the newest close. Its "area" is not a price
 * box — it is a fresh LOOKBACK BAND on the right edge of the 100-bar window:
 *
 *     band = K[bandEnd-L+1 .. bandEnd]     (L >= MIN_RUN=5, bandEnd = L-1 from the right end)
 *     area = [min(low), max(high)] of the band's confirmed part
 *
 * Row inclusion is the 1D COARSE screen (23-day window: rangePct / netPct in the pool's
 * low quantiles, plus posRange >= 0.03), so a coin can appear with NO convergence band.
 *
 * This script runs the SHIPPED detectors (imported from src/, not re-implemented) day by
 * day over the user's own marked ranges and reports, per range, the fraction of days the
 * scanner would have produced a convergence band that OVERLAPS the range the user named.
 *
 * Run: POOL_DIR=<dir> node <this>   (cwd = repo root; needs tsx/ts-node to import .ts)
 *   npx tsx .scratch/research-10-19/scanner-vs-marked.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  COARSE_TIMEFRAME,
  DEFAULT_CONVERGENCE_MIN_RUN,
  coarseScreen,
  coarseStructure,
  defaultStructureParams,
  detectConvergence,
} from '../../src/domain/coin-scan';
import type { Candlestick } from '../../src/domain/candlestick';

const POOL_DIR = process.env.POOL_DIR;
if (!POOL_DIR) {
  console.error('POOL_DIR missing');
  process.exit(2);
}
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

const bars = new Map<string, Candlestick[]>();
for (const f of fs.readdirSync(POOL_DIR)) {
  if (!f.endsWith('.json')) continue;
  const inst = f.replace(/\.json$/, '');
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(POOL_DIR, f), 'utf8')) as number[][];
    if (!Array.isArray(raw) || raw.length < 100) continue;
    bars.set(
      inst,
      raw.map(([t, o, h, l, c]) => ({ instrument: inst, timeframe: '1D', timestamp: t, open: o, high: h, low: l, close: c, volume: 0 })),
    );
  } catch {
    /* skip */
  }
}
console.log(`pool ${bars.size} instruments`);

const params = defaultStructureParams();

/**
 * The band the scanner marks when the series ends at bar `E`: scan the last 100 bars
 * (the live fetch window) and report the band's own bar indices.
 */
function scanAt(all: Candlestick[], E: number, window = 100) {
  const from = Math.max(0, E - window + 1);
  const slice = all.slice(from, E + 1);
  const result = detectConvergence(slice, params);
  if (result === null) return null;
  // Recover the band: re-run the same search shape and take the best run length.
  const sorted = slice;
  const minRun = DEFAULT_CONVERGENCE_MIN_RUN;
  const best = bestBand(sorted, minRun, params);
  if (!best) return null;
  return {
    score: result.score,
    position: result.position,
    rangeLow: best.rangeLow,
    rangeHigh: best.rangeHigh,
    bandFrom: from + best.start,
    bandTo: from + sorted.length - 1,
    bandLen: best.runLen,
  };
}

/** Mirrors detectConvergence's search to recover the winning band's geometry. */
function bestBand(sorted: Candlestick[], minRun: number, p: ReturnType<typeof defaultStructureParams>) {
  const vol = sorted.map((c) => (c.high - c.low) / c.low);
  const median = (xs: number[]) => {
    if (!xs.length) return 0;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)]!;
  };
  const edgeDrift = (ys: number[], from: number) => {
    const n = ys.length;
    if (n < 2) return 0;
    const xs = ys.map((_, i) => i + from);
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i]! - mx) * (ys[i]! - my);
      den += (xs[i]! - mx) ** 2;
    }
    return den === 0 ? 0 : Math.abs(num / den);
  };
  const last = sorted.length - 1;
  const lastPrice = sorted[last]!.close;
  // The same constants the shipped module uses (read them from the export to stay in sync).
  const convergenceRatio = p.convergenceRatio!;
  const shortTightRatio = p.shortTightRatio!;
  const flatRatio = p.flatRatio!;
  const SHORT_RUN = 30;
  const effective = (runLen: number) =>
    runLen >= SHORT_RUN ? convergenceRatio : shortTightRatio + ((convergenceRatio - shortTightRatio) * (runLen - minRun)) / (SHORT_RUN - minRun);
  let best: { score: number; runLen: number; rangeLow: number; rangeHigh: number; start: number } | null = null;
  for (let start = last - minRun + 1; start >= 0; start -= 1) {
    const runLen = last - start + 1;
    const preStart = start - runLen;
    if (preStart < 0) continue;
    const band = sorted.slice(start, last + 1);
    const runMed = median(vol.slice(start, last + 1));
    if (Math.max(edgeDrift(band.map((c) => c.low), start), edgeDrift(band.map((c) => c.high), start)) > flatRatio * runMed) continue;
    const preMed = median(vol.slice(preStart, start));
    if (runMed >= effective(runLen) * preMed) continue;
    const confirmed = band.slice(0, band.length - 1);
    const rangeLow = Math.min(...confirmed.map((c) => c.low));
    const rangeHigh = Math.max(...confirmed.map((c) => c.high));
    const tol = 0.1 * (rangeHigh - rangeLow);
    if (lastPrice < rangeLow - tol || lastPrice > rangeHigh + tol) continue;
    const score = Math.max(0, Math.min(1, 1 - runMed / preMed));
    if (best === null || score > best.score) best = { score, runLen, rangeLow, rangeHigh, start };
  }
  return best;
}

/** The user's marked ranges (his own words, one card each on the page). */
const RANGES: Array<{ inst: string; start: string; end?: string; est?: number; quote: string; verdict: 'good' | 'weak' }> = JSON.parse(
  fs.readFileSync(process.env.RANGES ?? '.scratch/research-10-19/ranges.json', 'utf8'),
);

const idxAtOrBefore = (arr: Candlestick[], date: string) => {
  const t = Date.parse(`${date}T00:00:00Z`) + 86_399_999;
  let best = -1;
  for (let i = 0; i < arr.length; i++) if (arr[i]!.timestamp <= t) best = i;
  return best;
};

type Row = {
  inst: string;
  start: string;
  end?: string;
  quote: string;
  verdict: string;
  days: number;
  hitDays: number;
  overlap: number;
  best: { score: number; overlap: number; bandFrom: string; bandTo: string; bandLen: number } | null;
};
const rows: Row[] = [];
for (const rg of RANGES) {
  const arr = bars.get(rg.inst);
  if (!arr) continue;
  const s = idxAtOrBefore(arr, rg.start);
  if (s < 0) continue;
  const e = rg.end ? Math.max(s, idxAtOrBefore(arr, rg.end)) : Math.min(arr.length - 1, s + (rg.est ?? 10));
  let days = 0;
  let hitDays = 0;
  const overlaps: number[] = [];
  let bestRow: Row['best'] = null;
  for (let E = Math.max(100, s); E <= e; E++) {
    days++;
    const sc = scanAt(arr, E);
    if (!sc) continue;
    // overlap of the scanner's band with the user's range (bars)
    const from = Math.max(sc.bandFrom, s);
    const to = Math.min(sc.bandTo, e);
    const ov = Math.max(0, to - from + 1) / (sc.bandTo - sc.bandFrom + 1);
    if (ov > 0) {
      hitDays++;
      overlaps.push(ov);
      if (!bestRow || ov > bestRow.overlap || (ov === bestRow.overlap && sc.score > bestRow.score)) {
        bestRow = { score: sc.score, overlap: ov, bandFrom: iso(arr[sc.bandFrom]!.timestamp), bandTo: iso(arr[sc.bandTo]!.timestamp), bandLen: sc.bandLen };
      }
    }
  }
  rows.push({
    inst: rg.inst,
    start: rg.start,
    end: rg.end,
    quote: rg.quote,
    verdict: rg.verdict,
    days,
    hitDays,
    overlap: overlaps.length ? overlaps.reduce((a, b) => a + b, 0) / overlaps.length : 0,
    best: bestRow,
  });
}

console.log(`\n${'instrument'.padEnd(14)} ${'range'.padEnd(26)} ${'days'.padStart(4)} ${'hit'.padStart(4)}  ${'median overlap'.padStart(14)}  best band`);
for (const r of rows) {
  const range = r.end ? `${r.start}→${r.end}` : `${r.start} 起`;
  console.log(
    `${r.inst.padEnd(14)} ${range.padEnd(26)} ${String(r.days).padStart(4)} ${String(r.hitDays).padStart(4)}  ${((r.overlap * 100).toFixed(0) + '%').padStart(14)}  ${r.best ? `${r.best.bandFrom}→${r.best.bandTo} (${r.best.bandLen} 根, 重叠 ${(r.best.overlap * 100).toFixed(0)}%, score ${r.best.score.toFixed(2)})` : '—'}`,
  );
}
const hit = rows.filter((r) => r.hitDays > 0).length;
console.log(`\n扫描器在你点名的区间里扫出过收敛的：${hit}/${rows.length}`);
fs.writeFileSync('.scratch/research-10-19/scanner-vs-marked.json', JSON.stringify(rows, null, 2));
